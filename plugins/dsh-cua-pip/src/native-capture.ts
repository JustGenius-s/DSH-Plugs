import { existsSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CuaError } from './cua.ts'
import { launchNativeCapture, type CaptureProcess } from './native-launch.ts'
import type { CaptureHealth, Frame, WatchTarget } from './shared/types.ts'

export const CAPTURE_SOURCE = 'screencapturekit-window'
export const CAPTURE_BINARY = join(
  dirname(fileURLToPath(import.meta.url)), 'DSH Window Capture.app', 'Contents', 'MacOS', 'dsh-window-capture',
)
const MAX_LINE_BYTES = 8 * 1024 * 1024

interface NativeFrame extends Frame {
  sequence: number
  capturedAt: number
}

function row(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CuaError('Invalid native capture message', 'capture_failed')
  }
  return value as Record<string, unknown>
}

/** Reject unbound or display frames before exposing any pixels to a session. */
export function parseNativeFrame(raw: string, target: WatchTarget, maxDimension: number): NativeFrame {
  const value = row(JSON.parse(raw))
  if (value.protocol !== 1) throw new CuaError('Unsupported native capture protocol', 'capture_failed')
  if (value.type === 'error') {
    const code = ['window_gone', 'permission_denied', 'capture_stopped', 'capture_interrupted'].includes(String(value.code))
      ? value.code as 'window_gone' | 'permission_denied' | 'capture_stopped' | 'capture_interrupted'
      : 'capture_failed'
    throw new CuaError(typeof value.message === 'string' ? value.message : 'Native window capture failed', code)
  }
  if (value.type !== 'frame' || value.source !== CAPTURE_SOURCE
    || value.pid !== target.pid || value.windowId !== target.windowId) {
    throw new CuaError('Native capture returned an unbound or different window', 'capture_failed')
  }
  const bounds = row(value.windowBounds)
  if (![value.width, value.height].every((n) => typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= maxDimension)
    || typeof value.sequence !== 'number' || !Number.isSafeInteger(value.sequence) || value.sequence <= 0
    || typeof value.capturedAt !== 'number' || !Number.isFinite(value.capturedAt) || value.capturedAt <= 0
    || ![bounds.x, bounds.y, bounds.width, bounds.height].every((n) => typeof n === 'number' && Number.isFinite(n))
    || Number(bounds.width) <= 0 || Number(bounds.height) <= 0
    || typeof value.appName !== 'string' || typeof value.windowTitle !== 'string'
    || value.mime !== 'image/jpeg' || typeof value.base64 !== 'string' || value.base64.length === 0
    || value.base64.length > MAX_LINE_BYTES || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.base64)) {
    throw new CuaError('Invalid native window frame metadata', 'capture_failed')
  }
  const image = Buffer.from(value.base64, 'base64')
  if (image[0] !== 0xFF || image[1] !== 0xD8 || image.at(-2) !== 0xFF || image.at(-1) !== 0xD9) {
    throw new CuaError('Invalid native window JPEG', 'capture_failed')
  }
  return {
    mime: 'image/jpeg', base64: value.base64,
    width: value.width as number, height: value.height as number,
    appName: value.appName, windowTitle: value.windowTitle,
    windowBounds: { x: Number(bounds.x), y: Number(bounds.y), width: Number(bounds.width), height: Number(bounds.height) },
    sequence: value.sequence, capturedAt: value.capturedAt,
    imageHash: createHash('sha256').update(image).digest('hex'),
  }
}

export interface NativeCaptureOptions {
  bin?: string
  platform?: string
  fps?: number
  startupTimeoutMs?: number
  launch?: (bin: string, args: string[]) => CaptureProcess
}

interface StreamEntry {
  id: string
  target: WatchTarget
  dimension: number
  owners: Set<string>
  child?: CaptureProcess
  frame: NativeFrame | null
  error: CuaError | null
  stopping: boolean
  startupTimer?: ReturnType<typeof setTimeout>
  health?: CaptureHealth
  watchdog?: ReturnType<typeof setInterval>
  lastMessageAt: number
}

