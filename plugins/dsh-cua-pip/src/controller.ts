import { applyCuaEvent, coalesceUsableTarget, isCuaToolName } from './shared/cua-activity.ts'
import { readToolObservation, targetHint } from './shared/tool-observation.ts'
import type { CuaActivity, CuaWindow, CuaWindowBounds, WatchTarget, WindowSize } from './shared/types.ts'
import type { WatcherRegistry } from './watcher.ts'
import { PIP_RUNTIME_VERSION } from './shared/config.ts'
import { ComputerControl, type ControlRequest, type ControlStatus } from './control.ts'
import { ActionBindings } from './action-bindings.ts'
import { PreviewMonitor, type ObservedSample } from './monitor.ts'
import type { RecordingStatus } from './shared/types.ts'
import { isCuaInput } from './shared/cua-tools.ts'

export interface OpenPreview {
  app?: string
  pid?: number
  windowId?: number
  closeAfterSeconds?: number
}

export interface PreviewStatus {
  runtimeVersion: string
  sessionId: string
  open: boolean
  running: boolean
  target: WatchTarget | null
  closeAt: number | null
  /** Actual host close time in Unix milliseconds, cleared by a successful open. */
  closedAt: number | null
  lastFrameAt: number | null
  frames: number
  error: string | null
  windowBounds: CuaWindowBounds | null
  previewSize: WindowSize | null
  control: ControlStatus
  recording: RecordingStatus
  observation: ObservedSample | null
  observationDelivery: 'missing' | 'queued' | 'delivered'
  needsObservation: boolean
}

export interface ResizePreview extends WindowSize {
  resizeTarget?: 'application' | 'preview'
}

export interface ControllerOptions {
  registry: WatcherRegistry
  listWindows(): Promise<CuaWindow[]>
  openApplication(app: string, signal?: AbortSignal): Promise<CuaWindow>
  resizeApplicationWindow?(target: WatchTarget, size: WindowSize, signal?: AbortSignal): Promise<CuaWindow>
  now?: () => number
}

function sameTarget(left: WatchTarget | null | undefined, right: WatchTarget | null | undefined): boolean {
  return left != null && right != null && left.pid === right.pid && left.windowId === right.windowId
}

export function validateResize(input: ResizePreview): void {
  if (['app', 'pid', 'windowId'].some((key) => Object.hasOwn(input, key))) {
    throw new Error('resize uses the currently watched window; use open to select app/pid/windowId first')
  }
  if (input.resizeTarget !== undefined && input.resizeTarget !== 'application' && input.resizeTarget !== 'preview') {
    throw new Error('resizeTarget must be application or preview')
  }
  const minimum = input.resizeTarget === 'preview' ? 64 : 1
  for (const key of ['width', 'height'] as const) {
    const value = input[key]
    if (!Number.isSafeInteger(value) || value < minimum || value > 16_384) {
      throw new Error(`${key} must be an integer between ${minimum} and 16384`)
    }
  }
}

interface PendingCall {
  name: string
  arguments: unknown
  sequence: number
  generation: object
}

export function closeDelayMs(seconds: unknown): number {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0 || seconds > 86_400) {
    throw new Error('closeAfterSeconds must be greater than 0 and at most 86400')
  }
  return Math.max(1, Math.round(seconds * 1000))
}

export function validateOpen(input: OpenPreview): void {
  if (input.app !== undefined && (typeof input.app !== 'string' || input.app.trim() === '')) {
    throw new Error('app must be an application name or bundle id')
  }
  for (const key of ['pid', 'windowId'] as const) {
    const value = input[key]
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`${key} must be a positive integer`)
    }
  }
  if (input.app !== undefined && (input.pid !== undefined || input.windowId !== undefined)) {
    throw new Error('Specify app or pid/windowId, not both')
  }
  if (input.windowId !== undefined && input.pid === undefined) throw new Error('windowId requires pid')
  if (input.closeAfterSeconds !== undefined) closeDelayMs(input.closeAfterSeconds)
}

/** Owns previews independently of React mounts, current conversation, and turns. */
export class PipController {
  readonly control: ComputerControl
  readonly bindings: ActionBindings
  readonly monitor: PreviewMonitor
  private readonly opening = new Map<string, object>()
  private readonly activities = new Map<string, CuaActivity>()
  private readonly generations = new Map<string, object>()
  private readonly sequences = new Map<string, number>()
  private readonly pending = new Map<string, Map<string, PendingCall>>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  // Window mutations finish in request order, even across close/reopen. An old
  // in-flight resize must settle before a newer one touches the same session.
  private readonly resizeQueues = new Map<string, Promise<void>>()
  private readonly windowResizeQueues = new Map<string, Promise<void>>()
  private disposed = false

