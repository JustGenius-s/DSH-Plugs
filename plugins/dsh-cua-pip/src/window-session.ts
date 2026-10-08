import { randomUUID } from 'node:crypto'
import type { UserMessage } from '@just-genius/dsh-plugin-runtime/host'
import type { PipController, OpenPreview } from './controller.ts'
import type { MonitorObservation } from './monitor.ts'
import type { CuaWindow, Frame, WatchTarget } from './shared/types.ts'
import type { WatcherRegistry } from './watcher.ts'
import { recordingStatus } from './shared/recording-state.ts'
import { cuaTool, isCuaInput } from './shared/cua-tools.ts'
import { actionDelivery, actionOutcome, parseWindowAX, planWindowSteps, projectAX, row, sameBounds, type WindowAX, type WindowStep } from './window-observation.ts'
import type { WindowDriver, WindowExecution } from './window-driver.ts'

interface Observation {
  id: string
  native: MonitorObservation
  ax: WindowAX
  axAt: number
  skewMs: number
}
interface BatchResult {
  targetId: string
  target: WatchTarget
  requestedSteps: number
  results: { index: number; operation: string; targeting: string; outcome: string; backend: string | null; error: string | null }[]
  stoppedReason: string | null
}
interface Binding {
  id: string
  target: WatchTarget
  openedAt: number
  stateTool: string
  axVersion: number
  observation: Observation | null
  batch: BatchResult | null
}
const key = (target: WatchTarget) => `${target.pid}:${target.windowId}`

export interface WindowSessionOptions {
  controller: PipController
  registry: WatcherRegistry
  driver: Pick<WindowDriver, 'select' | 'name' | 'call'>
  listWindows(): Promise<CuaWindow[]>
  saveImage(frame: Frame, metadata: string): Promise<UserMessage>
  now?: () => number
}

/** One target handle and one observed AX/image pair per owning conversation. */
export class WindowSessions {
  private readonly bindings = new Map<string, Binding>()
  private readonly busy = new Set<string>()
  private readonly locks = new Map<string, string>()
  constructor(private readonly options: WindowSessionOptions) {}
  private now() { return (this.options.now ?? Date.now)() }

  private owner(exec: WindowExecution): string {
    if (exec.agent === undefined) throw new Error('computer_window requires a calling session')
    exec.signal.throwIfAborted()
    return String(exec.agent.session.id)
  }

  private current(sessionId: string, targetId?: string): Binding {
    const binding = this.bindings.get(sessionId)
    const activity = this.options.controller.sessions().find((item) => item.sessionId === sessionId)
    if (binding === undefined || targetId !== undefined && binding.id !== targetId
      || activity?.visible !== true || binding.openedAt !== activity.openedAt
      || activity.target === null || key(binding.target) !== key(activity.target)) {
      throw new Error('window_binding_stale: bind the exact window again; handles cannot cross sessions, reopen or retarget')
    }
    return binding
  }

  private enter(sessionId: string): () => void {
    if (this.busy.has(sessionId)) throw new Error('window_operation_in_flight: finish the current bound-window operation')
    this.busy.add(sessionId)
    return () => { this.busy.delete(sessionId) }
  }

  async bind(input: OpenPreview, exec: WindowExecution) {
    const sessionId = this.owner(exec), leave = this.enter(sessionId)
    try {
      const stateTool = this.options.driver.select(exec)
      const status = await this.options.controller.open(sessionId, input, exec.signal)
      const activity = this.options.controller.sessions().find((item) => item.sessionId === sessionId)!
      if (status.target === null || activity.openedAt === undefined) throw new Error('window_binding_unavailable')
      this.bindings.set(sessionId, {
        id: randomUUID(), target: { ...status.target }, openedAt: activity.openedAt, stateTool, axVersion: 0, observation: null, batch: null,
      })
      return this.status(sessionId)
    } finally { leave() }
  }

  status(sessionId: string) {
    const preview = this.options.controller.status(sessionId)
    const batch = this.bindings.get(sessionId)?.batch
    let binding: Binding | undefined
    try { binding = this.current(sessionId) } catch {}
    const observation = binding?.observation
    const usable = observation !== undefined && observation !== null
      && observation.native.sample.generation === preview.recording.generation
      && preview.observation?.observedAt === observation.native.sample.observedAt
      && preview.observation.frameId === observation.native.sample.frameId
    return {
      status: binding === undefined ? 'unbound' : !preview.recording.ready ? 'not_ready'
        : !usable ? 'needs_observation' : !this.options.controller.monitor.isDelivered(observation.native) ? 'queued'
          : observation.ax.snapshotId === null || observation.ax.routes.accessibility !== 'available' ? 'observed_read_only' : 'ready',
      targetId: binding?.id ?? null, target: binding === undefined ? null : { ...binding.target },
      provider: binding === undefined ? null : cuaTool(binding.stateTool)?.provider ?? null,
      recording: { ...preview.recording }, error: preview.error,
      observation: !usable ? null : {
        observationId: observation.id, ...observation.native.sample,
        imageWidth: observation.native.frame.width, imageHeight: observation.native.frame.height,
        coordinates: 'native-pip-image-pixels', axAt: observation.axAt, skewMs: observation.skewMs,
        ...projectAX(observation.ax),
      },
      capabilities: {
        ax: usable ? observation.ax.routes.accessibility : 'unknown',
        visualClick: usable && observation.ax.snapshotId !== null && observation.ax.routes.accessibility === 'available' && observation.skewMs <= 2000
          ? 'ax-hit-test-only' : 'unavailable',
        keyboard: usable ? observation.ax.routes.pid_keyboard : 'unknown',
        routeReasons: usable ? { ...observation.ax.reasons } : null,
        rawPointer: 'unavailable', drag: 'unavailable',
        reason: 'Raw Cua pixel delivery may activate the application; this adapter never selects that path.',
      },
      batch: batch == null ? null : { ...batch, target: { ...batch.target }, results: batch.results.map((result) => ({ ...result })) },
    }
  }

