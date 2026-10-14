import { describe, expect, it } from 'vitest'
import { resizeApplicationWindow, type Run } from '../src/cua.ts'

const target = { pid: 100, windowId: 7 }
const size = { width: 1024, height: 768 }

function windowRecord(over: Record<string, unknown> = {}) {
  return {
    pid: 100,
    window_id: 7,
    app_name: 'Clock',
    title: 'Clock',
    bounds: { x: -240, y: 42, width: 800, height: 600 },
    is_on_screen: false,
    ...over,
  }
}

function scripted(responses: unknown[]) {
  const calls: { tool: string; args: Record<string, unknown>; bin: string; signal?: AbortSignal }[] = []
  const run: Run = async (bin, argv, options) => {
    calls.push({ tool: argv[1]!, args: JSON.parse(argv[2]!), bin, signal: options?.signal })
    const response = responses.shift()
    if (response === undefined) throw new Error('unexpected extra call')
    if (response instanceof Error) throw response
    return JSON.stringify(response)
  }
  return { run, calls }
}

describe('resizeApplicationWindow', () => {
  it('preserves the native origin and reads actual bounds without activating the app', async () => {
    const controller = new AbortController()
    const actual = { x: -240, y: 42, width: 1024, height: 768 }
    const { run, calls } = scripted([
      { windows: [windowRecord()] },
      { effect: 'confirmed', code: 'window_frame_verified' },
      { windows: [windowRecord({ bounds: actual })] },
    ])
    const result = await resizeApplicationWindow(target, size, { signal: controller.signal }, run, '/local/cua-driver')
    expect(result).toEqual({
      ...target,
      appName: 'Clock',
      title: 'Clock',
      bounds: actual,
      isOnScreen: false,
    })
    expect(calls).toEqual([
      { tool: 'list_windows', args: { pid: 100 }, bin: '/local/cua-driver', signal: controller.signal },
      {
        tool: 'set_window_frame',
        args: { pid: 100, window_id: 7, x: -240, y: 42, width: 1024, height: 768 },
        bin: '/local/cua-driver',
        signal: controller.signal,
      },
      { tool: 'list_windows', args: { pid: 100 }, bin: '/local/cua-driver', signal: controller.signal },
    ])
  })

  it('returns application-constrained geometry instead of the requested size or action echo', async () => {
    const constrained = { x: -240, y: 42, width: 1200, height: 900 }
    const { run, calls } = scripted([
      { windows: [windowRecord()] },
      {
        effect: 'unverifiable',
        code: 'window_frame_not_settled',
        requested: { x: -240, y: 42, ...size },
        message: 'The window frame did not settle at the requested geometry.',
      },
      { windows: [windowRecord({ bounds: constrained })] },
    ])
    expect((await resizeApplicationWindow(target, size, {}, run)).bounds).toEqual(constrained)
    expect(calls.filter((call) => call.tool === 'set_window_frame')).toHaveLength(1)
  })

  it('does not substitute another pid or window when the bound window has closed', async () => {
    const { run, calls } = scripted([{
      windows: [windowRecord({ pid: 200 }), windowRecord({ window_id: 8 })],
    }])
    await expect(resizeApplicationWindow(target, size, {}, run)).rejects.toMatchObject({ code: 'window_gone' })
    expect(calls.map((call) => call.tool)).toEqual(['list_windows'])
  })

  it('reports window closure during resize without rebinding or repeating the mutation', async () => {
    const { run, calls } = scripted([
      { windows: [windowRecord()] },
      { effect: 'confirmed' },
      { windows: [windowRecord({ window_id: 8 })] },
    ])
    await expect(resizeApplicationWindow(target, size, {}, run)).rejects.toMatchObject({ code: 'window_gone' })
    expect(calls.map((call) => call.tool)).toEqual(['list_windows', 'set_window_frame', 'list_windows'])
  })

  it('requires valid current coordinates before mutating a frame', async () => {
    const { run, calls } = scripted([{
      windows: [windowRecord({ bounds: { x: null, y: 42, width: 800, height: 600 } })],
    }])
    await expect(resizeApplicationWindow(target, size, {}, run)).rejects.toThrowError(/invalid native window bounds/)
    expect(calls).toHaveLength(1)
  })

  it('does not drop an exact tiny window through the inventory preview-size filter', async () => {
    const actual = { x: -240, y: 42, width: 20, height: 30 }
    const { run } = scripted([
      { windows: [windowRecord()] },
      { effect: 'confirmed' },
      { windows: [windowRecord({ bounds: actual })] },
    ])
    expect((await resizeApplicationWindow(target, { width: 20, height: 30 }, {}, run)).bounds).toEqual(actual)
  })

  it('propagates a non-resizable window refusal without a fallback or retry', async () => {
    const { run, calls } = scripted([
      { windows: [windowRecord()] },
      { effect: 'refused', code: 'window_not_resizable', message: 'Window does not expose a settable AXSize' },
    ])
    await expect(resizeApplicationWindow(target, size, {}, run)).rejects.toThrowError(/settable AXSize/)
    expect(calls.map((call) => call.tool)).toEqual(['list_windows', 'set_window_frame'])
  })

  it('does not repeat an uncertain mutation after a CLI failure', async () => {
    const { run, calls } = scripted([
      { windows: [windowRecord()] },
      new Error('response schema mismatch after frame mutation'),
    ])
    await expect(resizeApplicationWindow(target, size, {}, run)).rejects.toMatchObject({ code: 'cli_failed' })
    expect(calls.filter((call) => call.tool === 'set_window_frame')).toHaveLength(1)
  })

  it('fails when post-mutation readback is malformed rather than claiming the requested size', async () => {
    const { run } = scripted([
      { windows: [windowRecord()] },
      { effect: 'confirmed' },
      { windows: [windowRecord({ bounds: { width: 1024, height: 768 } })] },
    ])
    await expect(resizeApplicationWindow(target, size, {}, run)).rejects.toThrowError(/invalid native window bounds/)
  })

  it('rejects invalid dimensions before invoking the driver', async () => {
    for (const badSize of [
      { width: 0, height: 768 },
      { width: 1024, height: -1 },
      { width: 1024.5, height: 768 },
      { width: Number.NaN, height: 768 },
      { width: 1024, height: Number.POSITIVE_INFINITY },
      { width: 16_385, height: 768 },
    ]) {
      const { run, calls } = scripted([])
      await expect(resizeApplicationWindow(target, badSize, {}, run)).rejects.toThrowError(/integers between 1 and 16384/)
      expect(calls).toHaveLength(0)
    }
  })

  it('rejects invalid targets before invoking the driver', async () => {
    for (const badTarget of [{ pid: 0, windowId: 7 }, { pid: 100, windowId: -1 }, { pid: 1.2, windowId: 7 }]) {
      const { run, calls } = scripted([])
      await expect(resizeApplicationWindow(badTarget, size, {}, run)).rejects.toThrowError(/positive integer/)
      expect(calls).toHaveLength(0)
    }
  })

  it('does no work when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled before resize'))
    const { run, calls } = scripted([])
    await expect(resizeApplicationWindow(target, size, { signal: controller.signal }, run))
      .rejects.toThrowError('cancelled before resize')
    expect(calls).toHaveLength(0)
  })

  it('does not mutate after cancellation while reading the current frame', async () => {
    const controller = new AbortController()
    const calls: string[] = []
    const run: Run = async (_bin, args, options) => {
      calls.push(args[1]!)
      expect(options?.signal).toBe(controller.signal)
      controller.abort(new Error('cancelled during read'))
      return JSON.stringify({ windows: [windowRecord()] })
    }
    await expect(resizeApplicationWindow(target, size, { signal: controller.signal }, run))
      .rejects.toThrowError('cancelled during read')
    expect(calls).toEqual(['list_windows'])
  })

  it('does not claim success or retry after cancellation during a mutation', async () => {
    const controller = new AbortController()
    const calls: string[] = []
    const run: Run = async (_bin, args, options) => {
      calls.push(args[1]!)
      expect(options?.signal).toBe(controller.signal)
      if (args[1] === 'list_windows') return JSON.stringify({ windows: [windowRecord()] })
      controller.abort(new Error('cancelled during mutation'))
      return JSON.stringify({ effect: 'confirmed' })
    }
    await expect(resizeApplicationWindow(target, size, { signal: controller.signal }, run))
      .rejects.toThrowError('cancelled during mutation')
    expect(calls).toEqual(['list_windows', 'set_window_frame'])
  })
})
