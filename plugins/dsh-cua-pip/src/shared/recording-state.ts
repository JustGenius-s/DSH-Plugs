import type { RecordingStatus, WatcherSnapshot } from './types.ts'

export const RECORDING_STALE_MS = 3500

/** Stream liveness and sample freshness are separate from application progress. */
export function recordingStatus(snapshot: WatcherSnapshot | null, now: number): RecordingStatus {
  const lifecycle = snapshot?.captureLifecycle
  const status: RecordingStatus = {
    state: 'closed', ready: false, generation: lifecycle?.generation ?? 0,
    retryCount: lifecycle?.retryCount ?? 0, nextRetryAt: lifecycle?.nextRetryAt ?? null,
    errorCode: lifecycle?.errorCode ?? null,
  }
  if (snapshot === null) return status
  if (lifecycle?.phase === 'paused') return { ...status, state: 'stopped' }
  if (lifecycle?.phase === 'failed') return { ...status, state: 'failed' }
  if (lifecycle?.phase === 'recovering') return { ...status, state: 'recovering' }
  if (snapshot.error !== null) return { ...status, state: 'failed' }
  if (snapshot.frame === null) return { ...status, state: 'starting' }
  const health = snapshot.captureHealth
  if (health?.status === 'suspended' || health?.status === 'blank') return { ...status, state: 'suspended' }
  const recent = (time: number) => time <= now + 1000 && now - time <= RECORDING_STALE_MS
  const live = health === undefined ? recent(snapshot.updatedAt) : recent(health.checkedAt)
  const ready = live && (recent(snapshot.updatedAt) || health?.status === 'idle')
  return { ...status, state: ready ? 'ready' : 'stale', ready }
}

export function sampleAfter(snapshot: WatcherSnapshot, time: number): boolean {
  return snapshot.updatedAt > time
    || snapshot.captureHealth?.status === 'idle' && (snapshot.captureHealth.sampleAt ?? -Infinity) > time
}
