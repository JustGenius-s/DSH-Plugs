import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PipController } from '../src/controller.ts'
import type { CuaWindow, Frame } from '../src/shared/types.ts'
import { WatcherRegistry } from '../src/watcher.ts'

const windows: CuaWindow[] = [
  { pid: 1, windowId: 10, appName: 'Clock', title: 'Clock' },
  { pid: 2, windowId: 20, appName: 'ima', title: 'ima' },
  { pid: 3, windowId: 30, appName: 'Cursor', title: 'Cursor' },
].map((window) => ({
  ...window,
  bounds: { x: 0, y: 0, width: 800, height: 600 },
  isOnScreen: true,
}))

const controllers: PipController[] = []
const toolName = 'mcp__cua-driver__launch_app'
type ResultShape = 'wrapped' | 'plain' | 'nested'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((onResolve) => { resolve = onResolve })
  return { promise, resolve }
}

function call(id: string, args: unknown = {}, shape: ResultShape = 'wrapped') {
  return shape === 'nested'
    ? {
      type: 'tool/code-dispatch-start',
      data: { rootCallId: 'run-code', parentCallId: 'run-code', subCallId: id, name: toolName, arguments: args },
    }
    : {
      type: 'tool/call',
      data: { turn: 1, callId: id, name: toolName, arguments: args },
    }
}

function result(id: string, payload: unknown, shape: ResultShape = 'wrapped', failed = false) {
  const content = [{ type: 'text', text: JSON.stringify(payload) }]
  if (shape === 'nested') {
    return {
      type: 'tool/code-dispatch',
      data: {
        rootCallId: 'run-code',
        parentCallId: 'run-code',
        subCallId: id,
        name: toolName,
        arguments: {},
        content,
        isError: failed,
      },
    }
  }
  return {
    type: 'tool/result',
    data: {
      ...(failed ? { error: { name: 'Error', message: 'launch failed' } } : {}),
      message: {
        source: { kind: 'tool', callId: id },
        content: shape === 'plain' ? content : [{ type: 'tool-result', toolCallId: id, content, isError: failed }],
      },
    },
  }
}

function harness(now?: () => number) {
  const registry = new WatcherRegistry({
    fps: 1,
    maxDimension: 640,
    idleTtlMs: 45_000,
    maxWatchers: 2,
    autoStart: false,
    capture: async (target): Promise<Frame> => ({
      mime: 'image/png',
      base64: `${target.pid}:${target.windowId}`,
      width: 800,
      height: 600,
      appName: 'Application',
      windowTitle: 'Window',
    }),
    listWindows: async () => windows,
  })
  const listWindows = vi.fn(async (): Promise<CuaWindow[]> => windows)
  const openApplication = vi.fn(async (app: string, _signal?: AbortSignal): Promise<CuaWindow> => {
    const window = windows.find((window) => window.appName === app)
    if (window === undefined) throw new Error('Application not found')
    return window
  })
  const controller = new PipController({ registry, listWindows, openApplication, now })
  controllers.push(controller)
  return { controller, registry, listWindows, openApplication }
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000)
})

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
  vi.useRealTimers()
})

