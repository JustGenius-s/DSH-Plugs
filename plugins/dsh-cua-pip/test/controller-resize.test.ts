import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PipController, type ResizePreview } from '../src/controller.ts'
import { CuaError } from '../src/cua.ts'
import type { CuaWindow, Frame, WatchTarget, WindowSize } from '../src/shared/types.ts'
import { WatcherRegistry } from '../src/watcher.ts'

const windows: CuaWindow[] = [
  { pid: 1, windowId: 10, appName: 'Clock', title: 'Clock' },
  { pid: 2, windowId: 20, appName: 'ima', title: 'ima' },
].map((window) => ({
  ...window, bounds: { x: 50, y: 80, width: 800, height: 600 }, isOnScreen: true,
}))
const controllers: PipController[] = []

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  return { promise, resolve, reject }
}

function resizedWindow(size: WindowSize, index = 0): CuaWindow {
  const window = windows[index]!
  return { ...window, bounds: { ...window.bounds, ...size } }
}

function harness() {
  const listWindows = vi.fn(async (): Promise<CuaWindow[]> => windows)
  const capture = vi.fn(async (): Promise<Frame> => ({
    mime: 'image/png', base64: 'before', width: 640, height: 480,
    appName: 'Clock', windowTitle: 'Clock', windowBounds: { ...windows[0]!.bounds },
  }))
  const registry = new WatcherRegistry({
    fps: 1, maxDimension: 640, idleTtlMs: 45_000, maxWatchers: 2, autoStart: false,
    capture, listWindows,
  })
  const resizeApplicationWindow = vi.fn(async (
    target: WatchTarget, size: WindowSize, _signal?: AbortSignal,
  ): Promise<CuaWindow> => resizedWindow(size, windows.findIndex((window) => window.pid === target.pid)))
  const controller = new PipController({
    registry,
    listWindows,
    openApplication: async (app) => windows.find((window) => window.appName === app)!,
    resizeApplicationWindow,
  })
  controllers.push(controller)
  return { controller, registry, capture, listWindows, resizeApplicationWindow }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000)
})

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
  vi.useRealTimers()
})

