import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { PipController, type PreviewStatus } from '../src/controller.ts'
import { createPipTool } from '../src/tool.ts'
import type { CuaWindow, WatchTarget, WindowSize } from '../src/shared/types.ts'
import { WatcherRegistry } from '../src/watcher.ts'

// Load the same schema compiler/validator re-exported by the shared runtime.
// Keeping the real defineTool implementation catches unsupported DSL schemas.
const requireRuntime = createRequire(new URL('../../../packages/runtime/package.json', import.meta.url))
const { assertSupportedJsonSchema, validateJsonSchemaValue } = await import(requireRuntime.resolve('@deepseek-ai/dsh-tools'))

type Tool = ReturnType<typeof createPipTool>
type Execution = Parameters<Tool['execute']>[1]
const controllers: PipController[] = []

function execution(sessionId?: string, signal = new AbortController().signal): Execution {
  return {
    signal,
    ...(sessionId === undefined ? {} : { agent: { session: { id: sessionId } } }),
  } as Execution
}

function fixture() {
  const windows: CuaWindow[] = [
    { pid: 1, windowId: 10, appName: 'Clock', title: 'Clock' },
    { pid: 2, windowId: 20, appName: 'ima', title: 'ima' },
  ].map((window) => ({ ...window, isOnScreen: true, bounds: { x: 0, y: 0, width: 800, height: 600 } }))
  const registry = new WatcherRegistry({
    fps: 1, maxDimension: 640, idleTtlMs: 45_000, maxWatchers: 2, autoStart: false,
    listWindows: async () => windows,
    capture: async () => ({ mime: 'image/png', base64: 'test', width: 640, height: 480, appName: 'Clock', windowTitle: 'Clock' }),
  })
  const openApplication = vi.fn(async (app: string, _signal?: AbortSignal) => {
    const window = windows.find((window) => window.appName === app)
    if (window === undefined) throw new Error('app not found')
    return window
  })
  const resizeApplicationWindow = vi.fn(async (
    target: WatchTarget, size: WindowSize, _signal?: AbortSignal,
  ): Promise<CuaWindow> => {
    const window = windows.find((window) => window.pid === target.pid && window.windowId === target.windowId)!
    return { ...window, bounds: { ...window.bounds, ...size } }
  })
  const controller = new PipController({ registry, listWindows: async () => windows, openApplication, resizeApplicationWindow })
  controllers.push(controller)
  return { tool: createPipTool(controller), controller, openApplication, resizeApplicationWindow }
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
  vi.useRealTimers()
})

