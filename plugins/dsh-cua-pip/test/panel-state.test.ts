import { describe, expect, it } from 'vitest'
import type { CuaWindow, Frame, WatcherSnapshot } from '../src/shared/types.ts'
import {
  createRetainedTargets,
  emptyPanelSnapshot,
  isRetainedTargetUsable,
  panelFrameWarning,
  panelCaptureLabel,
  panelSnapshotForSession,
  panelSnapshotFromFrame,
  parseWindowKey,
  pruneRetained,
  targetWindow,
  updatePanelSnapshot,
  visibleWindows,
  windowKey,
  windowLabel,
  withTarget,
} from '../src/client/panel-state.ts'

const win = (pid: number, windowId: number, title = 'T'): CuaWindow => ({
  pid,
  windowId,
  appName: 'App',
  title,
  bounds: { x: 0, y: 0, width: 800, height: 600 },
  isOnScreen: true,
})

const frame = (): Frame => ({
  mime: 'image/png',
  base64: 'Zg==',
  width: 100,
  height: 100,
  appName: 'ShotApp',
  windowTitle: 'ShotTitle',
})

describe('windowKey / parseWindowKey', () => {
  it('round-trips a target', () => {
    const key = windowKey({ pid: 123, windowId: 456 })
    expect(key).toBe('123:456')
    expect(parseWindowKey(key)).toEqual({ pid: 123, windowId: 456 })
  })

  it('rejects malformed keys', () => {
    expect(parseWindowKey('')).toBeUndefined()
    expect(parseWindowKey('abc')).toBeUndefined()
    expect(parseWindowKey('1:')).toBeUndefined()
    expect(parseWindowKey(':2')).toBeUndefined()
    expect(parseWindowKey('0:2')).toBeUndefined()
    expect(parseWindowKey('-1:2')).toBeUndefined()
    expect(parseWindowKey('1.5:2')).toBeUndefined()
  })
})

describe('windowLabel', () => {
  it('joins app name and title', () => {
    expect(windowLabel(win(1, 2, 'Doc'))).toBe('App — Doc')
  })

  it('falls back to the app name when the title is empty', () => {
    expect(windowLabel(win(1, 2, ''))).toBe('App')
  })
})

describe('targetWindow', () => {
  it('uses frame metadata when available', () => {
    const w = targetWindow({ pid: 7, windowId: 9 }, frame())
    expect(w.appName).toBe('ShotApp')
    expect(w.title).toBe('ShotTitle')
  })

  it('falls back to the pid without a frame', () => {
    const w = targetWindow({ pid: 7, windowId: 9 }, null)
    expect(w.appName).toBe('7')
    expect(w.title).toBe('')
  })
})

describe('withTarget', () => {
  it('appends the target when missing from the list', () => {
    const list = withTarget([win(1, 2)], { pid: 3, windowId: 4 }, null)
    expect(list.map(windowKey)).toEqual(['1:2', '3:4'])
  })

  it('returns a copy unchanged when the target is listed', () => {
    const original = [win(1, 2)]
    const list = withTarget(original, { pid: 1, windowId: 2 }, null)
    expect(list).toHaveLength(1)
    expect(list).not.toBe(original)
  })
})

describe('createRetainedTargets', () => {
  it('stores and deletes per-session targets', () => {
    const retained = createRetainedTargets()
    expect(retained.size).toBe(0)
    retained.set('s1', { pid: 1, windowId: 2 })
    retained.set('s2', { pid: 3, windowId: 4 })
    expect(retained.get('s1')).toEqual({ pid: 1, windowId: 2 })
    expect(retained.size).toBe(2)
    retained.delete('s1')
    expect(retained.get('s1')).toBeUndefined()
    expect(retained.get('s2')).toEqual({ pid: 3, windowId: 4 })
  })

  it('exposes keys for prune walks', () => {
    const retained = createRetainedTargets()
    retained.set('s1', { pid: 1, windowId: 2 })
    retained.set('s2', { pid: 3, windowId: 4 })
    expect(retained.keys()).toEqual(['s1', 's2'])
    retained.delete('s1')
    expect(retained.keys()).toEqual(['s2'])
  })
})

describe('pruneRetained', () => {
  it('drops sessions that are no longer alive and returns their ids', () => {
    const retained = createRetainedTargets()
    retained.set('alive', { pid: 1, windowId: 2 })
    retained.set('gone', { pid: 3, windowId: 4 })
    retained.set('archived', { pid: 5, windowId: 6 })
    const pruned = pruneRetained(retained, (id) => id === 'alive')
    expect(pruned).toEqual(['gone', 'archived'])
    expect(retained.size).toBe(1)
    expect(retained.get('alive')).toEqual({ pid: 1, windowId: 2 })
    expect(retained.get('gone')).toBeUndefined()
    expect(retained.get('archived')).toBeUndefined()
  })

  it('keeps every session still present in the snapshot', () => {
    const retained = createRetainedTargets()
    retained.set('main', { pid: 1, windowId: 2 })
    retained.set('subagent', { pid: 3, windowId: 4 })
    const byId: Record<string, true> = { main: true, subagent: true }
    expect(pruneRetained(retained, (id) => id in byId)).toEqual([])
    expect(retained.size).toBe(2)
  })

  it('returns an empty list when nothing is retained', () => {
    expect(pruneRetained(createRetainedTargets(), () => false)).toEqual([])
  })
})