describe('PipController agent resizing', () => {
  it('defaults to resizing the watched application and reports its actual clamped bounds', async () => {
    const h = harness()
    const abort = new AbortController()
    await h.controller.open('s1', { app: 'Clock' })
    await h.registry.tickNow('s1')
    h.resizeApplicationWindow.mockResolvedValueOnce(resizedWindow({ width: 640, height: 480 }))
    const status = await h.controller.resize('s1', { width: 300, height: 200 }, abort.signal)
    expect(h.resizeApplicationWindow).toHaveBeenCalledWith(
      { pid: 1, windowId: 10 }, { width: 300, height: 200 }, abort.signal,
    )
    expect(status).toMatchObject({
      open: true, target: { pid: 1, windowId: 10 }, previewSize: null,
      windowBounds: { x: 50, y: 80, width: 640, height: 480 },
    })
    expect(h.registry.snapshot('s1')?.frame).toBeNull()
    expect(h.controller.sessions()[0]?.windowBounds).toEqual(status.windowBounds)
  })

  it('returns the actual bounds of a replacement window discovered automatically by its watcher', async () => {
    const h = harness()
    await h.controller.open('s1', { app: 'Clock' })
    const replacement = { ...resizedWindow({ width: 900, height: 650 }), windowId: 11 }
    h.listWindows.mockResolvedValueOnce([replacement])
    h.capture.mockRejectedValueOnce(new CuaError('original Clock window closed', 'window_gone'))
    await h.registry.tickNow('s1')
    expect(h.registry.snapshot('s1')?.target).toEqual({ pid: 1, windowId: 11 })
    const actual = { ...replacement, bounds: { ...replacement.bounds, width: 1000, height: 700 } }
    h.resizeApplicationWindow.mockResolvedValueOnce(actual)
    const status = await h.controller.resize('s1', { width: 1000, height: 700 })
    expect(h.resizeApplicationWindow).toHaveBeenCalledWith(
      { pid: 1, windowId: 11 }, { width: 1000, height: 700 }, undefined,
    )
    expect(status).toMatchObject({
      open: true, target: { pid: 1, windowId: 11 }, windowBounds: actual.bounds,
    })
    expect(h.controller.sessions()[0]).toMatchObject({
      target: { pid: 1, windowId: 11 }, windowBounds: actual.bounds,
    })
  })

  it('publishes a preview-only preference without altering the native app or another session', async () => {
    const h = harness()
    await h.controller.open('s1', { app: 'Clock' })
    await h.controller.open('s2', { app: 'ima' })
    await h.registry.tickNow('s1')
    h.controller.ingest('s1', { type: 'turn/end' })
    const status = await h.controller.resize('s1', { resizeTarget: 'preview', width: 480, height: 320 })
    expect(status).toMatchObject({
      open: true, running: false, frames: 1,
      previewSize: { width: 480, height: 320 }, windowBounds: windows[0]!.bounds,
    })
    expect(h.controller.sessions()).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: 's1', previewSize: { width: 480, height: 320 } }),
      expect.objectContaining({ sessionId: 's2', target: { pid: 2, windowId: 20 } }),
    ]))
    expect(h.controller.status('s2').previewSize).toBeNull()
    expect(h.resizeApplicationWindow).not.toHaveBeenCalled()
  })

  it.each(['application', 'preview'] as const)('preserves the host close deadline while resizing %s', async (resizeTarget) => {
    const h = harness()
    await h.controller.open('s1', { app: 'Clock', closeAfterSeconds: 30 })
    await vi.advanceTimersByTimeAsync(12_000)
    expect(await h.controller.resize('s1', { resizeTarget, width: 480, height: 320 }))
      .toMatchObject({ open: true, closeAt: 31_000 })
    await vi.advanceTimersByTimeAsync(17_999)
    expect(h.controller.status('s1').open).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.controller.status('s1')).toMatchObject({ open: false, closeAt: null })
    expect(h.registry.snapshot('s1')).toBeNull()
  })

  it.each(['application', 'preview'] as const)('rejects %s resize before open and after a user close', async (resizeTarget) => {
    const h = harness()
    const input = { resizeTarget, width: 480, height: 320 }
    await expect(h.controller.resize('s1', input)).rejects.toThrow(/Open a PiP/)
    await h.controller.open('s1', { app: 'Clock' })
    h.controller.close('s1')
    await expect(h.controller.resize('s1', input)).rejects.toThrow(/Open a PiP/)
    expect(h.controller.status('s1').open).toBe(false)
    expect(h.resizeApplicationWindow).not.toHaveBeenCalled()
    expect(h.registry.size).toBe(0)
  })

  it.each([
    { width: 0, height: 600 },
    { width: 800, height: -1 },
    { width: 800.5, height: 600 },
    { width: 800, height: Number.NaN },
    { width: Number.POSITIVE_INFINITY, height: 600 },
    { width: 16_385, height: 600 },
    { width: 800, height: 16_385 },
    { resizeTarget: 'preview', width: 63, height: 600 },
    { resizeTarget: 'preview', width: 800, height: 63 },
    { resizeTarget: 'desktop', width: 800, height: 600 },
  ])('rejects unsafe or unsupported dimensions before any mutation: %j', async (input) => {
    const h = harness()
    await h.controller.open('s1', { app: 'Clock' })
    await expect(h.controller.resize('s1', input as ResizePreview)).rejects.toThrow(/width|height|resizeTarget/)
    expect(h.resizeApplicationWindow).not.toHaveBeenCalled()
    expect(h.controller.status('s1')).toMatchObject({ windowBounds: windows[0]!.bounds, previewSize: null })
  })

  it('leaves the current frame and preference intact when native resizing fails', async () => {
    const h = harness()
    await h.controller.open('s1', { app: 'Clock', closeAfterSeconds: 30 })
    await h.controller.resize('s1', { resizeTarget: 'preview', width: 480, height: 320 })
    await h.registry.tickNow('s1')
    h.resizeApplicationWindow.mockRejectedValueOnce(new Error('window is not resizable'))
    await expect(h.controller.resize('s1', { width: 1000, height: 700 })).rejects.toThrow('window is not resizable')
    expect(h.controller.status('s1')).toMatchObject({
      open: true, frames: 1, closeAt: 31_000,
      windowBounds: windows[0]!.bounds, previewSize: { width: 480, height: 320 },
    })
  })

  it('rejects a resize result that belongs to a different native window', async () => {
    const h = harness()
    await h.controller.open('s1', { app: 'Clock' })
    h.resizeApplicationWindow.mockResolvedValueOnce(resizedWindow({ width: 1200, height: 700 }, 1))
    await expect(h.controller.resize('s1', { width: 1200, height: 700 })).rejects.toThrow(/different application window/)
    expect(h.controller.status('s1')).toMatchObject({
      target: { pid: 1, windowId: 10 }, windowBounds: windows[0]!.bounds,
    })
  })

  it.each(['manual', 'deadline', 'remove', 'dispose'] as const)(
    'never recreates a watcher when %s closes a preview during native resize',
    async (close) => {
      const h = harness()
      const pending = deferred<CuaWindow>()
      await h.controller.open('s1', { app: 'Clock', closeAfterSeconds: 30 })
      h.resizeApplicationWindow.mockImplementationOnce(() => pending.promise)
      const resizing = h.controller.resize('s1', { width: 1000, height: 700 })
      const rejected = expect(resizing).rejects.toThrow(/closed|changed/)
      await vi.advanceTimersByTimeAsync(0)
      expect(h.resizeApplicationWindow).toHaveBeenCalledTimes(1)
      if (close === 'deadline') await vi.advanceTimersByTimeAsync(30_000)
      else if (close === 'remove') h.controller.remove('s1')
      else if (close === 'dispose') h.controller.dispose()
      else h.controller.close('s1')
      pending.resolve(resizedWindow({ width: 1000, height: 700 }))
      await rejected
      expect(h.controller.status('s1').open).toBe(false)
      expect(h.registry.snapshot('s1')).toBeNull()
    },
  )

  it.each(['reopen', 'computer use'] as const)('does not overwrite the newer target after %s changes it', async (change) => {
    const h = harness()
    const pending = deferred<CuaWindow>()
    await h.controller.open('s1', { app: 'Clock' })
    h.resizeApplicationWindow.mockImplementationOnce(() => pending.promise)
    const resizing = h.controller.resize('s1', { width: 1000, height: 700 })
    const rejected = expect(resizing).rejects.toThrow(/closed|changed/)
    await vi.advanceTimersByTimeAsync(0)
    if (change === 'reopen') {
      await h.controller.open('s1', { app: 'ima' })
    } else {
      h.controller.ingest('s1', {
        type: 'tool/call',
        data: { name: 'mcp__cua-driver__get_window_state', callId: 'read-ima', arguments: { pid: 2, window_id: 20 } },
      })
      await vi.advanceTimersByTimeAsync(0)
    }
    pending.resolve(resizedWindow({ width: 1000, height: 700 }))
    await rejected
    expect(h.controller.status('s1')).toMatchObject({
      open: true, target: { pid: 2, windowId: 20 }, windowBounds: windows[1]!.bounds,
    })
    expect(h.registry.snapshot('s1')?.target).toEqual({ pid: 2, windowId: 20 })
  })

  it('serializes native sizes for the same session so a slower first request cannot win', async () => {
    const h = harness()
    const first = deferred<CuaWindow>()
    const second = deferred<CuaWindow>()
    await h.controller.open('s1', { app: 'Clock' })
    h.resizeApplicationWindow
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const firstResize = h.controller.resize('s1', { width: 1000, height: 700 })
    const secondResize = h.controller.resize('s1', { width: 1200, height: 800 })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.resizeApplicationWindow).toHaveBeenCalledTimes(1)
    first.resolve(resizedWindow({ width: 1000, height: 700 }))
    await firstResize
    await vi.advanceTimersByTimeAsync(0)
    expect(h.resizeApplicationWindow).toHaveBeenLastCalledWith(
      { pid: 1, windowId: 10 }, { width: 1200, height: 800 }, undefined,
    )
    second.resolve(resizedWindow({ width: 1200, height: 800 }))
    expect(await secondResize).toMatchObject({ windowBounds: { width: 1200, height: 800 } })
    expect(h.controller.status('s1').windowBounds).toMatchObject({ width: 1200, height: 800 })
  })

  it('serializes native resize and readback across sessions watching the same application window', async () => {
    const h = harness()
    const first = deferred<CuaWindow>()
    const second = deferred<CuaWindow>()
    await h.controller.open('s1', { app: 'Clock' })
    await h.controller.open('s2', { app: 'Clock' })
    h.resizeApplicationWindow
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const firstResize = h.controller.resize('s1', { width: 1000, height: 700 })
    const secondResize = h.controller.resize('s2', { width: 1200, height: 800 })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.resizeApplicationWindow).toHaveBeenCalledTimes(1)
    first.resolve(resizedWindow({ width: 1000, height: 700 }))
    expect(await firstResize).toMatchObject({
      sessionId: 's1', target: { pid: 1, windowId: 10 }, windowBounds: { width: 1000, height: 700 },
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.resizeApplicationWindow).toHaveBeenCalledTimes(2)
    expect(h.resizeApplicationWindow).toHaveBeenLastCalledWith(
      { pid: 1, windowId: 10 }, { width: 1200, height: 800 }, undefined,
    )
    second.resolve(resizedWindow({ width: 1200, height: 800 }))
    expect(await secondResize).toMatchObject({
      sessionId: 's2', target: { pid: 1, windowId: 10 }, windowBounds: { width: 1200, height: 800 },
    })
  })

  it('continues the queue after a failed resize and skips queued work cancelled by the agent', async () => {
    const h = harness()
    const first = deferred<CuaWindow>()
    const abort = new AbortController()
    await h.controller.open('s1', { app: 'Clock' })
    h.resizeApplicationWindow.mockImplementationOnce(() => first.promise)
    const firstResize = h.controller.resize('s1', { width: 1000, height: 700 })
    const firstRejected = expect(firstResize).rejects.toThrow('native resize failed')
    const cancelledResize = h.controller.resize('s1', { width: 1100, height: 750 }, abort.signal)
    const cancelled = expect(cancelledResize).rejects.toThrow('agent cancelled')
    const lastResize = h.controller.resize('s1', { width: 1200, height: 800 })
    await vi.advanceTimersByTimeAsync(0)
    abort.abort(new Error('agent cancelled'))
    first.reject(new Error('native resize failed'))
    await firstRejected
    await cancelled
    expect(await lastResize).toMatchObject({ windowBounds: { width: 1200, height: 800 } })
    expect(h.resizeApplicationWindow).toHaveBeenCalledTimes(2)
  })

  it('rejects a pre-cancelled resize without calling the driver or changing preview size', async () => {
    const h = harness()
    await h.controller.open('s1', { app: 'Clock' })
    const abort = new AbortController()
    abort.abort(new Error('agent cancelled'))
    for (const resizeTarget of ['application', 'preview'] as const) {
      await expect(h.controller.resize('s1', { resizeTarget, width: 480, height: 320 }, abort.signal))
        .rejects.toThrow('agent cancelled')
    }
    expect(h.resizeApplicationWindow).not.toHaveBeenCalled()
    expect(h.controller.status('s1').previewSize).toBeNull()
  })

  it('keeps another session and preview preferences responsive while a native resize is pending', async () => {
    const h = harness()
    const pending = deferred<CuaWindow>()
    await h.controller.open('s1', { app: 'Clock' })
    await h.controller.open('s2', { app: 'ima' })
    h.resizeApplicationWindow.mockImplementationOnce(() => pending.promise)
    const resizing = h.controller.resize('s1', { width: 1000, height: 700 })
    await vi.advanceTimersByTimeAsync(0)
    expect(await h.controller.resize('s2', { width: 1200, height: 800 }))
      .toMatchObject({ target: { pid: 2, windowId: 20 }, windowBounds: { width: 1200, height: 800 } })
    await h.controller.resize('s1', { resizeTarget: 'preview', width: 480, height: 320 })
    pending.resolve(resizedWindow({ width: 1000, height: 700 }))
    expect(await resizing).toMatchObject({
      windowBounds: { width: 1000, height: 700 }, previewSize: { width: 480, height: 320 },
    })
  })

  it('discards an older capture that completes after the native window has resized', async () => {
    const h = harness()
    const oldFrame = deferred<Frame>()
    await h.controller.open('s1', { app: 'Clock' })
    h.capture.mockImplementationOnce(() => oldFrame.promise)
    const capture = h.registry.tickNow('s1')
    await h.controller.resize('s1', { width: 1000, height: 700 })
    oldFrame.resolve({
      mime: 'image/png', base64: 'stale', width: 640, height: 480,
      appName: 'Clock', windowTitle: 'Clock', windowBounds: windows[0]!.bounds,
    })
    await capture
    expect(h.registry.snapshot('s1')?.frame).toBeNull()
    expect(h.controller.status('s1').windowBounds).toMatchObject({ width: 1000, height: 700 })
    h.capture.mockResolvedValueOnce({
      mime: 'image/png', base64: 'resized', width: 640, height: 448,
      appName: 'Clock', windowTitle: 'Clock',
      windowBounds: { x: 50, y: 80, width: 1000, height: 700 },
    })
    await h.registry.tickNow('s1')
    expect(h.registry.snapshot('s1')?.frame?.base64).toBe('resized')
    expect(h.controller.status('s1')).toMatchObject({ open: true, frames: 1, windowBounds: { width: 1000, height: 700 } })
  })
})
