import { isCuaInput } from './shared/cua-tools.ts'
import { recordingStatus, sampleAfter } from './shared/recording-state.ts'
import type { Frame, WatchTarget } from './shared/types.ts'
import type { WatcherRegistry } from './watcher.ts'

export interface ObservedSample {
  frameId: string
  capturedAt: number
  imageHash: string | null
  generation: number
  observedAt: number
}

interface Scope { open: boolean; openedAt?: number }
interface Mutation { tokens: Set<object>; version: number; finishedAt: number }
export interface MonitorObservation {
  sessionId: string
  openedAt: number
  target: WatchTarget
  actionVersion: number
  sample: ObservedSample
  frame: Frame
}
interface QueuedObservation extends MonitorObservation {
  messageId: string
  attachmentId: string
  delivered: boolean
}
interface RequestMessage {
  id?: string
  content: readonly { type: string; attachment?: { attachmentId: string } }[]
}
const OBSERVATION_TTL_MS = 30_000
const same = (left: WatchTarget | undefined, right: WatchTarget | undefined) =>
  left !== undefined && right !== undefined && left.pid === right.pid && left.windowId === right.windowId

/** Input is permitted only while the requested monitor is usable and observed. */
export class PreviewMonitor {
  private readonly observations = new Map<string, QueuedObservation>()
  private readonly mutations = new Map<string, Mutation>()

  constructor(
    private readonly registry: WatcherRegistry,
    private readonly scope: (sessionId: string) => Scope,
    private readonly now: () => number = Date.now,
  ) {}

  summary(sessionId: string) {
    const snapshot = this.registry.snapshot(sessionId)
    const recording = recordingStatus(snapshot, this.now())
    const observation = this.validObservation(sessionId)
    return {
      recording,
      observation: observation?.sample ?? null,
      observationDelivery: observation === undefined ? 'missing' as const : observation.delivered ? 'delivered' as const : 'queued' as const,
      needsObservation: this.scope(sessionId).open && observation === undefined,
    }
  }

  refusal(sessionId: string | undefined, name: string, target: WatchTarget | undefined, desktop = false): string | undefined {
    if (sessionId === undefined || !isCuaInput(name) || !this.scope(sessionId).open) return undefined
    if ((this.mutations.get(sessionId)?.tokens.size ?? 0) > 0) {
      return 'pip_action_in_flight: wait for the current application action, then call computer_pip(action="observe")'
    }
    // Desktop fallback is an explicit degraded operating mode, not a claim
    // that the failing window monitor was repaired.
    if (desktop) return undefined
    const snapshot = this.registry.snapshot(sessionId)
    const state = recordingStatus(snapshot, this.now())
    if (!state.ready) {
      return `pip_not_ready: ${JSON.stringify({ ...state, target: snapshot?.target, error: snapshot?.error })}. `
        + 'PiP-managed input is paused; direct Cua calls remain available. Call computer_pip(action="observe") to wait for bounded recovery. '
        + 'If recovery fails, report it or explicitly declare the authorized desktop fallback; do not close PiP to bypass monitoring.'
    }
    if (!same(target, snapshot?.target)) {
      return 'pip_target_mismatch: input must match the monitored window; observe/select the exact target before acting'
    }
    const observation = this.validObservation(sessionId)
    if (observation === undefined) {
      return 'pip_observation_required: call computer_pip(action="observe") to inspect the actual monitored frame before application input'
    }
    if (!observation.delivered) {
      return 'pip_observation_pending: the PiP image is queued for the next model request. End this run_code/tool batch and inspect the image before input; do not call observe and input in the same script'
    }
    return undefined
  }

  /** A second check at dispatch prevents sibling calls from racing the guard. */
  begin(sessionId: string, name: string, target: WatchTarget | undefined, desktop = false): () => void {
    const reason = this.refusal(sessionId, name, target, desktop)
    if (reason !== undefined) throw new Error(reason)
    return this.track(sessionId, name)
  }

  /** Observe direct Cua input without imposing PiP readiness or control policy. */
  track(sessionId: string, name: string): () => void {
    if (!isCuaInput(name) || !this.scope(sessionId).open) return () => {}
    const token = {}
    const mutation = this.mutations.get(sessionId) ?? { tokens: new Set<object>(), version: 0, finishedAt: -Infinity }
    mutation.tokens.add(token)
    this.mutations.set(sessionId, mutation)
    return () => {
      if (this.mutations.get(sessionId) !== mutation || !mutation.tokens.has(token)) return
      mutation.tokens.delete(token)
      mutation.version += 1
      mutation.finishedAt = this.now()
      this.observations.delete(sessionId)
    }
  }

