// Per-session window watchers.
//
// Open sessions retain their watcher independently of the visible client.
// Temporary watchers expire after `idleTtlMs`. One shared scheduler rotates
// through due sessions while bounding concurrent driver requests. Displays
// subscribe to fresh frames; undisplayed sessions keep a background cadence.
// When a target window dies, its watcher rebinds to the pid's current window.

import { CuaError } from './cua.ts'
import { isHijackCapture, pickRebindCandidate } from './shared/cua-activity.ts'
import { recordingStatus, sampleAfter } from './shared/recording-state.ts'
import type { CaptureHealth, CuaWindow, Frame, WatcherSnapshot, WatchTarget } from './shared/types.ts'

export type { WatcherSnapshot } from './shared/types.ts'
export const CAPTURE_RETRY_DELAYS_MS = [500, 1500] as const

export interface WatcherOptions {
  fps: number
  /** Cadence when no client is subscribed; defaults to fps. */
  backgroundFps?: number
  maxDimension: number
  idleTtlMs: number
  /** Capture concurrency and cache limit; retained sessions are never evicted. */
  maxWatchers: number
  capture: (target: WatchTarget, maxDimension: number, sessionId: string) => Promise<Frame | null>
  release?: (sessionId: string) => void
  captureHealth?: (sessionId: string) => CaptureHealth | undefined
  listWindows: () => Promise<CuaWindow[]>
  now?: () => number
  /** Test hook: when false no timer is started; drive ticks manually. */
  autoStart?: boolean
}

export interface WatchOptions {
  /** Keep capturing until the owning session or PiP explicitly releases it. */
  retained?: boolean
  /** Automatic tool following must not restart a recording the user stopped. */
  restartStopped?: boolean
}

export type WatcherListener = (state: WatcherSnapshot | null) => void

/** Idle reaping rule, exported for tests. */
export function shouldReap(lastFetchAt: number, now: number, idleTtlMs: number): boolean {
  return now - lastFetchAt > idleTtlMs
}

/** Session id of the least-recently-fetched watcher — the eviction victim. */
export function evictionCandidate(entries: ReadonlyArray<readonly [string, number]>): string | undefined {
  let victim: string | undefined
  let oldest = Infinity
  for (const [sessionId, lastFetchAt] of entries) {
    if (lastFetchAt < oldest) {
      oldest = lastFetchAt
      victim = sessionId
    }
  }
  return victim
}

class Watcher {
  target: WatchTarget
  retained = false
  frame: Frame | null = null
  error: string | null = null
  frames = 0
  updatedAt = 0
  lastFetchAt: number
  revision = 0
  private lastCaptureAt: number | null = null
  private captureRequested = true
  private inflight = false
  private paused = false
  private stopped = false
  private generation = 0
  private health: CaptureHealth | undefined
  private phase: 'starting' | 'ready' | 'recovering' | 'paused' | 'failed' = 'starting'
  private retryCount = 0
  private nextRetryAt: number | null = null
  private errorCode: string | null = null

  constructor(
    readonly sessionId: string,
    target: WatchTarget,
    private readonly opts: WatcherOptions,
    private readonly onChange: (watcher: Watcher) => void,
  ) {
    this.target = { ...target }
    this.lastFetchAt = this.now()
  }

  private now(): number {
    return (this.opts.now ?? Date.now)()
  }

  get canCapture(): boolean {
    return !this.stopped && !this.inflight && !this.paused
  }

  stop(): void {
    this.stopped = true
    this.generation += 1
    this.frame = null
    this.opts.release?.(this.sessionId)
  }

  private changed(): void {
    this.revision += 1
    this.onChange(this)
  }

  retarget(target: WatchTarget, restartStopped = true): void {
    if (this.paused && !restartStopped) return
    const targetChanged = this.target.pid !== target.pid || this.target.windowId !== target.windowId
    const wasPaused = this.paused
    const explicitRestart = restartStopped && this.error !== null
    if (!targetChanged && !wasPaused && !explicitRestart) return
    if (targetChanged || wasPaused || explicitRestart) {
      this.generation += 1
      this.opts.release?.(this.sessionId)
      this.target = { ...target }
      this.clearFrame()
    }
    this.error = null
    this.errorCode = null
    this.paused = false
    this.phase = 'starting'
    this.retryCount = 0
    this.nextRetryAt = null
    this.requestCapture()
    this.changed()
  }

  refresh(): void {
    // Resize is not permission to restart a stream the system/user stopped.
    if (this.paused) return
    this.generation += 1
    this.opts.release?.(this.sessionId)
    this.clearFrame()
    this.error = null
    this.errorCode = null
    this.phase = 'starting'
    this.nextRetryAt = null
    this.paused = false
    this.requestCapture()
    this.changed()
  }