/** One long-lived SCStream per window, reference-counted across conversations. */
export class WindowCaptureSource {
  private readonly streams = new Map<string, StreamEntry>()
  private readonly sessions = new Map<string, { key: string; sequence: number; entry: StreamEntry }>()
  private readonly bin: string
  private disposed = false

  constructor(private readonly options: NativeCaptureOptions = {}) {
    this.bin = options.bin ?? CAPTURE_BINARY
  }

  health() {
    return {
      source: CAPTURE_SOURCE,
      helperPath: this.bin,
      supported: (this.options.platform ?? process.platform) === 'darwin',
      built: existsSync(this.bin),
      launch: 'launchservices',
      streams: [...this.streams.values()].filter((entry) => !entry.stopping && entry.error === null).length,
    }
  }

  async capture(target: WatchTarget, dimension: number, sessionId: string): Promise<Frame | null> {
    if (this.disposed) throw new CuaError('Native capture source was disposed', 'capture_stopped')
    if ((this.options.platform ?? process.platform) !== 'darwin') {
      throw new CuaError('Single-window capture requires macOS; desktop capture fallback is disabled', 'capture_stopped')
    }
    if (!Number.isSafeInteger(target.pid) || target.pid <= 0 || target.pid > 0x7FFF_FFFF
      || !Number.isSafeInteger(target.windowId) || target.windowId <= 0 || target.windowId > 0xFFFF_FFFF
      || !Number.isSafeInteger(dimension) || dimension < 64 || dimension > 2048 || !sessionId) {
      throw new CuaError('Invalid exact-window capture request', 'capture_failed')
    }
    const key = `${target.pid}:${target.windowId}:${dimension}`
    if (this.sessions.get(sessionId)?.key !== key) this.release(sessionId)
    const previous = this.sessions.get(sessionId)
    let entry = previous?.entry ?? this.streams.get(key)
    // An explicit reopen may replace a failed shared stream without reviving
    // other sessions that were stopped by the user's system sharing control.
    if (previous === undefined && entry?.error !== null && entry?.error !== undefined) entry = undefined
    if (entry === undefined) {
      entry = {
        id: randomUUID(),
        target: { ...target }, dimension, owners: new Set(), frame: null, error: null, stopping: false,
        lastMessageAt: Date.now(),
      }
      this.streams.set(key, entry)
      this.start(entry)
    }
    entry.owners.add(sessionId)
    const owner = this.sessions.get(sessionId) ?? { key, sequence: 0, entry }
    this.sessions.set(sessionId, owner)
    if (entry.error !== null) throw entry.error
    // Native idle is not a new sample. Never stamp a cached JPEG with a new
    // time/count and claim it proves background repaint.
    if (entry.frame === null || entry.frame.sequence <= owner.sequence) return null
    owner.sequence = entry.frame.sequence
    return entry.frame
  }

  observation(sessionId: string): CaptureHealth | undefined {
    const entry = this.sessions.get(sessionId)?.entry
    return entry?.error == null ? entry?.health : undefined
  }