  async observe(targetId: string, exec: WindowExecution) {
    const sessionId = this.owner(exec), leave = this.enter(sessionId)
    try { return await this.observeBound(sessionId, this.current(sessionId, targetId), exec) }
    finally { leave() }
  }

  private async observeBound(sessionId: string, binding: Binding, exec: WindowExecution) {
    binding.observation = null
    this.options.controller.monitor.rejectObservation(sessionId)
    const first = await this.options.controller.monitor.observe(sessionId, exec.signal)
    if (first === null) return this.status(sessionId)
    const result = await this.options.driver.call(binding.stateTool, {
      pid: binding.target.pid, window_id: binding.target.windowId,
      include_screenshot: false, include_accessibility_tree: true,
    }, exec)
    if (result.isError) throw new Error(`window_ax_failed: ${result.error.message}`)
    const axAt = this.now(), ax = parseWindowAX(result.value, binding.target), axVersion = binding.axVersion
    if (result.concludesTurn) throw new Error('window_observation_stopped: provider concluded the turn')
    const native = await this.options.controller.monitor.observe(sessionId, exec.signal)
    if (native === null) return this.status(sessionId)
    if (this.current(sessionId, binding.id) !== binding || native.sample.generation !== first.sample.generation
      || binding.axVersion !== axVersion) {
      throw new Error('window_observation_superseded: the recording restarted during AX observation')
    }
    await this.validateGeometry(binding, native.frame, exec)
    const observation: Observation = {
      id: randomUUID(), native, ax, axAt, skewMs: Math.abs(axAt - native.sample.capturedAt),
    }
    const context = await this.options.saveImage(native.frame, JSON.stringify({
      targetId: binding.id, target: binding.target, observationId: observation.id, ...native.sample,
      width: native.frame.width, height: native.frame.height, axAt, skewMs: observation.skewMs,
      ax: projectAX(ax), batch: binding.batch,
      coordinates: 'Use only computer_window with this targetId/observationId. Not raw Cua or desktop coordinates.',
    }))
    exec.signal.throwIfAborted()
    this.current(sessionId, binding.id)
    if (binding.axVersion !== axVersion) throw new Error('window_observation_superseded: AX changed while saving the image')
    const image = context.content.find((part) => part.type === 'image')
    if (image === undefined) throw new Error('window_image_delivery_failed')
    exec.deferContext(context)
    this.options.controller.monitor.acknowledge(native, { messageId: context.id, attachmentId: image.attachment.attachmentId })
    binding.observation = observation
    return this.status(sessionId)
  }

  private async validateGeometry(binding: Binding, frame: Frame, exec: WindowExecution): Promise<void> {
    exec.signal.throwIfAborted()
    const windows = await this.options.listWindows()
    exec.signal.throwIfAborted()
    const exact = windows.find((window) => key(window) === key(binding.target))
    if (exact === undefined || !sameBounds(exact.bounds, frame.windowBounds)) {
      throw new Error('window_geometry_changed: observe the exact window again before acting')
    }
  }

  /** Other sessions cannot mutate a window in an active bound batch. */
  refusal(sessionId: string | undefined, name: string, args: unknown): string | undefined {
    if (!isCuaInput(name)) return undefined
    const value = row(args), nested = row(value?.target)
    if (value?.scope === 'desktop' || nested?.kind === 'desktop') {
      return this.locks.size > 0 ? 'window_batch_in_flight: desktop input cannot overlap a bound-window batch' : undefined
    }
    const pid = value?.pid ?? nested?.pid, windowId = value?.window_id ?? nested?.window_id
    const owner = this.locks.get(`${pid}:${windowId}`)
    return owner !== undefined && owner !== sessionId ? 'window_batch_in_flight: another session owns this window batch' : undefined
  }