  requestCapture(): void {
    this.captureRequested = true
  }

  nextCaptureAt(interval: number): number {
    return Math.max(this.nextRetryAt ?? 0, this.captureRequested || this.lastCaptureAt === null ? 0 : this.lastCaptureAt + interval)
  }

  touch(): void {
    this.lastFetchAt = this.now()
  }

  async tick(): Promise<void> {
    if (!this.canCapture || this.nextRetryAt !== null && this.now() < this.nextRetryAt) return
    this.nextRetryAt = null
    this.inflight = true
    this.captureRequested = false
    this.lastCaptureAt = this.now()
    const generation = this.generation
    const target = { ...this.target }
    try {
      const frame = await this.opts.capture(target, this.opts.maxDimension, this.sessionId)
      if (!this.isCurrent(generation)) return
      const health = this.opts.captureHealth?.(this.sessionId)
      const healthChanged = health?.checkedAt !== this.health?.checkedAt || health?.status !== this.health?.status
        || health?.sampleAt !== this.health?.sampleAt
      this.health = health
      if (frame === null) {
        if (healthChanged) this.changed()
        return
      }
      if (isHijackCapture(frame.appName, frame.windowTitle)) {
        this.clearFrame()
        this.pause('skipped system capture overlay', 'capture_stopped')
        return
      }
      this.frame = frame
      this.error = null
      this.errorCode = null
      this.phase = 'ready'
      this.frames += 1
      this.updatedAt = frame.capturedAt ?? this.now()
      this.changed()
    } catch (error) {
      if (!this.isCurrent(generation)) return
      if (error instanceof CuaError && ['window_gone', 'capture_interrupted'].includes(error.code)) {
        this.clearFrame()
        this.phase = 'recovering'
        this.error = error.message
        this.errorCode = error.code
        this.changed()
        await this.recover(error.message, generation, target)
      } else {
        this.error = error instanceof Error ? error.message : String(error)
        this.errorCode = error instanceof CuaError ? error.code : 'capture_failed'
        if (error instanceof CuaError && ['permission_denied', 'capture_stopped'].includes(error.code)) {
          this.clearFrame()
          this.pause(this.error, error.code)
        } else {
          this.changed()
        }
      }
    } finally {
      this.inflight = false
    }
  }

  private isCurrent(generation: number): boolean {
    return !this.stopped && this.generation === generation
  }

  private clearFrame(): void {
    this.frame = null
    this.frames = 0
    this.updatedAt = 0
    this.health = undefined
  }

  private pause(message: string, code: string, exhausted = false): void {
    this.paused = true
    this.phase = exhausted ? 'failed' : 'paused'
    this.error = message
    this.errorCode = code
    this.nextRetryAt = null
    this.opts.release?.(this.sessionId)
    this.changed()
  }

  private async recover(cause: string, generation: number, target: WatchTarget): Promise<void> {
    if (!this.isCurrent(generation)) return
    if (this.retryCount >= CAPTURE_RETRY_DELAYS_MS.length) {
      this.pause(`Capture recovery exhausted: ${cause}`, 'recovery_exhausted', true)
      return
    }
    let candidate: CuaWindow | undefined
    try {
      const windows = await this.opts.listWindows()
      if (!this.isCurrent(generation)) return
      candidate = windows.find((window) => window.pid === target.pid && window.windowId === target.windowId
        && !isHijackCapture(window.appName, window.title)) ?? pickRebindCandidate(windows, target.pid)
      if (candidate === undefined) {
        this.error = `target window is gone and no other window exists for pid ${target.pid}`
      }
    } catch {
      if (!this.isCurrent(generation)) return
      this.error = cause
    }
    if (!this.isCurrent(generation)) return
    // Releasing is required even if discovery confirms the SAME window: the
    // previous source can retain a terminal failure under its unchanged key.
    this.opts.release?.(this.sessionId)
    this.generation += 1
    if (candidate !== undefined) this.target = { pid: candidate.pid, windowId: candidate.windowId }
    this.nextRetryAt = this.now() + CAPTURE_RETRY_DELAYS_MS[this.retryCount]!
    this.retryCount += 1
    this.phase = 'recovering'
    this.requestCapture()
    this.changed()
  }

  snapshot(): WatcherSnapshot {
    return {
      sessionId: this.sessionId,
      target: { ...this.target },
      frames: this.frames,
      updatedAt: this.updatedAt,
      lastFetchAt: this.lastFetchAt,
      error: this.error,
      frame: this.frame,
      ...(this.health === undefined ? {} : { captureHealth: this.health }),
      captureLifecycle: {
        phase: this.phase, generation: this.generation, retryCount: this.retryCount,
        nextRetryAt: this.nextRetryAt, errorCode: this.errorCode,
      },
    }
  }
}

