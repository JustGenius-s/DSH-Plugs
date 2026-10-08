// Pure state helpers for the PiP panel. No React, no DOM — the panel
// component is a thin shell over these so the logic stays testable.

import type { CaptureHealth, CaptureLifecycle, CuaWindow, Frame, FrameResponse, WatchTarget } from '../shared/types.ts'
import { isHijackCapture } from '../shared/cua-activity.ts'
import type { FrameFeedConnection } from './frame-feed.ts'

export interface PanelSnapshot {
  sessionId: string
  watching: boolean
  target: WatchTarget | null
  frame: Frame | null
  error: string | null
  /** Time of the most recent new frame, never a stream heartbeat. */
  updatedAt: number
  captureHealth?: CaptureHealth
  captureLifecycle?: CaptureLifecycle
}

export function emptyPanelSnapshot(sessionId: string): PanelSnapshot {
  return { sessionId, watching: false, target: null, frame: null, error: null, updatedAt: 0 }
}

/** A render after navigation must never reuse another conversation's capture. */
export function panelSnapshotForSession(snapshot: PanelSnapshot, sessionId: string): PanelSnapshot {
  return snapshot.sessionId === sessionId ? snapshot : emptyPanelSnapshot(sessionId)
}

/** The host owns the watch lifetime; an ended watch also clears its last frame. */
export function panelSnapshotFromFrame(sessionId: string, response: FrameResponse): PanelSnapshot {
  const state = response.state
  if (!response.watching || state === undefined || state.sessionId !== sessionId) {
    return emptyPanelSnapshot(sessionId)
  }
  if (state.frame !== null && isHijackCapture(state.frame.appName, state.frame.windowTitle)) {
    return emptyPanelSnapshot(sessionId)
  }
  return {
    sessionId,
    watching: true,
    target: state.target,
    frame: state.frame,
    error: state.error,
    updatedAt: state.updatedAt,
    ...(state.captureHealth === undefined ? {} : { captureHealth: state.captureHealth }),
    ...(state.captureLifecycle === undefined ? {} : { captureLifecycle: state.captureLifecycle }),
  }
}

/** Preserve the last capture on a transient error, without crossing targets. */
export function updatePanelSnapshot(
  current: PanelSnapshot,
  sessionId: string,
  response: FrameResponse,
): PanelSnapshot {
  const previous = panelSnapshotForSession(current, sessionId)
  if (!response.ok || (response.watching && response.state?.sessionId !== sessionId)) return previous
  const next = panelSnapshotFromFrame(sessionId, response)
  const sameTarget = previous.target !== null && next.target !== null &&
    windowKey(previous.target) === windowKey(next.target)
  if (sameTarget && previous.captureLifecycle?.generation !== next.captureLifecycle?.generation) return next
  if (sameTarget && next.frame !== null && next.updatedAt < previous.updatedAt) return previous
  if (sameTarget && next.frame === null && next.error !== null && previous.frame !== null
    && next.captureLifecycle?.phase !== 'paused' && next.captureLifecycle?.phase !== 'failed') {
    return { ...next, frame: previous.frame, updatedAt: previous.updatedAt }
  }
  return next
}

export const PANEL_STALE_AFTER_MS = 3000

export function panelCaptureLabel(snapshot: PanelSnapshot): string {
  if (snapshot.captureLifecycle?.errorCode === 'permission_denied') return 'panel.permissionDenied'
  if (snapshot.captureLifecycle?.phase === 'recovering') return 'panel.recovering'
  if (snapshot.captureLifecycle?.phase === 'paused') return 'panel.captureStopped'
  if (snapshot.captureLifecycle?.phase === 'failed' || snapshot.error !== null) return 'panel.captureFailed'
  return 'panel.empty'
}

/**
 * An open connection or repeated delivery of an old frame is not freshness.
 * Only a newly received driver frame advances the host's updatedAt timestamp.
 */