  /** A new provider snapshot invalidates the old AX/image pair, even if pixels match. */
  noteSnapshot(_sessionId: string, name: string, args: unknown): void {
    const value = row(args)
    for (const binding of this.bindings.values()) {
      if (binding.stateTool === name && value?.pid === binding.target.pid && value.window_id === binding.target.windowId) {
        binding.axVersion += 1
        binding.observation = null
      }
    }
  }

  noteInput(sessionId: string, name: string, args: unknown, ownBatch = false): void {
    if (!isCuaInput(name)) return
    const value = row(args), nested = row(value?.target)
    for (const [owner, binding] of this.bindings) {
      if (ownBatch && owner === sessionId) continue
      if ((value?.pid ?? nested?.pid) === binding.target.pid
        && (value?.window_id ?? nested?.window_id) === binding.target.windowId
        || value?.scope === 'desktop' || nested?.kind === 'desktop') binding.observation = null
    }
  }

  async act(targetId: string, observationId: string, steps: readonly WindowStep[], exec: WindowExecution) {
    const sessionId = this.owner(exec), leave = this.enter(sessionId)
    let finish: (() => void) | undefined
    let lockedKey: string | undefined
    try {
      const binding = this.current(sessionId, targetId), observation = binding.observation
      if (observation === null || observation.id !== observationId || !this.options.controller.monitor.isDelivered(observation.native)) {
        throw new Error('window_observation_required: observe and let its exact image reach the model before acting')
      }
      if (this.options.controller.control.status(sessionId).mode !== 'background') {
        throw new Error('window_background_only: release desktop mode first, or use the explicit desktop tools')
      }
      const plan = planWindowSteps(steps, binding.target, observation.native.frame, observation.ax, observation.skewMs)
      const names = plan.map((step) => this.options.driver.name(binding.stateTool, step.operation, exec))
      const windowKey = key(binding.target)
      if (this.locks.has(windowKey)) throw new Error('window_batch_in_flight')
      this.locks.set(windowKey, sessionId)
      lockedKey = windowKey
      const validate = async () => {
        exec.signal.throwIfAborted()
        const state = this.options.registry.snapshot(sessionId)
        if (this.current(sessionId, targetId) !== binding || binding.observation !== observation
          || this.options.controller.control.status(sessionId).mode !== 'background'
          || !recordingStatus(state, this.now()).ready
          || this.now() - observation.native.sample.observedAt > 30_000
          || state?.captureLifecycle?.generation !== observation.native.sample.generation) {
          throw new Error('window_batch_superseded: recording, binding or AX state changed')
        }
        await this.validateGeometry(binding, observation.native.frame, exec)
        exec.signal.throwIfAborted()
        if (this.current(sessionId, targetId) !== binding || binding.observation !== observation
          || !recordingStatus(this.options.registry.snapshot(sessionId), this.now()).ready
          || this.options.registry.snapshot(sessionId)?.captureLifecycle?.generation !== observation.native.sample.generation
          || this.now() - observation.native.sample.observedAt > 30_000) {
          throw new Error('window_batch_superseded')
        }
      }
      await validate()
      finish = this.options.controller.monitor.begin(sessionId, names[0]!, binding.target)
      const batch: BatchResult = { targetId, target: { ...binding.target }, requestedSteps: plan.length, results: [], stoppedReason: null }
      binding.batch = batch
      try {
        for (const [index, step] of plan.entries()) {
          await validate()
          const result = await this.options.driver.call(names[index]!, step.arguments, exec, validate)
          const delivery = result.isError ? { backend: null, expected: true } : actionDelivery(result.value, step.operation)
          const unexpected = !delivery.expected
          const outcome = unexpected ? 'unknown' : result.isError ? 'failed' : actionOutcome(result.value)
          batch.results.push({
            index, operation: step.operation, targeting: step.targeting, outcome,
            backend: delivery.backend,
            error: result.isError ? result.error.message : null,
          })
          if (outcome !== 'confirmed' || result.concludesTurn || unexpected) {
            batch.stoppedReason = unexpected ? 'unexpected_driver_backend'
              : result.concludesTurn ? 'provider_concluded_turn' : `step_${outcome}`
            break
          }
        }
      } catch (error) {
        batch.stoppedReason = error instanceof Error ? error.message : String(error)
        throw error
      }
      finish()
      finish = undefined
      binding.observation = null
      // Input and its resulting observation share a call. The new image still
      // has to reach a later model request before another batch may begin.
      try { return await this.observeBound(sessionId, binding, exec) }
      catch (error) {
        exec.signal.throwIfAborted()
        return { ...this.status(sessionId), status: 'observation_failed', error: error instanceof Error ? error.message : String(error) }
      }
    } finally {
      finish?.()
      if (lockedKey !== undefined && this.locks.get(lockedKey) === sessionId) this.locks.delete(lockedKey)
      leave()
    }
  }

  clear(sessionId?: string): void {
    if (sessionId === undefined) { this.bindings.clear(); return }
    this.bindings.delete(sessionId)
  }

  endTurn(sessionId: string): void {
    const binding = this.bindings.get(sessionId)
    if (binding !== undefined) binding.observation = null
  }
}