export class WatcherRegistry {
  private readonly watchers = new Map<string, Watcher>()
  private readonly listeners = new Map<string, Set<WatcherListener>>()
  private readonly captureLimit: number
  private activeCaptures = 0
  private nextIndex = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private scheduledAt: number | null = null
  private disposed = false

  constructor(private readonly opts: WatcherOptions) {
    this.captureLimit = Number.isFinite(opts.maxWatchers)
      ? Math.max(1, Math.floor(opts.maxWatchers))
      : 1
  }

  get size(): number {
    return this.watchers.size
  }

  watch(sessionId: string, target: WatchTarget, options: WatchOptions = {}): WatcherSnapshot {
    if (this.disposed) throw new Error('PiP watcher registry was disposed')
    const existing = this.watchers.get(sessionId)
    if (existing !== undefined) {
      existing.retarget(target, options.restartStopped)
      if (options.retained !== undefined) existing.retained = options.retained
      existing.touch()
      this.schedule()
      return existing.snapshot()
    }
    while (this.watchers.size >= this.captureLimit) {
      const victim = evictionCandidate(
        [...this.watchers.entries()]
          .filter(([, watcher]) => !watcher.retained)
          .map(([id, watcher]) => [id, watcher.lastFetchAt] as const),
      )
      if (victim === undefined) break
      this.unwatch(victim)
    }
    const watcher = new Watcher(sessionId, target, this.opts, (current) => this.publish(current.sessionId, current))
    watcher.retained = options.retained ?? false
    this.watchers.set(sessionId, watcher)
    this.publish(sessionId, watcher)
    this.schedule()
    return watcher.snapshot()
  }

  /** Retain an existing watcher for a session, or return it to idle expiry. */
  retain(sessionId: string, retained = true): boolean {
    const watcher = this.watchers.get(sessionId)
    if (watcher === undefined) return false
    watcher.retained = retained
    watcher.touch()
    this.schedule()
    return true
  }

  unwatch(sessionId: string): boolean {
    const watcher = this.watchers.get(sessionId)
    if (watcher === undefined) return false
    watcher.stop()
    this.watchers.delete(sessionId)
    this.publish(sessionId, null)
    this.schedule()
    return true
  }

  /** Pull the latest frame; counts as activity that keeps the watcher alive. */
  touch(sessionId: string): WatcherSnapshot | null {
    const watcher = this.watchers.get(sessionId)
    if (watcher === undefined) return null
    watcher.touch()
    this.schedule()
    return watcher.snapshot()
  }

  snapshot(sessionId: string): WatcherSnapshot | null {
    return this.watchers.get(sessionId)?.snapshot() ?? null
  }