  constructor(private readonly options: ControllerOptions) {
    this.control = new ComputerControl(options.listWindows, () => this.now())
    this.bindings = new ActionBindings(() => this.now())
    this.monitor = new PreviewMonitor(options.registry, (id) => {
      const activity = this.activities.get(id)
      return { open: activity?.visible === true, openedAt: activity?.openedAt }
    }, () => this.now())
  }

  private now(): number { return (this.options.now ?? Date.now)() }

  private invalidate(sessionId: string): object {
    const generation = {}
    this.generations.set(sessionId, generation)
    this.sequences.delete(sessionId)
    this.pending.delete(sessionId)
    this.opening.delete(sessionId)
    this.monitor.clear(sessionId)
    return generation
  }

  private current(sessionId: string, generation: object): boolean {
    return !this.disposed && this.generations.get(sessionId) === generation
  }

  async open(sessionId: string, input: OpenPreview, signal?: AbortSignal): Promise<PreviewStatus> {
    if (this.disposed) throw new Error('PiP plugin was unloaded')
    validateOpen(input)
    signal?.throwIfAborted()
    this.control.reset(sessionId)
    const generation = this.invalidate(sessionId)
    this.opening.set(sessionId, generation)
    const previous = this.activities.get(sessionId)
    let target: WatchTarget | null = null
    let windowBounds: CuaWindowBounds | undefined
    try {
      if (input.app !== undefined) {
        const window = await this.options.openApplication(input.app.trim(), signal)
        target = { pid: window.pid, windowId: window.windowId }
        windowBounds = { ...window.bounds }
      } else {
        const requested = input.pid !== undefined && input.windowId !== undefined
          ? { pid: input.pid, windowId: input.windowId }
          : input.pid === undefined ? previous?.target : undefined
        const windows = await this.options.listWindows()
        target = coalesceUsableTarget(windows, requested, input.pid)
        windowBounds = windows.find((window) => sameTarget(window, target))?.bounds
      }
      signal?.throwIfAborted()
      if (!this.current(sessionId, generation)) throw new Error('PiP open was superseded or the session was closed')
      if (target === null) throw new Error('No capturable application window found; specify app or a live pid/windowId')
      this.clearTimer(sessionId)
      const now = this.now()
      this.activities.set(sessionId, {
        sessionId,
        visible: true,
        active: true,
        target,
        ...(windowBounds === undefined ? {} : { windowBounds: { ...windowBounds } }),
        ...(previous?.previewSize === undefined ? {} : { previewSize: { ...previous.previewSize } }),
        tool: 'computer_pip',
        turn: previous?.turn ?? 0,
        openedAt: Math.max(now, (previous?.openedAt ?? 0) + 1),
        updatedAt: now,
      })
      this.options.registry.watch(sessionId, target, { retained: true })
      if (input.closeAfterSeconds !== undefined) this.scheduleClose(sessionId, input.closeAfterSeconds)
      return this.status(sessionId)
    } finally {
      if (this.opening.get(sessionId) === generation) this.opening.delete(sessionId)
    }
  }

  actionRefusal(sessionId: string | undefined, name: string, args: unknown): string | undefined {
    const call = this.actionCall(sessionId, name, args)
    name = call.name
    args = call.args
    const resolved = this.bindings.resolve(sessionId, name, args)
    if (resolved.error !== undefined) return resolved.error
    const policy = this.control.refusal(sessionId, name, resolved.args)
    if (policy !== undefined) return policy
    if (sessionId !== undefined && this.opening.has(sessionId) && isCuaInput(name)) {
      return 'pip_not_ready: preview opening is still in progress; wait for it, then call computer_pip(action="observe")'
    }
    return this.monitor.refusal(sessionId, name, resolved.target,
      sessionId !== undefined && this.control.status(sessionId).mode === 'desktop')
  }

  beginAction(sessionId: string, name: string, args: unknown): () => void {
    const reason = this.actionRefusal(sessionId, name, args)
    if (reason !== undefined) throw new Error(reason)
    const call = this.actionCall(sessionId, name, args)
    name = call.name
    args = call.args
    const resolved = this.bindings.resolve(sessionId, name, args)
    return this.monitor.begin(sessionId, name, resolved.target, this.control.status(sessionId).mode === 'desktop')
  }

  private actionCall(sessionId: string | undefined, name: string, args: unknown): { name: string; args: unknown } {
    if (name === 'computer_pip' && sessionId !== undefined && args !== null && typeof args === 'object') {
      const input = args as { action?: unknown; resizeTarget?: unknown }
      if (input.action === 'resize' && input.resizeTarget !== 'preview') {
        const target = this.options.registry.snapshot(sessionId)?.target
        return { name: 'cua_driver_native__set_window_frame', args: { pid: target?.pid, window_id: target?.windowId } }
      }
    }
    return { name, args }
  }

