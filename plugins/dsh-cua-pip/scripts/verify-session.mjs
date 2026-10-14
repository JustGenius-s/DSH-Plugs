import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PIP_RUNTIME_VERSION, CONTROL_POLICY_VERSION } from '../src/shared/config.ts'

const [base, sessionId, pidText, windowText, outputDir] = process.argv.slice(2)
if (!base || !sessionId || !outputDir || ![pidText, windowText].every((value) => /^[1-9]\d*$/.test(value ?? ''))) {
  throw new Error('Usage: node verify-session.mjs <host-url> <existing-session-id> <pid> <window-id> <evidence-directory>')
}
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const directory = resolve(outputDir)
const target = { pid: Number(pidText), windowId: Number(windowText) }
const request = async (path, body) => {
  const response = await fetch(new URL(path, base), {
    ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(value)}`)
  return value
}
const before = await request('/cua-pip/activity')
if (before.sessions.some((entry) => entry.sessionId === sessionId && entry.visible)) {
  throw new Error('The selected session already has an open PiP; refusing to replace it')
}
const temp = mkdtempSync(join(tmpdir(), 'dsh-session-audit-'))
let openedAt
let reader
let audit
let auditExit
try {
  const binary = join(temp, 'focus-audit')
  execFileSync('/usr/bin/xcrun', ['swiftc', join(root, 'scripts', 'focus-audit.swift'), '-o', binary])
  audit = spawn(binary, [pidText, '33'])
  auditExit = once(audit, 'exit')
  let focus = ''
  audit.stdout.on('data', (chunk) => { focus += chunk })
  audit.stderr.pipe(process.stderr)
  const health = await request('/cua-pip/health')
  if (health.capture !== 'screencapturekit-window'
    || health.runtimeVersion !== PIP_RUNTIME_VERSION
    || health.backgroundPolicy !== CONTROL_POLICY_VERSION
    || health.monitor?.readyGate !== true || health.monitor?.observe !== 'native-image') {
    throw new Error('The running host does not have the native window implementation')
  }
  const started = await request('/cua-pip/watch', { sessionId, ...target, closeAfterSeconds: 30 })
  const activity = await request('/cua-pip/activity')
  openedAt = activity.sessions.find((entry) => entry.sessionId === sessionId)?.openedAt
  const stream = await fetch(new URL(`/cua-pip/stream?session=${encodeURIComponent(sessionId)}`, base), {
    signal: AbortSignal.timeout(32_000),
  })
  if (!stream.ok || !stream.body) throw new Error(`SSE failed: ${stream.status}`)
  reader = stream.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  const samples = []
  const lifecycle = []
  let previousLifecycle
  const errors = new Set()
  let terminal = false
  let frameId
  let firstImage
  let lastImage
  const imageHashes = new Set()
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    pending += decoder.decode(value, { stream: true })
    let newline
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      if (!line.startsWith('data: ')) continue
      const message = JSON.parse(line.slice(6))
      if (!message.watching) { terminal = true; continue }
      if (message.state?.error) errors.add(message.state.error)
      const nextLifecycle = JSON.stringify(message.state?.captureLifecycle)
      if (nextLifecycle !== previousLifecycle) {
        lifecycle.push({ at: Date.now(), ...message.state.captureLifecycle, error: message.state.error })
        previousLifecycle = nextLifecycle
      }
      const frame = message.state?.frame
      if (!frame) continue
      if (typeof frame.frameId !== 'string') throw new Error('Frame identity is missing')
      if (frame.frameId === frameId) continue
      frameId = frame.frameId
      if (message.state.target.pid !== target.pid || message.state.target.windowId !== target.windowId) {
        throw new Error('PiP changed target during the read-only check')
      }
      const image = Buffer.from(frame.base64, 'base64')
      firstImage ??= image
      lastImage = image
      const imageHash = createHash('sha256').update(image).digest('hex')
      if (frame.imageHash !== imageHash) throw new Error('Frame hash is missing or invalid')
      imageHashes.add(imageHash)
      samples.push({
        at: Date.now(), capturedAt: frame.capturedAt, frameId, imageHash,
        sequence: frame.sequence, generation: message.state.captureLifecycle?.generation,
        width: frame.width, height: frame.height,
      })
    }
  }
  await new Promise((done) => setTimeout(done, 300))
  const after = await request('/cua-pip/activity')
  const closed = after.sessions.find((entry) => entry.sessionId === sessionId)
  const healthAfter = await request('/cua-pip/health')
  await auditExit
  const report = {
    verifiedAt: new Date().toISOString(), health, started, closed,
    terminal, framesReceived: samples.length, firstFrame: samples[0], lastFrame: samples.at(-1),
    distinctImages: imageHashes.size,
    meanFrameIntervalMs: samples.length > 1 ? (samples.at(-1).at - samples[0].at) / (samples.length - 1) : null,
    lifecycle, errors: [...errors], healthAfter, focus: JSON.parse(focus),
    scope: 'Actual DSH Host -> native SCStream -> SSE -> local HTTP reader, 30-second host close; no app input or browser rendering.',
  }
  mkdirSync(directory, { recursive: true })
  if (firstImage) writeFileSync(join(directory, 'session-first.jpg'), firstImage)
  if (lastImage) writeFileSync(join(directory, 'session-last.jpg'), lastImage)
  writeFileSync(join(directory, 'session-report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  if (samples.length === 0 || errors.size > 0 || !terminal || closed?.visible !== false
    || report.focus.targetFrontmostSamples > 0 || report.focus.changes.some((change) => change.pid === target.pid)) {
    process.exitCode = 1
  }
} finally {
  await reader?.cancel().catch(() => {})
  if (openedAt !== undefined) {
    await request('/cua-pip/close', { sessionId, openedAt }).catch((error) => console.error(error.message))
  }
  if (audit && audit.exitCode === null && audit.signalCode === null) {
    audit.kill('SIGKILL')
    await auditExit
  }
  rmSync(temp, { recursive: true, force: true })
}