describe('computer_pip registered tool interface', () => {
  it('compiles a valid schema through the actual shared-runtime defineTool implementation', async () => {
    const { tool } = fixture()
    expect(tool.name).toBe('computer_pip')
    expect(() => assertSupportedJsonSchema(tool.parameters)).not.toThrow()
    expect(() => assertSupportedJsonSchema(tool.output.schema)).not.toThrow()
    expect(tool.parameters).toMatchObject({ type: 'object', required: ['action'] })
    const closed = await tool.execute({ action: 'status' }, execution('s1'))
    const opened = await tool.execute({ action: 'open', app: 'Clock' }, execution('s1'))
    for (const result of [closed, opened]) {
      expect(validateJsonSchemaValue(tool.output.schema, result)).toEqual([])
      expect(tool.output.render({ action: 'status' }, result)).toEqual([{ type: 'text', text: JSON.stringify(result) }])
    }
  })

  it.each([
    {},
    { action: 'launch' },
    { action: 'open', app: 123 },
    { action: 'open', pid: 1.5 },
    { action: 'open', windowId: '10' },
    { action: 'schedule_close', closeAfterSeconds: '30' },
    { action: 'resize', width: '800', height: 600 },
    { action: 'resize', width: 800, height: 600.5 },
    { action: 'resize', width: 800, height: 600, resizeTarget: 'desktop' },
    { action: 'control', controlMode: 'auto' },
    { action: 'control', controlMode: 'desktop', reason: 123 },
  ])('rejects malformed model arguments before invoking application tools: %j', async (args) => {
    const { tool, openApplication } = fixture()
    await expect(tool.execute(args, execution('s1'))).rejects.toMatchObject({ name: 'ToolArgsError' })
    expect(openApplication).not.toHaveBeenCalled()
  })

  it('binds every action to the invoking agent session, including when arguments contain another id', async () => {
    const { tool } = fixture()
    await tool.execute({ action: 'open', app: 'Clock', sessionId: 's2' }, execution('s1'))
    await tool.execute({ action: 'open', app: 'ima' }, execution('s2'))
    expect(await tool.execute({ action: 'status' }, execution('s1')))
      .toMatchObject({ sessionId: 's1', open: true, target: { pid: 1, windowId: 10 } })
    await tool.execute({ action: 'close', sessionId: 's2' }, execution('s1'))
    expect(await tool.execute({ action: 'status' }, execution('s1'))).toMatchObject({ open: false })
    expect(await tool.execute({ action: 'status' }, execution('s2')))
      .toMatchObject({ sessionId: 's2', open: true, target: { pid: 2, windowId: 20 } })
  })

  it('requires a calling session and propagates cancellation to application startup', async () => {
    const { tool, openApplication } = fixture()
    await expect(tool.execute({ action: 'open', app: 'Clock' }, execution())).rejects.toThrow(/calling session/)
    const abort = new AbortController()
    await tool.execute({ action: 'open', app: 'Clock' }, execution('s1', abort.signal))
    expect(openApplication).toHaveBeenCalledWith('Clock', abort.signal)
    abort.abort(new Error('turn cancelled'))
    await expect(tool.execute({ action: 'close' }, execution('s1', abort.signal))).rejects.toThrow('turn cancelled')
    expect(await tool.execute({ action: 'status' }, execution('s1'))).toMatchObject({ open: true })
  })

  it('declares and releases desktop fallback without opening or activating an app', async () => {
    const { tool, openApplication } = fixture()
    await expect(tool.execute({ action: 'control' }, execution('s1'))).rejects.toThrow('control requires controlMode')
    await expect(tool.execute({ action: 'control', controlMode: 'desktop' }, execution('s1')))
      .rejects.toThrow('requires an exact')
    await expect(tool.execute({
      action: 'control', controlMode: 'desktop', pid: 1, windowId: 10,
    }, execution('s1'))).rejects.toThrow('requires a reason')
    const args = {
      action: 'control', controlMode: 'desktop', pid: 1, windowId: 10,
      reason: 'Background input is unavailable',
    } as const
    const enabled = await tool.execute(args, execution('s1'))
    expect(enabled).toMatchObject({
      open: false, target: null,
      control: { mode: 'desktop', target: { pid: 1, windowId: 10 }, reason: args.reason },
    })
    expect(validateJsonSchemaValue(tool.output.schema, enabled)).toEqual([])
    expect(tool.output.render(args, enabled)[0]).toMatchObject({
      type: 'text', text: expect.stringContaining('Desktop fallback enabled'),
    })
    expect(openApplication).not.toHaveBeenCalled()
    const released = await tool.execute({ action: 'control', controlMode: 'background' }, execution('s1'))
    expect(released).toMatchObject({ control: { mode: 'background', target: null, reason: null, expiresAt: null } })
    expect(validateJsonSchemaValue(tool.output.schema, released)).toEqual([])
    expect(tool.output.render({ action: 'control', controlMode: 'background' }, released)[0]).toMatchObject({
      type: 'text', text: expect.stringContaining('Desktop fallback released'),
    })
  })

  it('keeps desktop control separate from single-window recording and resets it on a new open', async () => {
    const { tool, controller } = fixture()
    await tool.execute({ action: 'open', app: 'Clock' }, execution('s1'))
    await tool.execute({
      action: 'control', controlMode: 'desktop', pid: 1, windowId: 10, reason: 'foreground required',
    }, execution('s1'))
    expect(await tool.execute({ action: 'status' }, execution('s1'))).toMatchObject({
      open: true, target: { pid: 1, windowId: 10 }, control: { mode: 'desktop' },
    })
    expect(await tool.execute({ action: 'close' }, execution('s1'))).toMatchObject({
      open: false, control: { mode: 'desktop' },
    })
    await tool.execute({ action: 'open', app: 'ima' }, execution('s1'))
    expect(controller.status('s1')).toMatchObject({ control: { mode: 'background' } })
  })

  it('does not let a caller select another session through control arguments', async () => {
    const { tool } = fixture()
    await tool.execute({
      action: 'control', controlMode: 'desktop', pid: 1, windowId: 10,
      reason: 'foreground required', sessionId: 's2',
    }, execution('s1'))
    expect(await tool.execute({ action: 'status' }, execution('s1'))).toMatchObject({ control: { mode: 'desktop' } })
    expect(await tool.execute({ action: 'status' }, execution('s2'))).toMatchObject({ control: { mode: 'background' } })
  })

  it('schedules the host-owned 30 second close after the application timer has been started', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { tool, controller } = fixture()
    await tool.execute({ action: 'open', app: 'Clock' }, execution('s1'))
    const status = await tool.execute({ action: 'schedule_close', closeAfterSeconds: 30 }, execution('s1')) as PreviewStatus
    expect(status).toMatchObject({ closeAt: 31_000, closedAt: null })
    controller.ingest('s1', { type: 'turn/end' })
    await vi.advanceTimersByTimeAsync(29_999)
    expect(await tool.execute({ action: 'status' }, execution('s1'))).toMatchObject({ open: true, running: false })
    await vi.advanceTimersByTimeAsync(1)
    const closed = await tool.execute({ action: 'status' }, execution('s1'))
    expect(closed).toMatchObject({ open: false, closeAt: null, closedAt: 31_000 })
    expect(validateJsonSchemaValue(tool.output.schema, closed)).toEqual([])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await tool.execute({ action: 'close' }, execution('s1'))).toEqual(closed)
  })

  it('returns a required nullable close timestamp through close, status, and reopen', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { tool } = fixture()
    const neverOpened = await tool.execute({ action: 'status' }, execution('s1'))
    expect(neverOpened).toMatchObject({ closedAt: null })
    await tool.execute({ action: 'open', app: 'Clock' }, execution('s1'))
    await vi.advanceTimersByTimeAsync(2_000)
    const closed = await tool.execute({ action: 'close' }, execution('s1'))
    expect(closed).toMatchObject({ open: false, closedAt: 3_000 })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await tool.execute({ action: 'status' }, execution('s1'))).toEqual(closed)
    const reopened = await tool.execute({ action: 'open', app: 'Clock' }, execution('s1'))
    expect(reopened).toMatchObject({ open: true, closedAt: null })

    for (const result of [neverOpened, closed, reopened]) {
      expect(validateJsonSchemaValue(tool.output.schema, result)).toEqual([])
    }
    const { closedAt: _closedAt, ...missingTimestamp } = closed
    expect(validateJsonSchemaValue(tool.output.schema, missingTimestamp)).not.toEqual([])
    expect(validateJsonSchemaValue(tool.output.schema, { ...closed, closedAt: '3000' })).not.toEqual([])
  })

  it('requires a duration for schedule_close and rejects conflicting application targets', async () => {
    const { tool, openApplication } = fixture()
    await expect(tool.execute({ action: 'schedule_close' }, execution('s1'))).rejects.toThrow(/requires closeAfterSeconds/)
    await expect(tool.execute({ action: 'open', app: 'Clock', pid: 1 }, execution('s1'))).rejects.toThrow(/not both/)
    expect(openApplication).not.toHaveBeenCalled()
  })

  it('resizes the invoking session with its cancellation signal and validates the expanded result schema', async () => {
    const { tool, resizeApplicationWindow } = fixture()
    const abort = new AbortController()
    await tool.execute({ action: 'open', app: 'Clock' }, execution('s1'))
    await tool.execute({ action: 'open', app: 'ima' }, execution('s2'))
    const native = await tool.execute({
      action: 'resize', width: 1000, height: 700, sessionId: 's2',
    }, execution('s1', abort.signal))
    expect(resizeApplicationWindow).toHaveBeenCalledWith(
      { pid: 1, windowId: 10 }, { width: 1000, height: 700 }, abort.signal,
    )
    expect(native).toMatchObject({
      sessionId: 's1', windowBounds: { width: 1000, height: 700 }, previewSize: null,
    })
    const preview = await tool.execute({
      action: 'resize', resizeTarget: 'preview', width: 480, height: 320,
    }, execution('s1'))
    expect(preview).toMatchObject({
      windowBounds: { width: 1000, height: 700 }, previewSize: { width: 480, height: 320 },
    })
    expect(resizeApplicationWindow).toHaveBeenCalledTimes(1)
    expect(await tool.execute({ action: 'status' }, execution('s2')))
      .toMatchObject({ windowBounds: { width: 800, height: 600 }, previewSize: null })
    for (const result of [native, preview]) {
      expect(validateJsonSchemaValue(tool.output.schema, result)).toEqual([])
    }
  })

  it.each([
    { action: 'resize' },
    { action: 'resize', width: 800 },
    { action: 'resize', height: 600 },
  ])('requires both dimensions for resize: %j', async (args) => {
    const { tool, resizeApplicationWindow } = fixture()
    await tool.execute({ action: 'open', app: 'Clock' }, execution('s1'))
    await expect(tool.execute(args, execution('s1'))).rejects.toThrow(/requires width and height/)
    expect(resizeApplicationWindow).not.toHaveBeenCalled()
  })

  it.each([{ app: 'ima' }, { pid: 2 }, { windowId: 20 }])(
    'rejects target selectors on resize instead of resizing a different watched app: %j',
    async (selector) => {
      const { tool, openApplication, resizeApplicationWindow } = fixture()
      await tool.execute({ action: 'open', app: 'Clock' }, execution('s1'))
      openApplication.mockClear()
      await expect(tool.execute({
        action: 'resize', width: 1000, height: 700, ...selector,
      }, execution('s1'))).rejects.toThrow(
        'resize uses the currently watched window; use open to select app/pid/windowId first',
      )
      expect(resizeApplicationWindow).not.toHaveBeenCalled()
      expect(openApplication).not.toHaveBeenCalled()
      expect(await tool.execute({ action: 'status' }, execution('s1'))).toMatchObject({
        open: true, target: { pid: 1, windowId: 10 }, windowBounds: { width: 800, height: 600 },
      })
    },
  )
})