  async setControlMode(sessionId: string, input: ControlRequest, signal?: AbortSignal): Promise<PreviewStatus> {
    await this.control.setMode(sessionId, input, signal)
    return this.status(sessionId)
  }

  async resize(sessionId: string, input: ResizePreview, signal?: AbortSignal): Promise<PreviewStatus> {
    validateResize(input)
    signal?.throwIfAborted()
    const before = this.activities.get(sessionId)
    if (this.disposed || before?.visible !== true) throw new Error('Open a PiP before resizing it')
    const size = { width: input.width, height: input.height }
    if (input.resizeTarget === 'preview') {
      this.activities.set(sessionId, { ...before, previewSize: size, updatedAt: this.now() })
      return this.status(sessionId)
    }

    const resizeWindow = this.options.resizeApplicationWindow
    if (resizeWindow === undefined) throw new Error('Application window resizing is unavailable')
    const target = this.options.registry.snapshot(sessionId)?.target ?? before.target
    if (target === null) throw new Error('No application window is being watched')
    const generation = this.generations.get(sessionId)!
    const assertCurrent = (): void => {
      signal?.throwIfAborted()
      if (!this.current(sessionId, generation)
        || this.activities.get(sessionId)?.visible !== true
        || !sameTarget(this.options.registry.snapshot(sessionId)?.target, target)) {
        throw new Error('PiP was closed or its target changed while resizing; inspect the application before retrying')
      }
    }
    const preceding = this.resizeQueues.get(sessionId) ?? Promise.resolve()
    const windowKey = `${target.pid}:${target.windowId}`
    const precedingWindow = this.windowResizeQueues.get(windowKey) ?? Promise.resolve()
    const operation = Promise.all([preceding, precedingWindow]).then(async () => {
      assertCurrent()
      // An older tool's slow discovery must not retarget this explicitly bound
      // resize after it starts. New computer-use calls may still change target.
      this.sequences.set(sessionId, (this.sequences.get(sessionId) ?? 0) + 1)
      const resized = await resizeWindow(target, size, signal)
      assertCurrent()
      if (!sameTarget(resized, target)) throw new Error('Resize returned a different application window')
      const activity = this.activities.get(sessionId)!
      this.activities.set(sessionId, {
        ...activity, target: { ...target }, windowBounds: { ...resized.bounds }, updatedAt: this.now(),
      })
      // Keep subscribers attached while dropping every old-size capture.
      this.options.registry.refresh(sessionId)
      return this.status(sessionId)
    })
    const settled = operation.then(() => {}, () => {})
    this.resizeQueues.set(sessionId, settled)
    this.windowResizeQueues.set(windowKey, settled)
    void settled.then(() => {
      if (this.resizeQueues.get(sessionId) === settled) this.resizeQueues.delete(sessionId)
      if (this.windowResizeQueues.get(windowKey) === settled) this.windowResizeQueues.delete(windowKey)
    })
    return operation
  }

  scheduleClose(sessionId: string, seconds: number): PreviewStatus {
    const delay = closeDelayMs(seconds)
    const activity = this.activities.get(sessionId)
    if (this.disposed || activity?.visible !== true) throw new Error('Open a PiP before scheduling its close')
    this.clearTimer(sessionId)
    const deadline = this.now() + delay
    this.activities.set(sessionId, { ...activity, closeAt: deadline, updatedAt: this.now() })
    const timer = setTimeout(() => {
      if (this.timers.get(sessionId) !== timer) return
      this.close(sessionId)
    }, delay)
    timer.unref?.()
    this.timers.set(sessionId, timer)
    return this.status(sessionId)
  }

  close(sessionId: string, expectedOpenedAt?: number): PreviewStatus {
    if (expectedOpenedAt !== undefined && this.activities.get(sessionId)?.openedAt !== expectedOpenedAt) {
      return this.status(sessionId)
    }
    this.invalidate(sessionId)
    this.clearTimer(sessionId)
    const activity = this.activities.get(sessionId)
    if (activity?.visible === true) {
      const { closeAt: _deadline, error: _error, ...rest } = activity
      const closedAt = this.now()
      this.activities.set(sessionId, {
        ...rest, visible: false, active: false, tool: null, closedAt, updatedAt: closedAt,
      })
    }
    this.options.registry.unwatch(sessionId)
    return this.status(sessionId)
  }

  remove(sessionId: string): void {
    this.bindings.clear(sessionId)
    this.control.endTurn(sessionId)
    this.close(sessionId)
    this.activities.delete(sessionId)
    this.generations.delete(sessionId)
  }

  sessions(): CuaActivity[] {
    return [...this.activities.values()].map((activity) => {
      const snapshot = this.options.registry.snapshot(activity.sessionId)
      const target = snapshot?.target ?? activity.target
      const windowBounds = snapshot?.frame?.windowBounds
        ?? (sameTarget(activity.target, target) ? activity.windowBounds : undefined)
      const { windowBounds: _oldBounds, ...rest } = activity
      return { ...rest, target, ...(windowBounds === undefined ? {} : { windowBounds }) }
    })
  }

