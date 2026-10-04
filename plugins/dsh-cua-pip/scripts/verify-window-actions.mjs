// Native integration test: the only input target is our freshly spawned fixture.
// Run with Node 24 --experimental-transform-types. No existing app is clicked.
import { execFile, execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as wait } from 'node:timers/promises'
import { WindowCaptureSource } from '../src/native-capture.ts'
import { launchNativeCapture } from '../src/native-launch.ts'
import { CUA_DRIVER_BIN, parseCuaResponse } from '../src/cua.ts'
import { parseWindowAX, planWindowSteps } from '../src/window-observation.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const directory = resolve(process.argv[2] ?? '.tmp/window-actions-v7')
const temp = mkdtempSync(join(tmpdir(), 'dsh-pip-fixture-'))
const children = []
const execute = promisify(execFile)
let source
let report = { verifiedAt: new Date().toISOString(), inputCount: 0 }
try {
  mkdirSync(directory, { recursive: true })
  const fixtureBin = join(temp, 'pip-control-fixture'), auditBin = join(temp, 'focus-audit')
  execFileSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-parse-as-library',
    join(root, 'test', 'window-control-fixture.swift'), '-o', fixtureBin], { stdio: 'inherit' })
  execFileSync('/usr/bin/xcrun', ['swiftc', join(root, 'scripts', 'focus-audit.swift'), '-o', auditBin], { stdio: 'inherit' })
  const fixture = spawn(fixtureBin, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  children.push(fixture)
  fixture.stderr.pipe(process.stderr)
  let pending = ''
  const events = []
  fixture.stdout.setEncoding('utf8')
  fixture.stdout.on('data', (chunk) => {
    pending += chunk
    let newline
    while ((newline = pending.indexOf('\n')) >= 0) {
      events.push(JSON.parse(pending.slice(0, newline)))
      pending = pending.slice(newline + 1)
    }
  })
  const until = async (read, message, timeout = 8000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const result = await read()
      if (result) return result
      await wait(50)
    }
    throw new Error(message)
  }
  const target = await until(() => events.find((event) => event.pid && event.windowId), 'Fixture failed to create its window')
  if (target.pid !== fixture.pid) throw new Error('Refusing input: target is not the owned fixture process')
  report.target = target
  const audit = spawn(auditBin, [String(target.pid), '20'])
  children.push(audit)
  const audited = once(audit, 'exit')
  let focus = ''
  audit.stdout.on('data', (chunk) => { focus += chunk })
  audit.stderr.pipe(process.stderr)
  const call = async (tool, args) => {
    if (args.pid !== fixture.pid || args.window_id !== target.windowId) throw new Error('Fixture-only target guard failed')
    const { stdout } = await execute(CUA_DRIVER_BIN, ['call', tool, JSON.stringify(args)], { timeout: 20_000, maxBuffer: 8_000_000 })
    return parseCuaResponse(stdout)
  }
  source = new WindowCaptureSource({
    bin: join(root, 'lib', 'DSH Window Capture.app', 'Contents', 'MacOS', 'dsh-window-capture'),
    launch: (bin, args) => { const child = launchNativeCapture(bin, args); children.push(child); return child },
  })
  const readFrame = () => source.capture(target, 1024, 'fixture')
  await until(readFrame, 'No native fixture frame')
  const beforeAX = await call('get_window_state', { pid: target.pid, window_id: target.windowId, include_screenshot: false })
  const ax = parseWindowAX({ structuredContent: beforeAX }, target)
  const before = await until(readFrame, 'No fresh native fixture frame after AX observation')
  report.capabilities = ax.routes
  report.capabilityReasons = ax.reasons
  const button = ax.elements.find((element) => element.label === 'Fixture Increment' && element.actions.includes('AXPress'))
  if (!button?.frame || !before.windowBounds) throw new Error('Fixture button has no canonical AX geometry')
  const x = (button.frame.x + button.frame.width / 2 - before.windowBounds.x) * before.width / before.windowBounds.width
  const y = (button.frame.y + button.frame.height / 2 - before.windowBounds.y) * before.height / before.windowBounds.height
  const [step] = planWindowSteps([{ kind: 'click', x, y }], target, before, ax, Math.abs(Date.now() - before.capturedAt))
  report.input = { targeting: step.targeting, imagePoint: { x, y }, operation: step.operation }
  report.inputCount = 1
  report.driverResult = await call(step.operation, step.arguments)
  await until(() => events.some((event) => event.event === 'increment' && event.count === 1), 'The fixture did not observe exactly one input')
  const afterAX = await call('get_window_state', { pid: target.pid, window_id: target.windowId, include_screenshot: false })
  report.axReadbackConfirmed = JSON.stringify(afterAX).includes('Count: 1')
  const after = await until(async () => {
    const frame = await readFrame()
    return frame && frame.capturedAt > before.capturedAt && frame.imageHash !== before.imageHash ? frame : null
  }, 'No changed native frame after the fixture action')
  writeFileSync(join(directory, 'before.jpg'), Buffer.from(before.base64, 'base64'))
  writeFileSync(join(directory, 'after.jpg'), Buffer.from(after.base64, 'base64'))
  report.imageChanged = before.imageHash !== after.imageHash
  report.frames = [before, after].map(({ frameId, capturedAt, imageHash, width, height }) => ({ frameId, capturedAt, imageHash, width, height }))
  report.fixtureEvents = events.filter((event) => event.event)
  await audited
  report.focus = JSON.parse(focus)
  if (!report.axReadbackConfirmed || report.focus.targetFrontmostSamples !== 0
    || report.focus.changes.some((change) => change.pid === fixture.pid)) throw new Error('Native acceptance failed')
  report.passed = true
} catch (error) {
  report.passed = false
  report.error = error instanceof Error ? error.message : String(error)
  process.exitCode = 1
} finally {
  source?.dispose()
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const exit = once(child, 'exit')
    child.stdin?.end('stop\n')
    const kill = setTimeout(() => child.kill('SIGKILL'), 3500)
    if (!child.stdin) child.kill('SIGTERM')
    await exit
    clearTimeout(kill)
  }
  report.scope = 'Owned synthetic AppKit window only. Real native frames and one coordinate-to-AX action; no existing app input. DSH guards/model image delivery are verified separately by host-interface tests.'
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  rmSync(temp, { recursive: true, force: true })
}