describe('PipController session lifecycle', () => {
  it('requires an explicit open before computer use events can create a preview', async () => {
    const h = harness()
    h.controller.ingest('s1', call('c1', { pid: 1, window_id: 10 }))
    h.controller.ingest('s1', result('c1', { pid: 1, window_id: 10 }))
    await settle()
    expect(h.controller.status('s1').open).toBe(false)
    expect(h.registry.size).toBe(0)
    expect(h.listWindows).not.toHaveBeenCalled()
    const opened = await h.controller.open('s1', { app: 'Clock' })
    expect(h.openApplication).toHaveBeenCalledWith('Clock', undefined)
    expect(opened).toMatchObject({ open: true, target: { pid: 1, windowId: 10 } })
  })

  it('retains the selected window after turn end and while another session is in use', async () => {
    const h = harness()
    await h.controller.open('s1', { app: 'Clock' })
    await h.registry.tickNow('s1')
    h.controller.ingest('s1', { type: 'turn/end' })
    await h.controller.open('s2', { app: 'ima' })
    await vi.advanceTimersByTimeAsync(60_000)
    await h.registry.tickNow()
    expect(h.controller.status('s1')).toMatchObject({ open: true, running: false, frames: 2 })
    expect(h.controller.status('s2')).toMatchObject({ open: true, frames: 1 })
    expect(h.registry.size).toBe(2)
    expect(h.controller.sessions().map((session) => session.sessionId)).toEqual(['s1', 's2'])
  })

  it('closes at 30 seconds even if the initiating turn already ended', async () => {
    const h = harness()
    const opened = await h.controller.open('s1', { app: 'Clock', closeAfterSeconds: 30 })
    expect(opened).toMatchObject({ closeAt: 31_000, closedAt: null })
    h.controller.ingest('s1', { type: 'turn/end' })
    await vi.advanceTimersByTimeAsync(29_999)
    await h.registry.tickNow('s1')
    expect(h.controller.status('s1')).toMatchObject({ open: true, running: false, frames: 1 })
    await vi.advanceTimersByTimeAsync(1)
    expect(h.controller.status('s1')).toMatchObject({
      open: false, running: false, closeAt: null, closedAt: 31_000,
    })
    expect(h.registry.snapshot('s1')).toBeNull()
  })

  it('records the actual host timer close time rather than the scheduled deadline', async () => {
    let now = 1_000
    const h = harness(() => now)
    const opened = await h.controller.open('s1', { app: 'Clock', closeAfterSeconds: 30 })
    expect(opened.closeAt).toBe(31_000)
    now = 35_000
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.controller.status('s1')).toMatchObject({ open: false, closeAt: null, closedAt: 35_000 })
    expect(h.controller.sessions()[0]).toMatchObject({ closedAt: 35_000, updatedAt: 35_000 })
  })

  it('keeps the first close time until a successful reopen and leaves a never-opened session untimestamped', async () => {
    const h = harness()
    expect(h.controller.status('s1')).toMatchObject({ open: false, closedAt: null })
    expect(h.controller.close('s1')).toMatchObject({ open: false, closedAt: null })
    expect(h.controller.sessions()).toEqual([])
    await h.controller.open('s1', { app: 'Clock', closeAfterSeconds: 30 })
    await vi.advanceTimersByTimeAsync(5_000)
    const closed = h.controller.close('s1')
    expect(closed).toMatchObject({ open: false, closeAt: null, closedAt: 6_000 })
    const activity = h.controller.sessions()[0]
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.controller.close('s1')).toEqual(closed)
    expect(h.controller.sessions()[0]).toEqual(activity)
    expect(h.registry.snapshot('s1')).toBeNull()

    const reopened = await h.controller.open('s1', { app: 'ima' })
    expect(reopened).toMatchObject({ open: true, closeAt: null, closedAt: null })
    expect(h.controller.sessions()[0]?.closedAt).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.controller.close('s1')).toMatchObject({ open: false, closedAt: 37_000 })
  })

  it('still cancels a pending reopen on repeated close without changing the original close time', async () => {
    const h = harness()
    await h.controller.open('s1', { app: 'Clock' })
    h.controller.close('s1')
    const pending = deferred<CuaWindow>()
    h.openApplication.mockImplementationOnce(() => pending.promise)
    const opening = h.controller.open('s1', { app: 'Cursor' })
    const rejected = expect(opening).rejects.toThrow(/superseded|closed/)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.controller.close('s1')).toMatchObject({ open: false, closedAt: 1_000 })
    pending.resolve(windows[2])
    await rejected
    expect(h.controller.status('s1')).toMatchObject({ open: false, closedAt: 1_000 })
    expect(h.registry.snapshot('s1')).toBeNull()
  })

  it('does not let later tool activity reopen a closed preview, but permits explicit reopen', async () => {
    const h = harness()
    await h.controller.open('s1', { app: 'Clock' })
    h.controller.close('s1')
    h.controller.ingest('s1', call('c1', { pid: 3, window_id: 30 }, 'nested'))
    h.controller.ingest('s1', result('c1', { pid: 3 }, 'nested'))
    await settle()
    expect(h.controller.status('s1').open).toBe(false)
    expect(h.registry.snapshot('s1')).toBeNull()
    await h.controller.open('s1', { app: 'ima' })
    expect(h.controller.status('s1')).toMatchObject({ open: true, target: { pid: 2, windowId: 20 } })
  })

  it('replaces an old close deadline when the agent explicitly reopens the preview', async () => {
    const h = harness()
    await h.controller.open('s1', { app: 'Clock', closeAfterSeconds: 30 })
    await vi.advanceTimersByTimeAsync(10_000)
    await h.controller.open('s1', { app: 'ima', closeAfterSeconds: 30 })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(h.controller.status('s1')).toMatchObject({ open: true, closeAt: 41_000 })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(h.controller.status('s1').open).toBe(false)
  })

  it('can replace a close schedule without changing the selected application', async () => {
    const h = harness()
    await h.controller.open('s1', { app: 'Clock', closeAfterSeconds: 30 })
    await vi.advanceTimersByTimeAsync(5_000)
    h.controller.scheduleClose('s1', 60)
    await vi.advanceTimersByTimeAsync(25_000)
    expect(h.controller.status('s1')).toMatchObject({
      open: true, closeAt: 66_000, target: { pid: 1, windowId: 10 },
    })
    await vi.advanceTimersByTimeAsync(35_000)
    expect(h.controller.status('s1').open).toBe(false)
  })

  it('uses an explicitly selected pid instead of the previous application window', async () => {
    const h = harness()
    await h.controller.open('s1', { app: 'Clock' })
    await h.controller.open('s1', { pid: 2 })
    expect(h.controller.status('s1').target).toEqual({ pid: 2, windowId: 20 })
  })

  it('invalidates an application launch if its session is removed before the window resolves', async () => {
    const h = harness()
    const pending = deferred<CuaWindow>()
    h.openApplication.mockImplementationOnce(() => pending.promise)
    const opening = h.controller.open('s1', { app: 'Cursor' })
    const rejected = expect(opening).rejects.toThrow(/superseded|closed/)
    h.controller.remove('s1')
    pending.resolve(windows[2])
    await rejected
    expect(h.registry.snapshot('s1')).toBeNull()
    expect(h.controller.sessions()).toEqual([])
  })

  it('does not let an earlier application launch overwrite a later explicit open', async () => {
    const h = harness()
    const pending = deferred<CuaWindow>()
    h.openApplication.mockImplementationOnce(() => pending.promise)
    const opening = h.controller.open('s1', { app: 'Cursor' })
    const rejected = expect(opening).rejects.toThrow(/superseded|closed/)
    await h.controller.open('s1', { app: 'ima' })
    pending.resolve(windows[2])
    await rejected
    expect(h.controller.status('s1').target).toEqual({ pid: 2, windowId: 20 })
  })

  it('keeps close timers isolated to their owning sessions', async () => {
    const h = harness()
    await h.controller.open('s1', { app: 'Clock', closeAfterSeconds: 30 })
    await h.controller.open('s2', { app: 'ima' })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.controller.status('s1').open).toBe(false)
    expect(h.controller.status('s2')).toMatchObject({ open: true, target: { pid: 2, windowId: 20 } })
    expect(h.registry.size).toBe(1)
  })

  it('does not let a delayed UI close dismiss a newer explicit open', async () => {
    const h = harness()
    await h.controller.open('s1', { app: 'Clock' })
    const oldOpenedAt = h.controller.sessions()[0].openedAt
    await h.controller.open('s1', { app: 'ima' })
    expect(h.controller.close('s1', oldOpenedAt)).toMatchObject({
      open: true, target: { pid: 2, windowId: 20 }, closedAt: null,
    })
    expect(h.registry.size).toBe(1)
    h.controller.close('s1', h.controller.sessions()[0].openedAt)
    expect(h.registry.size).toBe(0)
  })
})

