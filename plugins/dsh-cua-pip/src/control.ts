import { backgroundRefusal } from './background-policy.ts'
import { isHijackCapture } from './shared/cua-activity.ts'
import type { CuaWindow, WatchTarget } from './shared/types.ts'

export const DESKTOP_FALLBACK_TTL_MS = 5 * 60_000

export interface ControlRequest {
  controlMode: 'background' | 'desktop'
  controlScope?: 'window' | 'desktop'
  pid?: number
  windowId?: number
  reason?: string
}

export interface ControlStatus {
  mode: 'background' | 'desktop'
  scope: 'window' | 'desktop' | null
  target: WatchTarget | null
  reason: string | null
  expiresAt: number | null
}

interface DesktopLease {
  sessionId: string
  scope: 'window' | 'desktop'
  target: WatchTarget | null
  reason: string
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
}

/** One declared foreground fallback at a time; recording ownership is separate. */
export class ComputerControl {
  private lease: DesktopLease | undefined
  private readonly pending = new Map<string, object>()
  private readonly turns = new Map<string, { signal: AbortSignal; detach(): void }>()
  private disposed = false

  constructor(
    private readonly listWindows: () => Promise<CuaWindow[]>,
    private readonly now: () => number = Date.now,
  ) {}

  status(sessionId: string): ControlStatus {
    this.expire()
    const lease = this.lease
    if (lease?.sessionId !== sessionId) return { mode: 'background', scope: null, target: null, reason: null, expiresAt: null }
    return { mode: 'desktop', scope: lease.scope, target: lease.target === null ? null : { ...lease.target }, reason: lease.reason, expiresAt: lease.expiresAt }
  }

  /** Bind the authoritative turn signal, not run_code's shorter subcall signal. */
  bindTurn(sessionId: string, signal: AbortSignal): void {
    if (this.disposed || this.turns.get(sessionId)?.signal === signal) return
    this.endTurn(sessionId)
    if (signal.aborted) return
    const abort = () => this.endTurn(sessionId)
    signal.addEventListener('abort', abort, { once: true })
    this.turns.set(sessionId, { signal, detach: () => signal.removeEventListener('abort', abort) })
  }

  async setMode(sessionId: string, input: ControlRequest, signal?: AbortSignal): Promise<ControlStatus> {
    if (this.disposed) throw new Error('Computer control was unloaded')
    signal?.throwIfAborted()
    if (input.controlMode === 'background') {
      this.reset(sessionId)
      return this.status(sessionId)
    }
    if (input.controlMode !== 'desktop') throw new Error('controlMode must be background or desktop')
    const scope = input.controlScope ?? 'window'
    if (scope !== 'window' && scope !== 'desktop') throw new Error('controlScope must be window or desktop')
    if (scope === 'desktop' && (input.pid !== undefined || input.windowId !== undefined)) {
      throw new Error('Desktop-surface control cannot mix window identifiers; omit pid and windowId')
    }
    if (scope === 'window' && (!Number.isSafeInteger(input.pid) || input.pid! <= 0
      || !Number.isSafeInteger(input.windowId) || input.windowId! <= 0)) {
      throw new Error('Desktop fallback requires an exact positive pid and windowId')
    }
    if (typeof input.reason !== 'string' || input.reason.trim() === '' || input.reason.length > 1000) {
      throw new Error('Desktop fallback requires a reason (1-1000 characters) describing the unavailable or ineffective background route')
    }
    const target = scope === 'window' ? { pid: input.pid!, windowId: input.windowId! } : null
    const reason = input.reason.trim()
    this.assertAvailable(sessionId)
    const request = {}
    this.pending.set(sessionId, request)
    try {
      const windows = target === null ? [] : await this.listWindows()
      signal?.throwIfAborted()
      this.turns.get(sessionId)?.signal.throwIfAborted()
      if (this.disposed || this.pending.get(sessionId) !== request) {
        throw new Error('Desktop fallback was cancelled or superseded')
      }
      this.assertAvailable(sessionId)
      if (target !== null) {
        const window = windows.find((candidate) => candidate.pid === target.pid && candidate.windowId === target.windowId)
        if (window === undefined || isHijackCapture(window.appName, window.title)) {
          throw new Error('Desktop fallback target is no longer available; obtain a fresh window observation')
        }
      }
      this.clearLease()
      const expiresAt = this.now() + DESKTOP_FALLBACK_TTL_MS
      const lease: DesktopLease = {
        sessionId, scope, target, reason, expiresAt,
        timer: setTimeout(() => {
          if (this.lease === lease) this.clearLease()
        }, DESKTOP_FALLBACK_TTL_MS),
      }
      lease.timer.unref?.()
      this.lease = lease
      return this.status(sessionId)
    } finally {
      if (this.pending.get(sessionId) === request) this.pending.delete(sessionId)
    }
  }

  refusal(sessionId: string | undefined, name: string, args: unknown): string | undefined {
    const status = sessionId === undefined ? undefined : this.status(sessionId)
    const target = status?.mode !== 'desktop' ? undefined : status.target ?? 'desktop'
    return backgroundRefusal(name, args, target)
  }

  sessionIds(): string[] {
    this.expire()
    return [...new Set([
      ...this.pending.keys(), ...this.turns.keys(),
      ...(this.lease === undefined ? [] : [this.lease.sessionId]),
    ])]
  }

  reset(sessionId: string): void {
    this.pending.delete(sessionId)
    if (this.lease?.sessionId === sessionId) this.clearLease()
  }

  endTurn(sessionId: string): void {
    this.reset(sessionId)
    this.turns.get(sessionId)?.detach()
    this.turns.delete(sessionId)
  }

  private assertAvailable(sessionId: string): void {
    this.expire()
    if (this.lease !== undefined && this.lease.sessionId !== sessionId) {
      throw new Error('Another session is using desktop fallback; wait for it to release control')
    }
  }

  private expire(): void {
    if (this.lease !== undefined && this.now() >= this.lease.expiresAt) this.clearLease()
  }

  private clearLease(): void {
    clearTimeout(this.lease?.timer)
    this.lease = undefined
  }

  dispose(): void {
    this.disposed = true
    this.clearLease()
    this.pending.clear()
    for (const turn of this.turns.values()) turn.detach()
    this.turns.clear()
  }
}