  /** Bounded observation wait; never opens or restarts a user-stopped watch. */
  waitForReady(sessionId: string, signal?: AbortSignal, after = -Infinity, timeoutMs = 10_000): Promise<WatcherSnapshot | null> {
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
      let settled = false
      let unsubscribe: (() => void) | undefined
      const cleanup = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        unsubscribe?.()
      }
      const finish = (state: WatcherSnapshot | null) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(state)
      }
      const abort = () => {
        if (settled) return
        settled = true
        cleanup()
        reject(signal?.reason ?? new Error('Observation cancelled'))
      }
      const timer = setTimeout(() => finish(this.snapshot(sessionId)), timeoutMs)
      signal?.addEventListener('abort', abort, { once: true })
      unsubscribe = this.subscribe(sessionId, (state) => {
        const status = recordingStatus(state, this.now())
        if (state === null || ['failed', 'stopped'].includes(status.state)
          || status.ready && sampleAfter(state, after)) finish(state)
      })
      if (settled) unsubscribe()
      else if (signal?.aborted) abort()
    })
  }

  /** A display subscription never opens, recreates, or owns a watcher. */
  subscribe(sessionId: string, listener: WatcherListener): () => void {
    if (this.disposed) {
      this.notify(listener, null)
      return () => {}
    }
    const listeners = this.listeners.get(sessionId) ?? new Set<WatcherListener>()
    listeners.add(listener)
    this.listeners.set(sessionId, listeners)
    const watcher = this.watchers.get(sessionId)
    watcher?.touch()
    watcher?.requestCapture()
    this.notify(listener, watcher?.snapshot() ?? null)
    this.schedule()
    return () => {
      if (!listeners.delete(listener)) return
      if (listeners.size === 0 && this.listeners.get(sessionId) === listeners) {
        this.listeners.delete(sessionId)
        // An active display counts as a reader. Start its idle TTL when the
        // final display disconnects, instead of reaping it immediately.
        this.watchers.get(sessionId)?.touch()
      }
      this.schedule()
    }
  }

  /** Invalidate old-size frames while keeping display subscriptions alive. */
  refresh(sessionId: string): boolean {
    const watcher = this.watchers.get(sessionId)
    if (watcher === undefined) return false
    watcher.refresh()
    this.schedule()
    return true
  }

  private notify(listener: WatcherListener, state: WatcherSnapshot | null): void {
    try {
      listener(state)
    } catch {
      // A disconnected display must not fail capture or other subscribers.
    }
  }

  private publish(sessionId: string, watcher: Watcher | null): void {
    if ((this.watchers.get(sessionId) ?? null) !== watcher) return
    const listeners = this.listeners.get(sessionId)
    if (listeners === undefined) return
    const revision = watcher?.revision
    const snapshot = watcher?.snapshot() ?? null
    for (const listener of [...listeners]) {
      // A listener can synchronously close or retarget the preview. Nested
      // publications take precedence over the state that triggered them.
      if ((this.watchers.get(sessionId) ?? null) !== watcher || watcher?.revision !== revision) return
      if (listeners.has(listener)) this.notify(listener, snapshot)
    }
  }

  private hasSubscribers(sessionId: string): boolean {
    return (this.listeners.get(sessionId)?.size ?? 0) > 0
  }

  private now(): number {
    return (this.opts.now ?? Date.now)()
  }

  private interval(watcher: Watcher): number {
    const requested = this.hasSubscribers(watcher.sessionId) ? this.opts.fps : this.opts.backgroundFps ?? this.opts.fps
    const fps = Number.isFinite(requested) && requested > 0 ? requested : 1
    return Math.max(1, 1000 / fps)
  }

  /** Test hook: capture one session, or drive one round-robin scheduler tick. */
  async tickNow(sessionId?: string): Promise<void> {
    await this.tick(true, sessionId)
  }

  private async tick(force: boolean, sessionId?: string): Promise<void> {
    if (this.disposed) return
    const now = this.now()
    for (const [id, watcher] of this.watchers) {
      if (!watcher.retained && !this.hasSubscribers(id) && shouldReap(watcher.lastFetchAt, now, this.opts.idleTtlMs)) {
        this.unwatch(id)
      }
    }
    if (this.activeCaptures >= this.captureLimit) return
    if (sessionId !== undefined) {
      const watcher = this.watchers.get(sessionId)
      if (watcher?.canCapture) await this.capture(watcher)
      return
    }
    const watchers = [...this.watchers.values()]
    if (watchers.length === 0) return
    const start = this.nextIndex % watchers.length
    const captures: Promise<void>[] = []
    let visited = 0
    while (visited < watchers.length && this.activeCaptures < this.captureLimit) {
      const watcher = watchers[(start + visited) % watchers.length]
      visited += 1
      if (watcher.canCapture && (force || watcher.nextCaptureAt(this.interval(watcher)) <= now)) {
        captures.push(this.capture(watcher))
      }
    }
    this.nextIndex = (start + visited) % watchers.length
    this.schedule()
    await Promise.all(captures)
  }

  private async capture(watcher: Watcher): Promise<void> {
    this.activeCaptures += 1
    try {
      await watcher.tick()
    } finally {
      this.activeCaptures -= 1
      this.schedule()
    }
  }

  private schedule(): void {
    if (this.opts.autoStart === false || this.disposed) return
    const now = this.now()
    let deadline = Infinity
    for (const watcher of this.watchers.values()) {
      if (!watcher.retained && !this.hasSubscribers(watcher.sessionId)) {
        deadline = Math.min(deadline, watcher.lastFetchAt + this.opts.idleTtlMs + 1)
      }
      if (this.activeCaptures < this.captureLimit && watcher.canCapture) {
        deadline = Math.min(deadline, watcher.nextCaptureAt(this.interval(watcher)))
      }
    }
    if (!Number.isFinite(deadline)) {
      this.stop()
      return
    }
    deadline = Math.max(now, deadline)
    if (this.timer !== null && this.scheduledAt === deadline) return
    this.stop()
    this.scheduledAt = deadline
    this.timer = setTimeout(() => {
      this.timer = null
      this.scheduledAt = null
      void this.tick(false)
    }, Math.ceil(deadline - now))
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  private stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.scheduledAt = null
  }

  dispose(): void {
    this.disposed = true
    this.stop()
    for (const watcher of this.watchers.values()) watcher.stop()
    this.watchers.clear()
    for (const sessionId of this.listeners.keys()) this.publish(sessionId, null)
    this.listeners.clear()
    this.nextIndex = 0
  }
}
