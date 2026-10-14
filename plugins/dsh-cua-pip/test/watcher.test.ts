import { describe, expect, it, vi } from 'vitest'
import { CuaError } from '../src/cua.ts'
import type { CuaWindow, Frame, WatcherSnapshot, WatchTarget } from '../src/shared/types.ts'
import { WatcherRegistry, evictionCandidate, shouldReap, type WatcherOptions } from '../src/watcher.ts'

const frame = (tag = 'f'): Frame => ({
  mime: 'image/png',
  base64: tag,
  width: 100,
  height: 100,
  appName: 'App',
  windowTitle: 'T',
})

const win = (pid: number, windowId: number, isOnScreen = true): CuaWindow => ({
  pid,
  windowId,
  appName: 'App',
  title: 'T',
  bounds: { x: 0, y: 0, width: 800, height: 600 },
  isOnScreen,
})

interface Harness {
  registry: WatcherRegistry
  setNow: (ms: number) => void
  capture: (target: WatchTarget) => Promise<Frame>
  failWith: (error: Error | null) => void
  windows: CuaWindow[]
}

function harness(over: Partial<WatcherOptions> = {}): Harness {
  let now = 1_000
  let failure: Error | null = null
  const h: Harness = {
    registry: undefined as unknown as WatcherRegistry,
    setNow: (ms) => {
      now = ms
    },
    capture: (target) => {
      if (failure !== null) return Promise.reject(failure)
      return Promise.resolve({ ...frame(), base64: `${target.pid}:${target.windowId}` })
    },
    failWith: (error) => {
      failure = error
    },
    windows: [],
  }
  h.registry = new WatcherRegistry({
    fps: 1,
    maxDimension: 640,
    idleTtlMs: 45_000,
    maxWatchers: 3,
    autoStart: false,
    capture: (target) => h.capture(target),
    listWindows: () => Promise.resolve(h.windows),
    now: () => now,
    ...over,
  })
  return h
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

describe('shouldReap', () => {
  it('reaps only past the TTL', () => {
    expect(shouldReap(1_000, 46_001, 45_000)).toBe(true)
    expect(shouldReap(1_000, 46_000, 45_000)).toBe(false)
    expect(shouldReap(1_000, 1_000, 45_000)).toBe(false)
  })
})

describe('native capture ownership and freshness', () => {
  it('does not count missing/idle samples as frames, and uses native timestamps', async () => {
    const capture = vi.fn<WatcherOptions['capture']>()
      .mockResolvedValueOnce({ ...frame(), capturedAt: 700 })
      .mockResolvedValue(null)
    let health = { status: 'complete' as 'complete' | 'idle', checkedAt: 1000 }
    const h = harness({ capture, captureHealth: () => health })
    h.registry.watch('s1', { pid: 1, windowId: 10 })
    await h.registry.tickNow('s1')
    expect(h.registry.snapshot('s1')).toMatchObject({ frames: 1, updatedAt: 700 })
    health = { status: 'idle', checkedAt: 2000 }
    h.setNow(2000)
    await h.registry.tickNow('s1')
    expect(h.registry.snapshot('s1')).toMatchObject({
      frames: 1, updatedAt: 700, captureHealth: { status: 'idle', checkedAt: 2000 },
    })
    h.registry.dispose()
  })

  it.each(['permission_denied', 'capture_stopped'] as const)('pauses %s until explicit reopen, then releases the failed stream', async (code) => {
    const release = vi.fn()
    const capture = vi.fn<WatcherOptions['capture']>().mockRejectedValue(new CuaError('stopped', code))
    const h = harness({ capture, release })
    h.registry.watch('s1', { pid: 1, windowId: 10 })
    await h.registry.tickNow('s1')
    await h.registry.tickNow('s1')
    expect(capture).toHaveBeenCalledOnce()
    h.registry.watch('s1', { pid: 1, windowId: 11 }, { restartStopped: false })
    h.registry.refresh('s1')
    await h.registry.tickNow('s1')
    expect(capture).toHaveBeenCalledOnce()
    expect(h.registry.snapshot('s1')?.target.windowId).toBe(10)
    capture.mockResolvedValue(frame())
    h.registry.watch('s1', { pid: 1, windowId: 10 })
    expect(release).toHaveBeenCalledWith('s1')
    await h.registry.tickNow('s1')
    expect(h.registry.snapshot('s1')).toMatchObject({ frames: 1, error: null })
    h.registry.dispose()
  })

  it('releases on retarget, refresh, close and plugin unload, never on display unsubscribe', () => {
    const release = vi.fn()
    const h = harness({ release })
    h.registry.watch('s1', { pid: 1, windowId: 10 })
    const unsubscribe = h.registry.subscribe('s1', () => {})
    unsubscribe()
    expect(release).not.toHaveBeenCalled()
    h.registry.watch('s1', { pid: 1, windowId: 11 })
    h.registry.refresh('s1')
    h.registry.unwatch('s1')
    expect(release.mock.calls).toEqual([['s1'], ['s1'], ['s1']])
    h.registry.watch('s2', { pid: 2, windowId: 20 })
    h.registry.dispose()
    expect(release).toHaveBeenLastCalledWith('s2')
  })
})

describe('evictionCandidate', () => {
  it('picks the least recently fetched entry', () => {
    expect(
      evictionCandidate([
        ['a', 500],
        ['b', 100],
        ['c', 900],
      ]),
    ).toBe('b')
    expect(evictionCandidate([])).toBeUndefined()
  })
})

describe('WatcherRegistry', () => {
  it('watch creates a watcher and reports its snapshot', () => {
    const h = harness()
    const snap = h.registry.watch('s1', { pid: 1, windowId: 10 })
    expect(h.registry.size).toBe(1)
    expect(snap.sessionId).toBe('s1')
    expect(snap.target).toEqual({ pid: 1, windowId: 10 })
    expect(snap.frame).toBeNull()
  })

  it('a repeat watch retargets instead of duplicating', () => {
    const h = harness()
    h.registry.watch('s1', { pid: 1, windowId: 10 })
    const snap = h.registry.watch('s1', { pid: 2, windowId: 20 })
    expect(h.registry.size).toBe(1)
    expect(snap.target).toEqual({ pid: 2, windowId: 20 })
  })

  it('clears the old frame immediately when changing the target', async () => {
    const h = harness()
    h.registry.watch('s1', { pid: 1, windowId: 10 })
    await h.registry.tickNow('s1')
    const snap = h.registry.watch('s1', { pid: 2, windowId: 20 })
    expect(snap.frame).toBeNull()
    expect(snap.frames).toBe(0)
    expect(snap.updatedAt).toBe(0)
    await h.registry.tickNow('s1')
    expect(h.registry.snapshot('s1')?.frame?.base64).toBe('2:20')
  })

  it('evicts the least recently fetched watcher past maxWatchers', () => {
    const h = harness({ maxWatchers: 2 })
    h.registry.watch('a', { pid: 1, windowId: 1 })
    h.setNow(2_000)
    h.registry.watch('b', { pid: 2, windowId: 2 })
    h.setNow(3_000)
    h.registry.touch('a') // a is now the freshest
    h.registry.watch('c', { pid: 3, windowId: 3 })
    expect(h.registry.size).toBe(2)
    expect(h.registry.snapshot('b')).toBeNull()
    expect(h.registry.snapshot('a')).not.toBeNull()
    expect(h.registry.snapshot('c')).not.toBeNull()
  })

  it('preserves retained sessions when temporary watchers need eviction', () => {
    const h = harness({ maxWatchers: 2 })
    h.registry.watch('retained', { pid: 1, windowId: 1 }, { retained: true })
    h.setNow(2_000)
    h.registry.watch('temporary', { pid: 2, windowId: 2 })
    h.setNow(3_000)
    h.registry.watch('new', { pid: 3, windowId: 3 })
    expect(h.registry.size).toBe(2)
    expect(h.registry.snapshot('retained')).not.toBeNull()
    expect(h.registry.snapshot('temporary')).toBeNull()
    expect(h.registry.snapshot('new')).not.toBeNull()
  })

  it('rotates through retained sessions above the capture limit without losing state', async () => {
    const captured: number[] = []
    const h = harness({
      maxWatchers: 2,
      capture: async (target) => {
        captured.push(target.pid)
        return frame(String(target.pid))
      },
    })
    for (let pid = 1; pid <= 5; pid += 1) {
      h.registry.watch(`s${pid}`, { pid, windowId: pid }, { retained: true })
    }
    expect(h.registry.size).toBe(5)
    await h.registry.tickNow()
    expect(captured).toEqual([1, 2])
    await h.registry.tickNow()
    expect(captured).toEqual([1, 2, 3, 4])
    await h.registry.tickNow()
    expect(captured).toEqual([1, 2, 3, 4, 5, 1])
    for (let pid = 1; pid <= 5; pid += 1) {
      expect(h.registry.snapshot(`s${pid}`)?.frame?.base64).toBe(String(pid))
    }
  })

  it('unwatch stops and removes the watcher', () => {
    const h = harness()
    h.registry.watch('s1', { pid: 1, windowId: 1 })
    expect(h.registry.unwatch('s1')).toBe(true)
    expect(h.registry.unwatch('s1')).toBe(false)
    expect(h.registry.size).toBe(0)
  })

  it('tickNow stores the captured frame', async () => {
    const h = harness()
    h.registry.watch('s1', { pid: 7, windowId: 70 })
    await h.registry.tickNow('s1')
    const snap = h.registry.snapshot('s1')
    expect(snap?.frames).toBe(1)
    expect(snap?.frame?.base64).toBe('7:70')
    expect(snap?.error).toBeNull()
  })

  it('rejects an old capture after retargeting and avoids overlapping captures', async () => {
    const pending = deferred<Frame>()
    const capture = vi.fn(async (target: WatchTarget) => (
      target.pid === 1 ? pending.promise : frame('new')
    ))
    const h = harness({ capture })
    h.registry.watch('s1', { pid: 1, windowId: 10 })
    const firstTick = h.registry.tickNow('s1')
    h.registry.watch('s1', { pid: 2, windowId: 20 })
    await h.registry.tickNow('s1')
    expect(capture).toHaveBeenCalledTimes(1)
    pending.resolve(frame('old'))
    await firstTick
    expect(h.registry.snapshot('s1')?.frame).toBeNull()
    await h.registry.tickNow('s1')
    expect(h.registry.snapshot('s1')?.frame?.base64).toBe('new')
  })

  it('does not discard an inflight frame when the same target is watched again', async () => {
    const pending = deferred<Frame>()
    const h = harness({ capture: () => pending.promise })
    h.registry.watch('s1', { pid: 1, windowId: 10 }, { retained: true })
    const tick = h.registry.tickNow('s1')
    h.registry.watch('s1', { pid: 1, windowId: 10 })
    pending.resolve(frame('current'))
    await tick
    expect(h.registry.snapshot('s1')?.frame?.base64).toBe('current')
    h.setNow(90_000)
    await h.registry.tickNow('s1')
    expect(h.registry.snapshot('s1')).not.toBeNull()
  })

  it('ignores errors from a previous target without trying to rebind it', async () => {
    const pending = deferred<Frame>()
    const listWindows = vi.fn(async () => [win(1, 11)])
    const h = harness({ capture: () => pending.promise, listWindows })
    h.registry.watch('s1', { pid: 1, windowId: 10 })
    const tick = h.registry.tickNow('s1')
    h.registry.watch('s1', { pid: 2, windowId: 20 })
    pending.reject(new CuaError('window_id_not_found', 'window_gone'))
    await tick
    expect(listWindows).not.toHaveBeenCalled()
    expect(h.registry.snapshot('s1')?.error).toBeNull()
    expect(h.registry.snapshot('s1')?.target).toEqual({ pid: 2, windowId: 20 })
  })

  it('keeps one shared concurrency limit across ticks, closure, and recreation', async () => {
    const pending = deferred<Frame>()
    const capture = vi.fn(async (target: WatchTarget) => (
      target.pid === 1 ? pending.promise : frame('new')
    ))
    const h = harness({ maxWatchers: 1, capture })
    h.registry.watch('s1', { pid: 1, windowId: 10 }, { retained: true })
    const firstTick = h.registry.tickNow()
    h.registry.unwatch('s1')
    h.registry.watch('s1', { pid: 2, windowId: 20 }, { retained: true })
    h.registry.watch('s2', { pid: 3, windowId: 30 }, { retained: true })
    await Promise.all([h.registry.tickNow(), h.registry.tickNow('s1'), h.registry.tickNow('s2')])
    expect(capture).toHaveBeenCalledTimes(1)
    pending.resolve(frame('closed'))
    await firstTick
    expect(h.registry.snapshot('s1')?.frame).toBeNull()
    await h.registry.tickNow()
    expect(capture).toHaveBeenCalledTimes(2)
    expect(h.registry.snapshot('s1')?.frame?.base64).toBe('new')
    await h.registry.tickNow()
    expect(h.registry.snapshot('s2')?.frame?.base64).toBe('new')
  })

  it('keeps the last frame and records the error on a transient failure', async () => {
    const h = harness()
    h.registry.watch('s1', { pid: 7, windowId: 70 })
    await h.registry.tickNow('s1')
    h.failWith(new CuaError('No content produced', 'capture_failed'))
    await h.registry.tickNow('s1')
    const snap = h.registry.snapshot('s1')
    expect(snap?.frames).toBe(1)
    expect(snap?.frame?.base64).toBe('7:70')
    expect(snap?.error).toBe('No content produced')
  })

  it('rebinds to the pid’s current window when the target is gone', async () => {
    const h = harness()
    h.registry.watch('s1', { pid: 7, windowId: 70 })
    h.failWith(new CuaError('window_id_not_found', 'window_gone'))
    h.windows = [win(7, 71)]
    await h.registry.tickNow('s1')
    const snap = h.registry.snapshot('s1')
    expect(snap?.target).toEqual({ pid: 7, windowId: 71 })
    expect(snap?.error).toBe('window_id_not_found')
    expect(snap?.captureLifecycle).toMatchObject({ phase: 'recovering', retryCount: 1, nextRetryAt: 1500 })
    // the rebound target captures fine afterwards
    h.failWith(null)
    h.setNow(1500)
    await h.registry.tickNow('s1')
    expect(h.registry.snapshot('s1')?.frame?.base64).toBe('7:71')
  })

  it('clears the cached frame before showing a rebound window', async () => {
    const h = harness()
    h.registry.watch('s1', { pid: 7, windowId: 70 })
    await h.registry.tickNow('s1')
    h.failWith(new CuaError('window_id_not_found', 'window_gone'))
    h.windows = [win(7, 71)]
    await h.registry.tickNow('s1')
    expect(h.registry.snapshot('s1')?.target).toEqual({ pid: 7, windowId: 71 })
    expect(h.registry.snapshot('s1')?.frame).toBeNull()
  })

  it('does not let a pending rebind replace a newer target', async () => {
    const pending = deferred<CuaWindow[]>()
    const listWindows = vi.fn(() => pending.promise)
    const h = harness({ listWindows })
    h.failWith(new CuaError('window_id_not_found', 'window_gone'))
    h.registry.watch('s1', { pid: 1, windowId: 10 })
    const tick = h.registry.tickNow('s1')
    // The capture rejection reaches rebind on the next microtask.
    await Promise.resolve()
    expect(listWindows).toHaveBeenCalledOnce()
    h.registry.watch('s1', { pid: 2, windowId: 20 })
    pending.resolve([win(1, 11)])
    await tick
    expect(h.registry.snapshot('s1')?.target).toEqual({ pid: 2, windowId: 20 })
    expect(h.registry.snapshot('s1')?.error).toBeNull()
  })

  it('records an error when no rebind candidate exists', async () => {
    const h = harness()
    h.registry.watch('s1', { pid: 7, windowId: 70 })
    h.failWith(new CuaError('window_id_not_found', 'window_gone'))
    h.windows = []
    await h.registry.tickNow('s1')
    expect(h.registry.snapshot('s1')?.error).toContain('no other window')
  })

  it('reaps an idle watcher on its next tick', async () => {
    const h = harness()
    h.registry.watch('s1', { pid: 1, windowId: 1 })
    h.setNow(1_000 + 45_001)
    await h.registry.tickNow('s1')
    expect(h.registry.size).toBe(0)
  })

  it('touch keeps the watcher alive', async () => {
    const h = harness()
    h.registry.watch('s1', { pid: 1, windowId: 1 })
    h.setNow(1_000 + 44_000)
    h.registry.touch('s1')
    h.setNow(1_000 + 44_000 + 44_000)
    await h.registry.tickNow('s1')
    expect(h.registry.size).toBe(1)
  })

  it('keeps retained sessions capturing when no visible client fetches their frame', async () => {
    const h = harness()
    h.registry.watch('s1', { pid: 1, windowId: 1 }, { retained: true })
    await h.registry.tickNow('s1')
    h.setNow(1_000 + 45_001)
    await h.registry.tickNow('s1')
    expect(h.registry.snapshot('s1')?.frames).toBe(2)
    expect(h.registry.snapshot('s1')?.lastFetchAt).toBe(1_000)
    expect(h.registry.unwatch('s1')).toBe(true)
    expect(h.registry.snapshot('s1')).toBeNull()
  })

  it('supports retention changes and gives a released watcher a fresh idle TTL', async () => {
    const h = harness()
    expect(h.registry.retain('missing')).toBe(false)
    h.registry.watch('s1', { pid: 1, windowId: 1 })
    expect(h.registry.retain('s1')).toBe(true)
    h.setNow(90_000)
    await h.registry.tickNow('s1')
    expect(h.registry.size).toBe(1)
    expect(h.registry.retain('s1', false)).toBe(true)
    h.setNow(90_000 + 45_000)
    await h.registry.tickNow('s1')
    expect(h.registry.size).toBe(1)
    h.setNow(90_000 + 45_001)
    await h.registry.tickNow('s1')
    expect(h.registry.size).toBe(0)
  })

  it('uses the shared timer to rotate retained sessions and stops it on disposal', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const captured: number[] = []
    const h = harness({
      autoStart: true,
      now: Date.now,
      maxWatchers: 1,
      capture: async (target) => {
        captured.push(target.pid)
        return frame()
      },
    })
    try {
      h.registry.watch('s1', { pid: 1, windowId: 10 }, { retained: true })
      h.registry.watch('s2', { pid: 2, windowId: 20 }, { retained: true })
      await vi.advanceTimersByTimeAsync(2_100)
      expect(captured).toEqual([1, 2, 1, 2, 1, 2])
      h.registry.dispose()
      await vi.advanceTimersByTimeAsync(3_000)
      expect(captured).toEqual([1, 2, 1, 2, 1, 2])
    } finally {
      h.registry.dispose()
      vi.useRealTimers()
    }
  })

  it('subscribes to existing state without opening a missing watcher', async () => {
    const h = harness()
    const received: Array<WatcherSnapshot | null> = []
    const unsubscribe = h.registry.subscribe('s1', (state) => received.push(state))
    expect(received).toEqual([null])
    expect(h.registry.size).toBe(0)

    h.registry.watch('s1', { pid: 1, windowId: 10 })
    expect(received.at(-1)?.frame).toBeNull()
    await h.registry.tickNow('s1')
    expect(received.at(-1)?.frame?.base64).toBe('1:10')

    const immediate = vi.fn()
    const unsubscribeSecond = h.registry.subscribe('s1', immediate)
    expect(immediate).toHaveBeenCalledOnce()
    expect(immediate.mock.calls[0]?.[0].frames).toBe(1)
    unsubscribe()
    const count = received.length
    await h.registry.tickNow('s1')
    expect(received).toHaveLength(count)
    expect(immediate).toHaveBeenCalledTimes(2)
    unsubscribeSecond()
  })

  it('publishes errors and isolates a failing display listener', async () => {
    const h = harness()
    h.registry.watch('s1', { pid: 1, windowId: 10 })
    h.registry.subscribe('s1', () => { throw new Error('display disconnected') })
    const received: Array<WatcherSnapshot | null> = []
    h.registry.subscribe('s1', (state) => received.push(state))
    await h.registry.tickNow('s1')
    h.failWith(new Error('capture unavailable'))
    await h.registry.tickNow('s1')
    expect(received.at(-1)?.error).toBe('capture unavailable')
    expect(received.at(-1)?.frame?.base64).toBe('1:10')
    expect(received.at(-1)?.frames).toBe(1)
    h.failWith(null)
    await h.registry.tickNow('s1')
    expect(received.at(-1)?.error).toBeNull()
    expect(received.at(-1)?.frames).toBe(2)
  })

  it('publishes retargeting immediately and never delivers its obsolete capture', async () => {
    const pending = deferred<Frame>()
    const h = harness({
      capture: async (target) => target.pid === 1 ? pending.promise : frame('new'),
    })
    h.registry.watch('s1', { pid: 1, windowId: 10 })
    const received: Array<WatcherSnapshot | null> = []
    h.registry.subscribe('s1', (state) => received.push(state))
    const tick = h.registry.tickNow('s1')
    h.registry.watch('s1', { pid: 2, windowId: 20 })
    expect(received.at(-1)?.target).toEqual({ pid: 2, windowId: 20 })
    expect(received.at(-1)?.frame).toBeNull()
    const count = received.length
    pending.resolve(frame('obsolete'))
    await tick
    expect(received).toHaveLength(count)
    await h.registry.tickNow('s1')
    expect(received.at(-1)?.frame?.base64).toBe('new')
  })

  it('refreshes in place without closing subscriptions or accepting an old-size frame', async () => {
    const pending = deferred<Frame>()
    const capture = vi.fn()
      .mockResolvedValueOnce(frame('first-size'))
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(frame('resized'))
    const h = harness({ capture })
    expect(h.registry.refresh('missing')).toBe(false)
    h.registry.watch('s1', { pid: 1, windowId: 10 }, { retained: true })
    const received: Array<WatcherSnapshot | null> = []
    h.registry.subscribe('s1', (state) => received.push(state))
    await h.registry.tickNow('s1')
    const tick = h.registry.tickNow('s1')
    expect(h.registry.refresh('s1')).toBe(true)
    expect(h.registry.size).toBe(1)
    expect(received.at(-1)).toMatchObject({
      target: { pid: 1, windowId: 10 }, frames: 0, updatedAt: 0, frame: null,
    })
    await h.registry.tickNow('s1')
    expect(capture).toHaveBeenCalledTimes(2)
    const count = received.length
    pending.resolve(frame('obsolete-size'))
    await tick
    expect(received).toHaveLength(count)
    await h.registry.tickNow('s1')
    expect(received.at(-1)?.frame?.base64).toBe('resized')
    expect(received).not.toContain(null)
  })

  it('publishes closure once and ignores captures from a closed watcher after reopening', async () => {
    const pending = deferred<Frame>()
    const h = harness({
      capture: async (target) => target.pid === 1 ? pending.promise : frame('reopened'),
    })
    h.registry.watch('s1', { pid: 1, windowId: 10 })
    const received: Array<WatcherSnapshot | null> = []
    h.registry.subscribe('s1', (state) => received.push(state))
    const tick = h.registry.tickNow('s1')
    h.registry.unwatch('s1')
    expect(received.at(-1)).toBeNull()
    h.registry.watch('s1', { pid: 2, windowId: 20 })
    const count = received.length
    pending.resolve(frame('closed'))
    await tick
    expect(received).toHaveLength(count)
    await h.registry.tickNow('s1')
    expect(received.at(-1)?.frame?.base64).toBe('reopened')
    expect(received.filter((state) => state === null)).toHaveLength(1)
  })

  it('does not deliver an older publication after another subscriber closes the watcher', async () => {
    const h = harness()
    h.registry.watch('s1', { pid: 1, windowId: 10 })
    h.registry.subscribe('s1', (state) => {
      if (state?.frame !== null && state?.frame !== undefined) h.registry.unwatch('s1')
    })
    const received: Array<WatcherSnapshot | null> = []
    h.registry.subscribe('s1', (state) => received.push(state))
    await h.registry.tickNow('s1')
    expect(received.at(-1)).toBeNull()
    expect(received.some((state) => state?.frame !== null && state?.frame !== undefined)).toBe(false)
  })

  it('keeps a subscribed temporary watcher alive until its last reader disconnects', async () => {
    const h = harness()
    h.registry.watch('s1', { pid: 1, windowId: 10 })
    const unsubscribe = h.registry.subscribe('s1', () => {})
    h.setNow(90_000)
    await h.registry.tickNow('s1')
    expect(h.registry.size).toBe(1)
    unsubscribe()
    h.setNow(90_000 + 45_000)
    await h.registry.tickNow('s1')
    expect(h.registry.size).toBe(1)
    h.setNow(90_000 + 45_001)
    await h.registry.tickNow('s1')
    expect(h.registry.size).toBe(0)
  })

  it('starts promptly and schedules from capture start without a 200ms floor or added RTT', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const captured: number[] = []
    const h = harness({
      autoStart: true, now: Date.now, fps: 20,
      capture: async () => {
        captured.push(Date.now())
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
        return frame()
      },
    })
    try {
      h.registry.watch('s1', { pid: 1, windowId: 10 }, { retained: true })
      await vi.advanceTimersByTimeAsync(121)
      expect(captured).toEqual([1_000, 1_050, 1_100])
      expect(h.registry.snapshot('s1')?.frames).toBe(3)
    } finally {
      h.registry.dispose()
      vi.useRealTimers()
    }
  })

  it('accelerates subscribed sessions and returns them to background cadence on disconnect', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const captured: number[] = []
    const h = harness({
      autoStart: true, now: Date.now, fps: 5, backgroundFps: 1,
      capture: async () => {
        captured.push(Date.now())
        return frame()
      },
    })
    try {
      h.registry.watch('s1', { pid: 1, windowId: 10 }, { retained: true })
      await vi.advanceTimersByTimeAsync(500)
      expect(captured).toEqual([1_000])
      const unsubscribe = h.registry.subscribe('s1', () => {})
      await vi.advanceTimersByTimeAsync(401)
      expect(captured).toEqual([1_000, 1_500, 1_700, 1_900])
      unsubscribe()
      await vi.advanceTimersByTimeAsync(998)
      expect(captured).toHaveLength(4)
      await vi.advanceTimersByTimeAsync(1)
      expect(captured).toEqual([1_000, 1_500, 1_700, 1_900, 2_900])
    } finally {
      h.registry.dispose()
      vi.useRealTimers()
    }
  })

  it('uses a newly available slot immediately after a slow capture without overlapping', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const captured: number[] = []
    let active = 0
    let maximum = 0
    const h = harness({
      autoStart: true, now: Date.now, fps: 5, maxWatchers: 1,
      capture: async () => {
        captured.push(Date.now())
        maximum = Math.max(maximum, ++active)
        await new Promise<void>((resolve) => setTimeout(resolve, 350))
        active -= 1
        return frame()
      },
    })
    try {
      h.registry.watch('s1', { pid: 1, windowId: 10 }, { retained: true })
      await vi.advanceTimersByTimeAsync(360)
      expect(captured).toHaveLength(2)
      expect(captured[1]).toBeGreaterThanOrEqual(1_350)
      expect(captured[1]).toBeLessThan(1_360)
      expect(maximum).toBe(1)
    } finally {
      h.registry.dispose()
      vi.useRealTimers()
    }
  })

  it('shares capacity fairly with background sessions while keeping the visible one frequent', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const captured: number[] = []
    const h = harness({
      autoStart: true, now: Date.now, fps: 10, backgroundFps: 1, maxWatchers: 1,
      capture: async (target) => {
        captured.push(target.pid)
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
        return frame()
      },
    })
    try {
      for (let pid = 1; pid <= 5; pid += 1) {
        h.registry.watch(`s${pid}`, { pid, windowId: pid }, { retained: true })
      }
      h.registry.subscribe('s1', () => {})
      await vi.advanceTimersByTimeAsync(310)
      expect(captured.slice(0, 5)).toEqual([1, 2, 3, 4, 5])
      expect(captured.filter((pid) => pid === 1).length).toBeGreaterThanOrEqual(3)
      expect(captured.filter((pid) => pid !== 1)).toEqual([2, 3, 4, 5])
    } finally {
      h.registry.dispose()
      vi.useRealTimers()
    }
  })

  it('schedules a refresh immediately without waiting for the next background deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const capture = vi.fn(async () => frame())
    const h = harness({ autoStart: true, now: Date.now, fps: 5, backgroundFps: 1, capture })
    try {
      h.registry.watch('s1', { pid: 1, windowId: 10 }, { retained: true })
      await vi.advanceTimersByTimeAsync(100)
      expect(capture).toHaveBeenCalledOnce()
      h.registry.refresh('s1')
      await vi.advanceTimersByTimeAsync(1)
      expect(capture).toHaveBeenCalledTimes(2)
    } finally {
      h.registry.dispose()
      vi.useRealTimers()
    }
  })

  it('does not spin when window discovery returns the same unresponsive capture target', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const capture = vi.fn(async () => { throw new CuaError('window_id_not_found', 'window_gone') })
    const h = harness({
      autoStart: true, now: Date.now, fps: 5, capture,
      listWindows: async () => [win(1, 10)],
    })
    try {
      h.registry.watch('s1', { pid: 1, windowId: 10 }, { retained: true })
      await vi.advanceTimersByTimeAsync(199)
      expect(capture).toHaveBeenCalledOnce()
      expect(h.registry.snapshot('s1')?.error).toBe('window_id_not_found')
      await vi.advanceTimersByTimeAsync(1802)
      expect(capture).toHaveBeenCalledTimes(3)
      expect(h.registry.snapshot('s1')?.captureLifecycle?.phase).toBe('failed')
      await vi.advanceTimersByTimeAsync(10_000)
      expect(capture).toHaveBeenCalledTimes(3)
    } finally {
      h.registry.dispose()
      vi.useRealTimers()
    }
  })

  it('never creates a timer for subscriptions or refresh when autoStart is disabled', () => {
    vi.useFakeTimers()
    const h = harness()
    try {
      h.registry.watch('s1', { pid: 1, windowId: 10 })
      h.registry.subscribe('s1', () => {})
      h.registry.refresh('s1')
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      h.registry.dispose()
      vi.useRealTimers()
    }
  })

  it('disposal closes and releases subscriptions and discards an outstanding capture', async () => {
    const pending = deferred<Frame>()
    const h = harness({ capture: () => pending.promise })
    h.registry.watch('s1', { pid: 1, windowId: 10 })
    const listener = vi.fn()
    h.registry.subscribe('s1', listener)
    const missing = vi.fn()
    h.registry.subscribe('missing', missing)
    const tick = h.registry.tickNow('s1')
    h.registry.dispose()
    expect(listener).toHaveBeenLastCalledWith(null)
    expect(missing).toHaveBeenLastCalledWith(null)
    const count = listener.mock.calls.length
    const missingCount = missing.mock.calls.length
    pending.resolve(frame('discarded'))
    await tick
    h.registry.dispose()
    expect(listener).toHaveBeenCalledTimes(count)
    expect(missing).toHaveBeenCalledTimes(missingCount)
    const afterDispose = vi.fn()
    h.registry.subscribe('s1', afterDispose)
    expect(afterDispose).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('drops Screen Recording overlay frames and pauses instead of latching', async () => {
    const h = harness()
    h.capture = async () => ({
      mime: 'image/png',
      base64: 'hijack',
      width: 640,
      height: 250,
      appName: 'universalAccessAuthWarn',
      windowTitle: '录屏',
    })
    h.windows = [
      {
        pid: 4456,
        windowId: 63495,
        appName: 'universalAccessAuthWarn',
        title: '录屏',
        bounds: { x: 0, y: 0, width: 461, height: 181 },
        isOnScreen: true,
      },
    ]
    h.registry.watch('s1', { pid: 4456, windowId: 63464 })
    await h.registry.tickNow('s1')
    const snap = h.registry.snapshot('s1')
    expect(snap?.frame).toBeNull()
    expect(snap?.frames).toBe(0)
    expect(snap?.error).toBe('skipped system capture overlay')
    await h.registry.tickNow('s1')
    expect(h.registry.snapshot('s1')?.frames).toBe(0)
    h.setNow(90_000)
    await h.registry.tickNow('s1')
    expect(h.registry.snapshot('s1')).toBeNull()
  })

  it('dispose clears everything', () => {
    const h = harness()
    h.registry.watch('a', { pid: 1, windowId: 1 })
    h.registry.watch('b', { pid: 2, windowId: 2 })
    h.registry.dispose()
    expect(h.registry.size).toBe(0)
  })
})