  status(sessionId: string): PreviewStatus {
    const activity = this.activities.get(sessionId)
    const snapshot = this.options.registry.snapshot(sessionId)
    const target = snapshot?.target ?? activity?.target ?? null
    const windowBounds = snapshot?.frame?.windowBounds
      ?? (sameTarget(activity?.target, target) ? activity?.windowBounds : undefined)
    return {
      runtimeVersion: PIP_RUNTIME_VERSION,
      sessionId,
      open: activity?.visible === true,
      running: activity?.active === true,
      target,
      closeAt: activity?.closeAt ?? null,
      closedAt: activity?.closedAt ?? null,
      lastFrameAt: snapshot !== null && snapshot.frames > 0 ? snapshot.updatedAt : null,
      frames: snapshot?.frames ?? 0,
      error: snapshot?.error ?? activity?.error ?? null,
      windowBounds: windowBounds === undefined ? null : { ...windowBounds },
      previewSize: activity?.previewSize === undefined ? null : { ...activity.previewSize },
      control: this.control.status(sessionId),
      ...this.monitor.summary(sessionId),
    }
  }

  /** Called for every session event; unrelated events do not invoke the driver. */
  ingest(sessionId: string, event: unknown): void {
    if ((event as { type?: unknown })?.type === 'turn/end') {
      this.control.endTurn(sessionId)
      this.bindings.clear(sessionId)
      this.monitor.clear(sessionId)
    }
    const before = this.activities.get(sessionId)
    if (this.disposed || before?.visible !== true) return
    const next = applyCuaEvent(before, sessionId, event, this.now())!
    this.activities.set(sessionId, next)
    const observation = readToolObservation(event)
    if (observation === undefined) {
      if ((event as { type?: unknown })?.type === 'turn/end') this.pending.delete(sessionId)
      return
    }
    const generation = this.generations.get(sessionId)!
    const calls = this.pending.get(sessionId) ?? new Map<string, PendingCall>()
    const prior = observation.callId !== undefined ? calls.get(observation.callId) : undefined
    const name = observation.name ?? prior?.name
    if (name === undefined || !isCuaToolName(name)) return
    if (observation.phase === 'result') {
      if (observation.callId !== undefined) calls.delete(observation.callId)
      if (prior === undefined || (
        prior.generation !== generation || prior.sequence !== this.sequences.get(sessionId)
      )) return
      if (observation.failed) return
    }
    const sequence = (this.sequences.get(sessionId) ?? 0) + 1
    this.sequences.set(sessionId, sequence)
    if (observation.phase === 'call' && observation.callId !== undefined) {
      calls.set(observation.callId, { name, arguments: observation.arguments, sequence, generation })
      this.pending.set(sessionId, calls)
    }
    const args = observation.arguments ?? prior?.arguments
    const resolved = this.bindings.resolve(sessionId, name, args)
    const hint = targetHint(observation.result)
      ?? (resolved.target === undefined ? isCuaInput(name) ? undefined : targetHint(args)
        : { target: resolved.target, pid: resolved.target.pid })
    if (hint === undefined) return
    void this.resolveTarget(sessionId, generation, sequence, hint)
  }

  private async resolveTarget(
    sessionId: string,
    generation: object,
    sequence: number,
    hint: { target?: WatchTarget; pid?: number },
  ): Promise<void> {
    const fresh = (): boolean => this.current(sessionId, generation)
      && this.sequences.get(sessionId) === sequence
      && this.activities.get(sessionId)?.visible === true
    try {
      const windows = await this.options.listWindows()
      if (!fresh()) return
      const target = coalesceUsableTarget(windows, hint.target, hint.pid)
      if (target === null) return
      const activity = this.activities.get(sessionId)!
      const { error: _error, ...rest } = activity
      const windowBounds = windows.find((window) => sameTarget(window, target))?.bounds
      this.activities.set(sessionId, { ...rest, target, windowBounds, updatedAt: this.now() })
      this.options.registry.watch(sessionId, target, { retained: true, restartStopped: false })
    } catch {
      // Keep the selected target and frame during transient discovery failures.
    }
  }

  private clearTimer(sessionId: string): void {
    const timer = this.timers.get(sessionId)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(sessionId)
  }

  dispose(): void {
    this.disposed = true
    for (const id of this.timers.keys()) this.clearTimer(id)
    this.options.registry.dispose()
    this.control.dispose()
    this.bindings.clear()
    this.monitor.clear()
    this.opening.clear()
    this.activities.clear()
    this.generations.clear()
    this.pending.clear()
    this.sequences.clear()
    this.resizeQueues.clear()
    this.windowResizeQueues.clear()
  }
}