describe('PipController tool observations', () => {
  it.each<ResultShape>(['wrapped', 'plain', 'nested'])('follows the pid from a correlated %s result', async (shape) => {
    const h = harness()
    await h.controller.open('s1', { app: 'Clock' })
    await h.registry.tickNow('s1')
    h.controller.ingest('s1', call('launch-ima', { bundle_id: 'com.example.ima' }, shape))
    h.controller.ingest('s1', result('launch-ima', { pid: 2 }, shape))
    await settle()
    expect(h.controller.status('s1').target).toEqual({ pid: 2, windowId: 20 })
    expect(h.registry.snapshot('s1')?.frame).toBeNull()
  })

  it.each<ResultShape>(['wrapped', 'plain', 'nested'])('ignores an old %s result after close and reopen', async (shape) => {
    const h = harness()
    await h.controller.open('s1', { app: 'Clock' })
    h.controller.ingest('s1', call('old-launch', {}, shape))
    h.controller.close('s1')
    await h.controller.open('s1', { app: 'ima' })
    h.controller.ingest('s1', result('old-launch', { pid: 3 }, shape))
    await settle()
    expect(h.controller.status('s1').target).toEqual({ pid: 2, windowId: 20 })
  })

  it.each<ResultShape>(['wrapped', 'plain', 'nested'])('prevents an older %s result from overriding the latest call', async (shape) => {
    const h = harness()
    await h.controller.open('s1', { app: 'Clock' })
    h.controller.ingest('s1', call('old-launch', {}, shape))
    h.controller.ingest('s1', call('new-launch', {}, shape))
    h.controller.ingest('s1', result('new-launch', { pid: 3 }, shape))
    h.controller.ingest('s1', result('old-launch', { pid: 2 }, shape))
    await settle()
    expect(h.controller.status('s1').target).toEqual({ pid: 3, windowId: 30 })
  })

  it.each<ResultShape>(['wrapped', 'plain', 'nested'])('ignores a failed %s result', async (shape) => {
    const h = harness()
    await h.controller.open('s1', { app: 'Clock' })
    h.controller.ingest('s1', call('failed-launch', {}, shape))
    h.controller.ingest('s1', result('failed-launch', { pid: 2 }, shape, true))
    await settle()
    expect(h.controller.status('s1').target).toEqual({ pid: 1, windowId: 10 })
    expect(h.listWindows).not.toHaveBeenCalled()
  })

  it('correlates equal call ids separately for each session', async () => {
    const h = harness()
    await h.controller.open('s1', { app: 'Clock' })
    await h.controller.open('s2', { app: 'Clock' })
    h.controller.ingest('s1', call('same-id', {}, 'nested'))
    h.controller.ingest('s2', call('same-id', {}, 'nested'))
    h.controller.ingest('s2', result('same-id', { pid: 3 }, 'nested'))
    h.controller.ingest('s1', result('same-id', { pid: 2 }, 'nested'))
    await settle()
    expect(h.controller.status('s1').target).toEqual({ pid: 2, windowId: 20 })
    expect(h.controller.status('s2').target).toEqual({ pid: 3, windowId: 30 })
  })

  it('ignores an old discovery request after close and reopen', async () => {
    const h = harness()
    const pending = deferred<CuaWindow[]>()
    await h.controller.open('s1', { app: 'Clock' })
    h.listWindows.mockImplementationOnce(() => pending.promise)
    h.controller.ingest('s1', call('old-selection', { pid: 3, window_id: 30 }))
    h.controller.close('s1')
    await h.controller.open('s1', { app: 'ima' })
    pending.resolve(windows)
    await settle()
    expect(h.controller.status('s1').target).toEqual({ pid: 2, windowId: 20 })
  })

  it('prevents a slower discovery request from replacing a more recent selection', async () => {
    const h = harness()
    const pending = deferred<CuaWindow[]>()
    await h.controller.open('s1', { app: 'Clock' })
    h.listWindows.mockImplementationOnce(() => pending.promise)
    h.controller.ingest('s1', call('old-selection', { pid: 2, window_id: 20 }))
    h.controller.ingest('s1', call('new-selection', { pid: 3, window_id: 30 }))
    await settle()
    expect(h.controller.status('s1').target).toEqual({ pid: 3, windowId: 30 })
    pending.resolve(windows)
    await settle()
    expect(h.controller.status('s1').target).toEqual({ pid: 3, windowId: 30 })
  })

  it('disposes timers and ignores pending discovery when the plugin is unloaded', async () => {
    const h = harness()
    const pending = deferred<CuaWindow[]>()
    await h.controller.open('s1', { app: 'Clock', closeAfterSeconds: 30 })
    h.listWindows.mockImplementationOnce(() => pending.promise)
    h.controller.ingest('s1', call('selection', { pid: 2, window_id: 20 }))
    h.controller.dispose()
    pending.resolve(windows)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.registry.size).toBe(0)
    expect(h.controller.sessions()).toEqual([])
  })
})