  async observe(sessionId: string, signal?: AbortSignal): Promise<MonitorObservation | null> {
    const scope = this.scope(sessionId)
    if (!scope.open || scope.openedAt === undefined) throw new Error('Open a PiP before observing it')
    const mutation = this.mutations.get(sessionId)
    if ((mutation?.tokens.size ?? 0) > 0) throw new Error('Wait for the in-flight application action before observing its result')
    const version = mutation?.version ?? 0
    const after = mutation?.finishedAt ?? -Infinity
    const snapshot = await this.registry.waitForReady(sessionId, signal, after)
    signal?.throwIfAborted()
    if (!this.scope(sessionId).open || this.scope(sessionId).openedAt !== scope.openedAt
      || (this.mutations.get(sessionId)?.version ?? 0) !== version
      || (this.mutations.get(sessionId)?.tokens.size ?? 0) > 0) {
      throw new Error('PiP observation was superseded; inspect the current preview')
    }
    if (snapshot === null || snapshot.frame === null
      || !recordingStatus(snapshot, this.now()).ready || !sampleAfter(snapshot, after)) return null
    const generation = snapshot.captureLifecycle?.generation ?? 0
    return {
      sessionId, openedAt: scope.openedAt, target: { ...snapshot.target },
      actionVersion: version, frame: snapshot.frame,
      sample: {
        frameId: snapshot.frame.frameId ?? `${scope.openedAt}:${generation}:${snapshot.frames}`,
        capturedAt: snapshot.updatedAt, generation, observedAt: this.now(), imageHash: snapshot.frame.imageHash ?? null,
      },
    }
  }

  /** Saving/deferContext queues an image; it does not yet reach the model. */
  acknowledge(observation: MonitorObservation, delivery: { messageId: string; attachmentId: string }): void {
    if (!this.isCurrent(observation)) throw new Error('PiP changed while delivering the observation; obtain a fresh frame')
    this.observations.set(observation.sessionId, { ...observation, ...delivery, delivered: false })
  }

  /** Inspect the assembled request, including images deferred by Code Mode. */
  deliver(sessionId: string, messages: readonly RequestMessage[]): void {
    const observation = this.validObservation(sessionId)
    if (observation === undefined || observation.delivered) return
    if (messages.some((message) => message.id === observation.messageId && message.content.some((part) =>
      part.type === 'image' && part.attachment?.attachmentId === observation.attachmentId))) {
      observation.delivered = true
    }
  }

  isDelivered(observation: MonitorObservation): boolean {
    const current = this.validObservation(observation.sessionId)
    return current?.delivered === true && current.sample === observation.sample
  }

  context(sessionId: string): string | null {
    if (!this.scope(sessionId).open) return null
    const snapshot = this.registry.snapshot(sessionId)
    const status = this.summary(sessionId)
    return 'PiP monitor status (JSON data; recording health is not proof of application progress):\n'
      + JSON.stringify({
        target: snapshot?.target ?? null, ...status, error: snapshot?.error ?? null,
        latestFrameId: snapshot?.frame?.frameId ?? null, capturedAt: snapshot?.updatedAt ?? null,
      })
      + '\nReadiness and image delivery gate computer_window batches only; direct Cua calls remain available. The host retries transient capture failures at most twice. '
      + 'Use computer_pip(action="observe") for the same native image shown in PiP; compare it with fresh AX state. '
      + 'For PiP-managed actions, queued delivery requires ending the original tool batch. If this request now includes that exact PiP image, inspect it and continue; no repeated observe is needed solely for delivery. '
      + 'Do not use this preview image as Cua pixel coordinates. User-stopped sharing must not restart automatically.'
  }

  clear(sessionId?: string): void {
    if (sessionId === undefined) {
      this.observations.clear()
      this.mutations.clear()
    } else {
      this.observations.delete(sessionId)
      this.mutations.delete(sessionId)
    }
  }

  rejectObservation(sessionId: string): void {
    this.observations.delete(sessionId)
  }

  private validObservation(sessionId: string): QueuedObservation | undefined {
    const observation = this.observations.get(sessionId)
    return observation !== undefined && this.isCurrent(observation) ? observation : undefined
  }

  private isCurrent(observation: MonitorObservation): boolean {
    const scope = this.scope(observation.sessionId)
    const snapshot = this.registry.snapshot(observation.sessionId)
    const mutation = this.mutations.get(observation.sessionId)
    return scope.open && scope.openedAt === observation.openedAt
      && same(observation.target, snapshot?.target)
      && observation.sample.generation === (snapshot?.captureLifecycle?.generation ?? 0)
      && this.now() - observation.sample.observedAt <= OBSERVATION_TTL_MS
      && (mutation?.version ?? 0) === observation.actionVersion && (mutation?.tokens.size ?? 0) === 0
      && recordingStatus(snapshot, this.now()).ready
  }
}