export function panelFrameWarning(
  snapshot: PanelSnapshot,
  now: number,
  connection: FrameFeedConnection,
): 'interrupted' | 'reconnecting' | null {
  if (!snapshot.watching || snapshot.frame === null) return null
  if (snapshot.error !== null || snapshot.captureHealth?.status === 'suspended'
    || snapshot.captureHealth?.status === 'blank') return 'interrupted'
  // Native idle is distinct from a new sample. Do not show a connection error
  // on a healthy static window, or use that heartbeat to advance frame counts.
  if (snapshot.error === null && connection === 'connected' && snapshot.captureHealth?.status === 'idle'
    && now - snapshot.captureHealth.checkedAt <= PANEL_STALE_AFTER_MS) return null
  if (now - snapshot.updatedAt <= PANEL_STALE_AFTER_MS) return null
  return connection === 'connecting' || connection === 'reconnecting' ? 'reconnecting' : 'interrupted'
}

/** Picker value identifying one window. */
export function windowKey(w: WatchTarget): string {
  return `${w.pid}:${w.windowId}`
}

export function parseWindowKey(key: string): WatchTarget | undefined {
  const i = key.indexOf(':')
  if (i <= 0) return undefined
  const pid = Number(key.slice(0, i))
  const windowId = Number(key.slice(i + 1))
  if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(windowId) || pid <= 0 || windowId <= 0) {
    return undefined
  }
  return { pid, windowId }
}

export function windowLabel(w: CuaWindow): string {
  return w.title === '' ? w.appName : `${w.appName} — ${w.title}`
}

/**
 * Synthesize a picker row for the watched target when it is absent from the
 * live window list (the list failed to load, or the window is off-screen).
 * Frame metadata carries just enough identity for the label.
 */
export function targetWindow(target: WatchTarget, frame: Frame | null): CuaWindow {
  return {
    pid: target.pid,
    windowId: target.windowId,
    appName: frame?.appName ?? String(target.pid),
    title: frame?.windowTitle ?? '',
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    isOnScreen: false,
  }
}

/** Merge the watched target into the window list if it is missing. */
export function withTarget(windows: readonly CuaWindow[], target: WatchTarget, frame: Frame | null): CuaWindow[] {
  const key = windowKey(target)
  if (windows.some((w) => windowKey(w) === key)) return [...windows]
  return [...windows, targetWindow(target, frame)]
}

/** Drop Screen Recording / Accessibility consent overlays from the picker. */
export function visibleWindows(windows: readonly CuaWindow[]): CuaWindow[] {
  return windows.filter((w) => !isHijackCapture(w.appName, w.title))
}

/**
 * Validate retained metadata against a known window list. An empty list is
 * inconclusive, and a pid that only owns a consent overlay is unusable.
 * This validation does not open or reconnect a watch.
 */
export function isRetainedTargetUsable(
  windows: readonly CuaWindow[],
  target: WatchTarget,
): boolean {
  if (windows.length === 0) return false
  const samePid = windows.filter((w) => w.pid === target.pid)
  if (samePid.length === 0) return true
  const exact = samePid.find((w) => w.windowId === target.windowId)
  if (exact !== undefined) return !isHijackCapture(exact.appName, exact.title)
  return samePid.some((w) => !isHijackCapture(w.appName, w.title))
}

/**
 * Per-session target metadata survives a panel remount. The host owns watch
 * lifetime; retained metadata must never open or reconnect a watch.
 */
export interface RetainedTargets {
  get(sessionId: string): WatchTarget | undefined
  set(sessionId: string, target: WatchTarget): void
  delete(sessionId: string): void
  keys(): string[]
  readonly size: number
}

/**
 * Drop retained targets whose session no longer exists (archived/removed).
 * Session removal (archive/delete) retires its metadata. Returns the pruned
 * ids so the caller can also discard any associated UI placement.
 */
export function pruneRetained(
  retained: RetainedTargets,
  alive: (sessionId: string) => boolean,
): string[] {
  const pruned: string[] = []
  for (const sessionId of retained.keys()) {
    if (alive(sessionId)) continue
    retained.delete(sessionId)
    pruned.push(sessionId)
  }
  return pruned
}

export function createRetainedTargets(): RetainedTargets {
  const map = new Map<string, WatchTarget>()
  return {
    get: (sessionId) => map.get(sessionId),
    set: (sessionId, target) => {
      map.set(sessionId, target)
    },
    delete: (sessionId) => {
      map.delete(sessionId)
    },
    keys: () => [...map.keys()],
    get size() {
      return map.size
    },
  }
}