describe('visibleWindows / isRetainedTargetUsable', () => {
  it('hides the Screen Recording overlay from the picker', () => {
    const overlay = win(4456, 63495, '录屏')
    overlay.appName = 'universalAccessAuthWarn'
    const dsh = win(33403, 61847, 'DeepSeek Harness')
    dsh.appName = 'DSH-Desktop'
    expect(visibleWindows([overlay, dsh]).map(windowKey)).toEqual(['33403:61847'])
  })

  it('rejects a retained overlay pid and waits when the list is empty', () => {
    const overlay = win(4456, 63495, '录屏')
    overlay.appName = 'universalAccessAuthWarn'
    expect(isRetainedTargetUsable([], { pid: 4456, windowId: 63464 })).toBe(false)
    expect(isRetainedTargetUsable([overlay], { pid: 4456, windowId: 63464 })).toBe(false)
    expect(isRetainedTargetUsable([overlay], { pid: 4456, windowId: 63495 })).toBe(false)
    expect(isRetainedTargetUsable([win(33403, 61847)], { pid: 33403, windowId: 61847 })).toBe(true)
    expect(isRetainedTargetUsable([win(9, 9)], { pid: 1, windowId: 2 })).toBe(true)
  })
})

describe('session capture state', () => {
  const state = (overrides: Partial<WatcherSnapshot> = {}): WatcherSnapshot => ({
    sessionId: 'one',
    target: { pid: 1, windowId: 2 },
    frames: 1,
    updatedAt: 100,
    lastFetchAt: 100,
    error: null,
    frame: frame(),
    ...overrides,
  })

  it('clears the previous conversation immediately when navigation changes', () => {
    const previous = panelSnapshotFromFrame('one', { ok: true, watching: true, state: state() })
    expect(previous.frame?.appName).toBe('ShotApp')
    expect(panelSnapshotForSession(previous, 'two')).toEqual(emptyPanelSnapshot('two'))
    expect(panelSnapshotForSession(previous, 'one')).toBe(previous)
  })

  it('rejects a late frame response for another conversation', () => {
    expect(panelSnapshotFromFrame('two', { ok: true, watching: true, state: state() }))
      .toEqual(emptyPanelSnapshot('two'))
  })

  it('clears a capture when the host ends its watch even if the response carries old metadata', () => {
    expect(panelSnapshotFromFrame('one', { ok: true, watching: false, state: state() }))
      .toEqual(emptyPanelSnapshot('one'))
    expect(panelSnapshotFromFrame('one', { ok: true, watching: false }))
      .toEqual(emptyPanelSnapshot('one'))
  })

  it('does not reuse a previous capture while waiting for a new target', () => {
    const next = panelSnapshotFromFrame('one', {
      ok: true,
      watching: true,
      state: state({ target: { pid: 3, windowId: 4 }, frame: null }),
    })
    expect(next.watching).toBe(true)
    expect(next.target).toEqual({ pid: 3, windowId: 4 })
    expect(next.frame).toBeNull()
  })

  it('never displays an accessibility permission overlay as an application capture', () => {
    const overlay = { ...frame(), appName: 'universalAccessAuthWarn', windowTitle: '录屏' }
    expect(panelSnapshotFromFrame('one', { ok: true, watching: true, state: state({ frame: overlay }) }))
      .toEqual(emptyPanelSnapshot('one'))
  })

  it('ignores older captures and late responses from another session', () => {
    const current = panelSnapshotFromFrame('one', {
      ok: true, watching: true, state: state({ updatedAt: 5000 }),
    })
    expect(updatePanelSnapshot(current, 'one', {
      ok: true, watching: true, state: state({ updatedAt: 4000 }),
    })).toBe(current)
    expect(updatePanelSnapshot(current, 'one', {
      ok: true, watching: true, state: state({ sessionId: 'two', updatedAt: 6000 }),
    })).toBe(current)
  })

  it('keeps a previous frame on temporary capture failure without refreshing its timestamp', () => {
    const current = panelSnapshotFromFrame('one', {
      ok: true, watching: true, state: state({ updatedAt: 5000 }),
    })
    const interrupted = updatePanelSnapshot(current, 'one', {
      ok: true,
      watching: true,
      state: state({ frame: null, error: 'Driver unavailable', updatedAt: 6000 }),
    })
    expect(interrupted.frame).toBe(current.frame)
    expect(interrupted.updatedAt).toBe(5000)
    expect(interrupted.error).toBe('Driver unavailable')
    expect(panelFrameWarning(interrupted, 8001, 'connected')).toBe('interrupted')
  })

  it('does not preserve the old image across target changes or a closed watch', () => {
    const current = panelSnapshotFromFrame('one', { ok: true, watching: true, state: state() })
    const retargeted = updatePanelSnapshot(current, 'one', {
      ok: true,
      watching: true,
      state: state({ target: { pid: 3, windowId: 4 }, frame: null, error: 'Not ready', updatedAt: 0 }),
    })
    expect(retargeted.frame).toBeNull()
    expect(updatePanelSnapshot(current, 'one', { ok: true, watching: false }))
      .toEqual(emptyPanelSnapshot('one'))
  })

  it('discards stale pixels when rebuilding the same target stream', () => {
    const lifecycle = { phase: 'ready', generation: 1, retryCount: 0, nextRetryAt: null, errorCode: null } as const
    const current = panelSnapshotFromFrame('one', {
      ok: true, watching: true, state: state({ captureLifecycle: lifecycle }),
    })
    const recovering = updatePanelSnapshot(current, 'one', {
      ok: true, watching: true, state: state({
        frame: null, error: 'unavailable', updatedAt: 0,
        captureLifecycle: { ...lifecycle, phase: 'recovering', generation: 2, retryCount: 1 },
      }),
    })
    expect(recovering.frame).toBeNull()
    expect(recovering.updatedAt).toBe(0)
    expect(panelCaptureLabel(recovering)).toBe('panel.recovering')
  })

  it.each([
    ['paused', 'panel.captureStopped'], ['failed', 'panel.captureFailed'],
  ] as const)('shows %s without preserving a cached image or claiming the window closed', (phase, label) => {
    const lifecycle = { phase: 'ready', generation: 1, retryCount: 0, nextRetryAt: null, errorCode: null } as const
    const current = panelSnapshotFromFrame('one', {
      ok: true, watching: true, state: state({ captureLifecycle: lifecycle }),
    })
    const stopped = updatePanelSnapshot(current, 'one', {
      ok: true, watching: true, state: state({
        frame: null, error: 'stopped', captureLifecycle: { ...lifecycle, phase },
      }),
    })
    expect(stopped.frame).toBeNull()
    expect(panelCaptureLabel(stopped)).toBe(label)
  })

  it.each(['suspended', 'blank'] as const)('warns immediately on %s even with a recently cached image', (status) => {
    const current = panelSnapshotFromFrame('one', {
      ok: true, watching: true, state: state({ captureHealth: { status, checkedAt: 100 } }),
    })
    expect(panelFrameWarning(current, 100, 'connected')).toBe('interrupted')
  })

  it('distinguishes permission denial from an ordinary stopped recording', () => {
    const denied = panelSnapshotFromFrame('one', {
      ok: true, watching: true, state: state({
        frame: null, error: 'Allow screen recording',
        captureLifecycle: { phase: 'paused', generation: 1, retryCount: 0, nextRetryAt: null, errorCode: 'permission_denied' },
      }),
    })
    expect(panelCaptureLabel(denied)).toBe('panel.permissionDenied')
  })

  it('warns only after three seconds without a new driver frame, then clears on recovery', () => {
    const current = panelSnapshotFromFrame('one', {
      ok: true, watching: true, state: state({ updatedAt: 5000 }),
    })
    expect(panelFrameWarning(current, 8000, 'connected')).toBeNull()
    expect(panelFrameWarning(current, 8001, 'connected')).toBe('interrupted')
    expect(panelFrameWarning(current, 8001, 'reconnecting')).toBe('reconnecting')
    const recovered = updatePanelSnapshot(current, 'one', {
      ok: true, watching: true, state: state({ updatedAt: 9000 }),
    })
    expect(panelFrameWarning(recovered, 9001, 'connected')).toBeNull()
  })

  it('does not count repeated old frames or connection heartbeats as fresh captures', () => {
    const body = { ok: true, watching: true, state: state({ updatedAt: 5000 }) }
    const current = panelSnapshotFromFrame('one', body)
    const repeated = updatePanelSnapshot(current, 'one', body)
    expect(repeated.updatedAt).toBe(5000)
    expect(panelFrameWarning(repeated, 10_000, 'connected')).toBe('interrupted')
    expect(panelFrameWarning(emptyPanelSnapshot('one'), 10_000, 'reconnecting')).toBeNull()
  })

  it('keeps native idle distinct from interruption without inventing fresh frames', () => {
    const body = { ok: true, watching: true, state: state({
      updatedAt: 1000, captureHealth: { status: 'idle', checkedAt: 10_000 },
    }) }
    const snapshot = panelSnapshotFromFrame('one', body)
    expect(snapshot.updatedAt).toBe(1000)
    expect(panelFrameWarning(snapshot, 10_000, 'connected')).toBeNull()
    expect(panelFrameWarning(snapshot, 10_000, 'reconnecting')).toBe('reconnecting')
    expect(panelFrameWarning(snapshot, 14_000, 'connected')).toBe('interrupted')
    expect(panelFrameWarning({ ...snapshot, error: 'stopped' }, 10_000, 'connected')).toBe('interrupted')
    expect(panelFrameWarning({ ...snapshot, captureHealth: { status: 'suspended', checkedAt: 10_000 } }, 10_000, 'connected'))
      .toBe('interrupted')
  })
})