  private start(entry: StreamEntry): void {
    let pending = ''
    const stopWith = (error: unknown): void => {
      if (entry.stopping) return
      entry.error = error instanceof CuaError && error.code !== 'capture_failed' ? error
        : new CuaError(error instanceof Error ? error.message : String(error), 'capture_stopped')
      entry.frame = null
      this.stop(entry)
    }
    try {
      const launch = this.options.launch ?? launchNativeCapture
      const child = launch(this.bin, [
        '--pid', String(entry.target.pid), '--window-id', String(entry.target.windowId),
        '--max-dimension', String(entry.dimension), '--fps', String(this.options.fps ?? 30),
      ])
      entry.child = child
      child.stdin.on('error', () => {})
      child.stderr.resume()
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        if (entry.stopping) return
        pending += chunk
        let newline: number
        while ((newline = pending.indexOf('\n')) >= 0) {
          if (newline > MAX_LINE_BYTES) { stopWith(new Error('Oversized native capture message')); return }
          const line = pending.slice(0, newline)
          pending = pending.slice(newline + 1)
          try {
            const value = row(JSON.parse(line))
            if (value.type === 'status') {
              if (value.protocol !== 1 || value.pid !== entry.target.pid || value.windowId !== entry.target.windowId
                || !['starting', 'complete', 'idle', 'blank', 'suspended'].includes(String(value.status))
                || value.sampleAt !== undefined && (
                  typeof value.sampleAt !== 'number' || !Number.isFinite(value.sampleAt)
                  || value.sampleAt < 0 || value.sampleAt > Date.now() + 1000
                )) {
                throw new CuaError('Invalid native capture heartbeat', 'capture_failed')
              }
              entry.lastMessageAt = Date.now()
              entry.health = {
                status: value.status as CaptureHealth['status'], checkedAt: entry.lastMessageAt,
                ...(value.sampleAt === undefined ? {} : { sampleAt: value.sampleAt as number }),
              }
              continue
            }
            const frame = parseNativeFrame(line, entry.target, entry.dimension)
            if (entry.frame !== null && frame.sequence <= entry.frame.sequence) {
              throw new CuaError('Native capture sequence did not advance', 'capture_failed')
            }
            entry.frame = { ...frame, frameId: `${entry.id}:${frame.sequence}` }
            entry.lastMessageAt = Date.now()
            entry.health = { status: 'complete', checkedAt: entry.lastMessageAt, sampleAt: frame.capturedAt }
            clearTimeout(entry.startupTimer)
          } catch (error) { stopWith(error); return }
        }
        if (pending.length > MAX_LINE_BYTES) stopWith(new Error('Oversized native capture message'))
      })
      child.on('error', (error) => stopWith(new CuaError(
        `DSH Window Capture could not start: ${error.message}. Build the native helper; no screenshot fallback is allowed.`,
        'capture_stopped',
      )))
      child.on('exit', (code, signal) => stopWith(new CuaError(
        `Window recording stopped (${signal ?? code ?? 'unknown'}); reopen the preview to retry`,
        code !== 0 && signal === null ? 'capture_interrupted' : 'capture_stopped',
      )))
      entry.startupTimer = setTimeout(() => stopWith(new CuaError(
        'Window recording produced no frame; check screen recording permission and whether the window is minimized',
        'capture_interrupted',
      )), this.options.startupTimeoutMs ?? 15_000)
      entry.startupTimer.unref?.()
      entry.watchdog = setInterval(() => {
        if (entry.frame !== null && Date.now() - entry.lastMessageAt > 5000) {
          stopWith(new CuaError('Native window stream stopped responding', 'capture_interrupted'))
        }
      }, 1000)
      entry.watchdog.unref?.()
    } catch (error) { stopWith(error) }
  }

  private stop(entry: StreamEntry): void {
    if (entry.stopping) return
    entry.stopping = true
    clearTimeout(entry.startupTimer)
    clearInterval(entry.watchdog)
    const child = entry.child
    if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
    child.stdin.end('stop\n')
    const deadline = setTimeout(() => child.kill('SIGKILL'), 3000)
    deadline.unref?.()
    child.once('exit', () => clearTimeout(deadline))
  }

  release(sessionId: string): void {
    const owner = this.sessions.get(sessionId)
    if (owner === undefined) return
    this.sessions.delete(sessionId)
    const entry = owner.entry
    entry.owners.delete(sessionId)
    if (entry.owners.size === 0) {
      if (this.streams.get(owner.key) === entry) this.streams.delete(owner.key)
      this.stop(entry)
    }
  }

  dispose(): void {
    this.disposed = true
    for (const entry of this.streams.values()) this.stop(entry)
    this.sessions.clear()
    this.streams.clear()
  }
}
