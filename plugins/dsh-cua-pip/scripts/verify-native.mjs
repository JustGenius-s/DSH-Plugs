import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNativeCapture } from '../src/native-launch.ts'

const [pid, windowId, directory] = process.argv.slice(2)
if (![pid, windowId].every((value) => /^[1-9]\d*$/.test(value ?? '')) || !directory) {
  throw new Error('Usage: node scripts/verify-native.mjs <pid> <window-id> <evidence-directory>')
}
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const output = resolve(directory)
mkdirSync(output, { recursive: true })
const temp = mkdtempSync(join(tmpdir(), 'dsh-focus-audit-'))
const children = []
try {
  const auditBinary = join(temp, 'focus-audit')
  execFileSync('/usr/bin/xcrun', ['swiftc', join(root, 'scripts', 'focus-audit.swift'), '-o', auditBinary])
  const audit = spawn(auditBinary, [pid, '10'], { stdio: ['pipe', 'pipe', 'pipe'] })
  children.push(audit)
  const auditExit = once(audit, 'exit')
  let auditText = ''
  audit.stdout.on('data', (chunk) => { auditText += chunk })
  audit.stderr.pipe(process.stderr)
  await new Promise((done) => setTimeout(done, 300))
  const helper = join(root, 'lib', 'DSH Window Capture.app', 'Contents', 'MacOS', 'dsh-window-capture')
  const child = launchNativeCapture(helper, ['--pid', pid, '--window-id', windowId, '--max-dimension', '1024', '--fps', '30'])
  children.push(child)
  const exited = once(child, 'exit')
  const report = { verifiedAt: new Date().toISOString(), pid: Number(pid), windowId: Number(windowId), frames: [], statuses: [], errors: [] }
  let pending = ''
  let first = null
  let last = null
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    pending += chunk
    let newline
    while ((newline = pending.indexOf('\n')) >= 0) {
      const value = JSON.parse(pending.slice(0, newline))
      pending = pending.slice(newline + 1)
      if (value.type === 'frame') {
        const image = Buffer.from(value.base64, 'base64')
        first ??= image
        last = image
        const { base64, ...metadata } = value
        report.frames.push({ ...metadata, imageSha256: createHash('sha256').update(image).digest('hex') })
      } else if (value.type === 'status') report.statuses.push(value)
      else report.errors.push(value)
    }
  })
  child.stderr.pipe(process.stderr)
  child.stdin.on('error', () => {})
  const stop = setTimeout(() => child.stdin.end('stop\n'), 8000)
  const kill = setTimeout(() => child.kill('SIGKILL'), 11_000)
  const [exitCode, exitSignal] = await exited
  clearTimeout(stop)
  clearTimeout(kill)
  await auditExit
  report.focus = JSON.parse(auditText)
  report.exitCode = exitCode
  report.exitSignal = exitSignal
  report.scope = 'Read-only native single-window stream via LaunchServices, matching production permission attribution. No app launch/input/resize/activation or desktop pixels. Hash changes do not prove stopwatch semantics.'
  if (first) writeFileSync(join(output, 'first.jpg'), first)
  if (last) writeFileSync(join(output, 'last.jpg'), last)
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({
    output, frames: report.frames.length, nativeErrors: report.errors, exitCode, exitSignal,
    dimensions: report.frames[0] ? [report.frames[0].width, report.frames[0].height] : null,
    nativeIntervalMs: report.frames.length > 1
      ? (report.frames.at(-1).capturedAt - report.frames[0].capturedAt) / (report.frames.length - 1) : null,
    distinctImages: new Set(report.frames.map((frame) => frame.imageSha256)).size,
    focus: report.focus,
  }, null, 2))
  if (exitCode !== 0 || report.frames.length === 0 || report.focus.targetFrontmostSamples > 0
    || report.focus.changes.some((change) => change.pid === Number(pid))) process.exitCode = 1
} finally {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
  }
  rmSync(temp, { recursive: true, force: true })
}
