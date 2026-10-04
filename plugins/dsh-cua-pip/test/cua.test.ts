import { describe, expect, it } from 'vitest'
import { assertBroughtToFront, bringToFront, CuaError, classifyError, openApplication, parseCuaResponse, parseFrame, parseWindows, pickRebindCandidate, type Run } from '../src/cua.ts'
import type { CuaWindow } from '../src/shared/types.ts'

function wrap(payload: unknown): string {
  return JSON.stringify({ structuredContent: payload })
}

const win = (over: Partial<CuaWindow> = {}): CuaWindow => ({
  pid: 100,
  windowId: 1,
  appName: 'Finder',
  title: 'Documents',
  bounds: { x: 0, y: 0, width: 800, height: 600 },
  isOnScreen: true,
  ...over,
})

describe('parseWindows', () => {
  it('maps snake_case fields and keeps usable windows', () => {
    const raw = wrap({
      windows: [
        { pid: 100, window_id: 7, app_name: 'Finder', title: 'Documents', bounds: { x: 1, y: 2, width: 800, height: 600 }, is_on_screen: true },
      ],
    })
    expect(parseWindows(raw)).toEqual([
      { pid: 100, windowId: 7, appName: 'Finder', title: 'Documents', bounds: { x: 1, y: 2, width: 800, height: 600 }, isOnScreen: true },
    ])
  })

  it('accepts a bare payload without the structuredContent wrapper', () => {
    const raw = JSON.stringify({
      windows: [{ pid: 1, window_id: 2, app_name: 'Safari', title: '', bounds: { x: 0, y: 0, width: 100, height: 100 }, is_on_screen: false }],
    })
    const list = parseWindows(raw)
    expect(list).toHaveLength(1)
    expect(list[0]?.isOnScreen).toBe(false)
  })

  it('drops windows that are too small, nameless, or malformed', () => {
    const raw = wrap({
      windows: [
        { pid: 1, window_id: 1, app_name: 'Tiny', title: '', bounds: { x: 0, y: 0, width: 49, height: 600 } },
        { pid: 1, window_id: 2, app_name: '', title: 'No app name', bounds: { x: 0, y: 0, width: 100, height: 100 } },
        { pid: 'x', window_id: 3, app_name: 'BadPid', title: '', bounds: { x: 0, y: 0, width: 100, height: 100 } },
        null,
        'garbage',
      ],
    })
    expect(parseWindows(raw)).toEqual([])
  })

  it('throws when the CLI answers with a structured error body', () => {
    const body = JSON.stringify({ code: 'permission_denied', suggestion: 'grant screen recording' })
    expect(() => parseWindows(body)).toThrowError(/permission_denied/)
  })

  it('does not accept a malformed reply as an empty window inventory', () => {
    expect(() => parseWindows(wrap({ status: 'ok' }))).toThrowError(/windows array/)
    expect(parseWindows(wrap({ windows: [] }))).toEqual([])
  })

  it('rejects invalid identifiers and nonzero-layer windows', () => {
    const candidate = {
      pid: 100, window_id: 7, app_name: 'Cursor',
      bounds: { x: 0, y: 0, width: 900, height: 700 },
    }
    expect(parseWindows(wrap({
      windows: [
        { ...candidate, pid: null },
        { ...candidate, pid: -100 },
        { ...candidate, window_id: 0 },
        { ...candidate, window_id: 1.5 },
        { ...candidate, layer: 2 },
      ],
    }))).toEqual([])
  })
})

describe('parseCuaResponse', () => {
  it('decodes JSON in MCP text content and JSON-RPC result envelopes', () => {
    const content = { content: [{ type: 'text', text: JSON.stringify({ windows: [] }) }] }
    expect(parseCuaResponse(JSON.stringify(content))).toEqual({ windows: [] })
    expect(parseCuaResponse(JSON.stringify({ jsonrpc: '2.0', id: 1, result: content }))).toEqual({ windows: [] })
  })

  it('keeps successful action codes and unverifiable effects available to callers', () => {
    const payload = { effect: 'unverifiable', code: 'web_content_readback_untrusted' }
    expect(parseCuaResponse(wrap(payload))).toEqual(payload)
    expect(parseCuaResponse(wrap({ activated: true, code: 'bring_to_front_exact_window_verified' })))
      .toEqual({ activated: true, code: 'bring_to_front_exact_window_verified' })
  })

  it('prioritizes an MCP error over otherwise plausible structured content', () => {
    const raw = JSON.stringify({
      isError: true,
      structuredContent: { windows: [] },
      content: [{ type: 'text', text: 'permission_denied: grant screen recording' }],
    })
    expect(() => parseWindows(raw)).toThrowError(/permission_denied/)
  })

  it('classifies errors stored only in structured MCP content', () => {
    expect(() => parseCuaResponse(JSON.stringify({
      isError: true,
      structuredContent: { code: 'window_id_not_found', suggestion: 'refresh window list' },
    }))).toThrowError(expect.objectContaining({ code: 'window_gone' }))
  })

  it('rejects error objects and JSON-RPC transport errors', () => {
    expect(() => parseCuaResponse(JSON.stringify({ error: { message: 'launch failed' } }))).toThrowError(/launch failed/)
    expect(() => parseCuaResponse(JSON.stringify({
      jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'invalid parameters' },
    }))).toThrowError(/invalid parameters/)
  })

  it('classifies plain MCP text failures', () => {
    expect(() => parseCuaResponse(JSON.stringify({
      isError: true, content: [{ type: 'text', text: 'px_capture_unavailable' }],
    }))).toThrowError(expect.objectContaining({ code: 'capture_failed' }))
  })
})

describe('parseFrame', () => {
  it('reads the capture-only screenshot fields', () => {
    const raw = wrap({
      screenshot_png_b64: 'QUJD',
      screenshot_mime_type: 'image/png',
      screenshot_width: 640,
      screenshot_height: 400,
      app_name: 'Finder',
      window_title: 'Documents',
    })
    expect(parseFrame(raw)).toEqual({
      mime: 'image/png',
      base64: 'QUJD',
      width: 640,
      height: 400,
      appName: 'Finder',
      windowTitle: 'Documents',
    })
  })

  it('maps a plain-text CLI refusal to capture_failed', () => {
    try {
      parseFrame('No content produced (neither AX tree nor screenshot succeeded)\n')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(CuaError)
      expect((error as CuaError).code).toBe('capture_failed')
      expect((error as CuaError).message).toContain('No content produced')
    }
  })

  it('throws capture_failed when no screenshot is present', () => {
    try {
      parseFrame(wrap({ app_name: 'Finder' }))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(CuaError)
      expect((error as CuaError).code).toBe('capture_failed')
    }
  })

  it('maps a CLI error body (exit 0 + code) to window_gone', () => {
    // Real shape observed when the watched app quits: the CLI prints
    // {"code":"window_id_not_found", …} with no structuredContent wrapper.
    const body = JSON.stringify({
      code: 'window_id_not_found',
      pid: 6198,
      suggestion: 'call list_windows for current window_ids; the window may have closed',
      window_id: 61423,
    })
    try {
      parseFrame(body)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(CuaError)
      expect((error as CuaError).code).toBe('window_gone')
      expect((error as CuaError).message).toContain('window_id_not_found')
    }
  })

  it('uses the actual PNG dimensions for MCP images instead of stale metadata', () => {
    const png = Buffer.alloc(24)
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png)
    png.write('IHDR', 12)
    png.writeUInt32BE(640, 16)
    png.writeUInt32BE(400, 20)
    const frame = parseFrame(JSON.stringify({
      structuredContent: { app_name: 'ima', screenshot_width: 1280, screenshot_height: 800 },
      content: [{ type: 'image', mimeType: 'image/png', data: png.toString('base64') }],
    }))
    expect(frame).toMatchObject({ width: 640, height: 400, appName: 'ima', mime: 'image/png' })
  })

  it('rejects absent or nonpositive screenshot dimensions', () => {
    for (const dimensions of [{}, { screenshot_width: -1, screenshot_height: 10 }, { screenshot_width: 0, screenshot_height: 0 }]) {
      expect(() => parseFrame(wrap({ screenshot_png_b64: 'QUJD', ...dimensions })))
        .toThrowError(expect.objectContaining({ code: 'capture_failed' }))
    }
  })

  it('retains the driver reason when pixel capture was refused', () => {
    expect(() => parseFrame(wrap({ degraded_reason: 'px_frame_mismatch' }))).toThrowError(/px_frame_mismatch/)
  })

  it('keeps native window dimensions separate from scaled screenshot pixels', () => {
    expect(parseFrame(wrap({
      screenshot_png_b64: 'QUJD',
      screenshot_width: 640,
      screenshot_height: 480,
      window_bounds: { x: -120, y: 42, width: 1024, height: 768 },
    }))).toMatchObject({
      width: 640,
      height: 480,
      windowBounds: { x: -120, y: 42, width: 1024, height: 768 },
    })
  })

  it('omits missing or invalid native bounds instead of inventing dimensions', () => {
    for (const bounds of [undefined, {}, { width: 1024, height: 768 }, { x: 0, y: 0, width: 0, height: 768 }]) {
      expect(parseFrame(wrap({
        screenshot_png_b64: 'QUJD',
        screenshot_width: 640,
        screenshot_height: 480,
        window_bounds: bounds,
      }))).not.toHaveProperty('windowBounds')
    }
  })
})

describe('classifyError', () => {
  it('maps window_id_not_found to window_gone', () => {
    expect(classifyError('window_id_not_found: 12345')).toBe('window_gone')
    expect(classifyError('window_owner_pid_mismatch')).toBe('window_gone')
  })

  it('maps transient capture failures to capture_failed', () => {
    expect(classifyError('No content produced (neither AX tree nor screenshot succeeded)')).toBe('capture_failed')
    expect(classifyError('px_capture_unavailable')).toBe('capture_failed')
  })

  it('falls back to cli_failed', () => {
    expect(classifyError('spawn cua-driver ENOENT')).toBe('cli_failed')
  })
})

describe('assertBroughtToFront', () => {
  it('throws when the driver refuses a pid-only ambiguous target', () => {
    const body = JSON.stringify({
      candidates: [{ window_id: 1 }, { window_id: 2 }],
      code: 'ambiguous_window_target',
      effect: 'refused',
      pid: 27055,
    })
    try {
      assertBroughtToFront(body)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(CuaError)
      expect((error as CuaError).message).toContain('ambiguous_window_target')
    }
  })

  it('accepts an exact-window activation', () => {
    expect(() =>
      assertBroughtToFront(
        wrap({
          activated: true,
          code: 'bring_to_front_exact_window_verified',
          status: 'activated',
          pid: 27055,
          window_id: 64136,
        }),
      ),
    ).not.toThrow()
  })

  it('calls bring_to_front with pid and window_id', async () => {
    let args: string[] = []
    await bringToFront({ pid: 27055, windowId: 64136 }, async (_file, passed) => {
      args = [...passed]
      return wrap({ activated: true, status: 'activated' })
    })
    expect(args[0]).toBe('call')
    expect(args[1]).toBe('bring_to_front')
    expect(JSON.parse(args[2] ?? '{}')).toEqual({ pid: 27055, window_id: 64136 })
  })

  it('maps a structured window_gone body', () => {
    try {
      assertBroughtToFront(JSON.stringify({ code: 'window_id_not_found', window_id: 1 }))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(CuaError)
      expect((error as CuaError).code).toBe('window_gone')
    }
  })

  it('requires positive evidence of activation', () => {
    expect(() => assertBroughtToFront('{}')).toThrowError(/did not confirm/)
  })
})

describe('openApplication', () => {
  const windowRecord = (over: Record<string, unknown> = {}) => ({
    pid: 100, window_id: 7, app_name: 'ima', title: 'ima',
    bounds: { x: 0, y: 0, width: 900, height: 700 }, is_on_screen: false,
    ...over,
  })

  function scripted(responses: unknown[], apps: unknown[] = []): { run: Run; calls: { tool: string; args: Record<string, unknown>; bin: string }[] } {
    responses = [{ apps }, ...responses]
    const calls: { tool: string; args: Record<string, unknown>; bin: string }[] = []
    const run: Run = async (bin, argv) => {
      calls.push({ tool: argv[1]!, args: JSON.parse(argv[2]!), bin })
      const response = responses.shift()
      if (response === undefined) throw new Error('unexpected extra call')
      if (response instanceof Error) throw response
      return JSON.stringify(response)
    }
    return { run, calls }
  }

  it('opens an app by name and uses the returned off-screen window without activation', async () => {
    const { run, calls } = scripted([{ pid: 100, windows: [windowRecord()] }])
    const target = await openApplication(' ima ', {}, run, '/local/cua-driver')
    expect(target).toMatchObject({ pid: 100, windowId: 7, appName: 'ima', isOnScreen: false })
    expect(calls).toEqual([
      { tool: 'list_apps', args: {}, bin: '/local/cua-driver' },
      { tool: 'launch_app', args: { name: 'ima' }, bin: '/local/cua-driver' },
    ])
  })

  it('uses a bundle id and waits for a late window using the exact launched pid', async () => {
    const { run, calls } = scripted([
      { pid: 100, launch_state: 'running', windows: [] },
      { windows: [] },
      { windows: [windowRecord({ app_name: 'Clock' }), windowRecord({ pid: 200, window_id: 8 })] },
    ])
    const waits: number[] = []
    const result = await openApplication('com.apple.clock', {
      retries: 1, retryDelayMs: 100, wait: async (ms) => { waits.push(ms) },
    }, run)
    expect(result).toMatchObject({ pid: 100, windowId: 7, appName: 'Clock' })
    expect(calls.map((call) => [call.tool, call.args])).toEqual([
      ['list_apps', {}],
      ['launch_app', { bundle_id: 'com.apple.clock' }],
      ['list_windows', { pid: 100 }],
      ['list_windows', { pid: 100 }],
    ])
    expect(waits).toEqual([100])
  })

  it('resolves a not-yet-running app from list_apps before enumerating its windows', async () => {
    const { run, calls } = scripted([
      { launch_state: 'request_sent', bundle_id: 'com.todesktop.cursor', windows: [] },
      { apps: [{ name: 'Cursor', bundle_id: 'com.todesktop.cursor', pid: 0, running: false }] },
      { apps: [{ name: 'Cursor', bundle_id: 'com.todesktop.cursor', pid: 100, running: true }] },
      { windows: [windowRecord({ app_name: 'Cursor' })] },
    ])
    const result = await openApplication('Cursor', { retries: 1, wait: async () => {} }, run)
    expect(result.appName).toBe('Cursor')
    expect(calls.map((call) => call.tool)).toEqual(['list_apps', 'launch_app', 'list_apps', 'list_apps', 'list_windows'])
  })

  it('uses an unambiguous pid from returned windows when the top-level pid is absent', async () => {
    const { run, calls } = scripted([{ windows: [windowRecord()] }])
    expect((await openApplication('ima', {}, run)).windowId).toBe(7)
    expect(calls).toHaveLength(2)
  })

  it('keeps a launch path as a name argument', async () => {
    const { run, calls } = scripted([{ pid: 100, windows: [windowRecord()] }])
    await openApplication('/Applications/ima.copilot.app', {}, run)
    expect(calls[1]?.args).toEqual({ name: '/Applications/ima.copilot.app' })
  })

  it('fails after bounded polling without relaunching or selecting a different app', async () => {
    const { run, calls } = scripted([
      { pid: 100, windows: [] },
      { windows: [windowRecord({ pid: 200 })] },
      { windows: [] },
    ])
    await expect(openApplication('ima', { retries: 1, wait: async () => {} }, run))
      .rejects.toMatchObject({ code: 'app_window_unavailable' })
    expect(calls.map((call) => call.tool)).toEqual(['list_apps', 'launch_app', 'list_windows', 'list_windows'])
  })

  it('does not turn consent overlays into an application target', async () => {
    const { run } = scripted([
      { pid: 100, windows: [windowRecord({ app_name: 'universalAccessAuthWarn', title: '录屏' })] },
      { windows: [] },
    ])
    await expect(openApplication('ima', { retries: 0 }, run)).rejects.toMatchObject({ code: 'app_window_unavailable' })
  })

  it('fails immediately for a launch refusal or failed CLI invocation', async () => {
    const refused = scripted([{ isError: true, content: [{ type: 'text', text: 'application_not_found' }] }])
    await expect(openApplication('Missing App', {}, refused.run)).rejects.toThrowError(/application_not_found/)
    expect(refused.calls).toHaveLength(2)
    const failed = scripted([new Error('spawn cua-driver ENOENT')])
    await expect(openApplication('ima', {}, failed.run)).rejects.toMatchObject({ code: 'cli_failed' })
    expect(failed.calls).toHaveLength(2)
  })

  it('rejects empty app requests before invoking the driver', async () => {
    const { run, calls } = scripted([])
    await expect(openApplication(' ', {}, run)).rejects.toThrowError(/required/)
    expect(calls).toHaveLength(0)
  })

  it('does not launch when cancellation was already requested', async () => {
    const { run, calls } = scripted([])
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(openApplication('ima', { signal: controller.signal }, run)).rejects.toThrowError('cancelled')
    expect(calls).toHaveLength(0)
  })

  it('passes cancellation to discovery and does not use a late result to launch', async () => {
    const controller = new AbortController()
    let calls = 0
    const run: Run = async (_bin, _args, options) => {
      calls += 1
      expect(options?.signal).toBe(controller.signal)
      controller.abort(new Error('cancelled while launching'))
      return JSON.stringify({ pid: 100, windows: [windowRecord()] })
    }
    await expect(openApplication('ima', { signal: controller.signal }, run)).rejects.toThrowError('cancelled while launching')
    expect(calls).toBe(1)
  })

  it('stops polling after cancellation between attempts', async () => {
    const controller = new AbortController()
    const { run, calls } = scripted([{ pid: 100, windows: [] }, { windows: [] }])
    await expect(openApplication('ima', {
      signal: controller.signal,
      wait: async () => { controller.abort(new Error('cancelled while waiting')) },
    }, run)).rejects.toThrowError('cancelled while waiting')
    expect(calls.map((call) => call.tool)).toEqual(['list_apps', 'launch_app', 'list_windows'])
  })

  it.each(['ima', 'com.example.ima', '/Applications/ima.app'])('only observes an already running app selected by %s', async (name) => {
    const { run, calls } = scripted([{ windows: [windowRecord()] }], [
      { name: 'ima', bundle_id: 'com.example.ima', launch_path: '/Applications/ima.app', pid: 100 },
    ])
    expect(await openApplication(name, {}, run)).toMatchObject({ pid: 100, windowId: 7 })
    expect(calls.map((call) => call.tool)).toEqual(['list_apps', 'list_windows'])
  })

  it('does not send a reopen/activation request when a running app has no capturable window', async () => {
    const { run, calls } = scripted([{ windows: [] }, { windows: [] }], [{ name: 'ima', pid: 100 }])
    await expect(openApplication('ima', { retries: 1, wait: async () => {} }, run))
      .rejects.toMatchObject({ code: 'app_window_unavailable' })
    expect(calls.map((call) => call.tool)).toEqual(['list_apps', 'list_windows', 'list_windows'])
  })
})

describe('pickRebindCandidate', () => {
  it('prefers the largest on-screen window for the pid', () => {
    const windows = [
      win({ windowId: 1, isOnScreen: false, bounds: { x: 0, y: 0, width: 2000, height: 2000 } }),
      win({ windowId: 2, isOnScreen: true, bounds: { x: 0, y: 0, width: 800, height: 600 } }),
      win({ windowId: 3, isOnScreen: true, bounds: { x: 0, y: 0, width: 1024, height: 768 } }),
    ]
    expect(pickRebindCandidate(windows, 100)?.windowId).toBe(3)
  })

  it('falls back to the largest window when none are on screen', () => {
    const windows = [
      win({ windowId: 1, isOnScreen: false, bounds: { x: 0, y: 0, width: 400, height: 300 } }),
      win({ windowId: 2, isOnScreen: false, bounds: { x: 0, y: 0, width: 900, height: 700 } }),
    ]
    expect(pickRebindCandidate(windows, 100)?.windowId).toBe(2)
  })

  it('ignores other pids and returns undefined when the pid has no window', () => {
    const windows = [win({ pid: 999 })]
    expect(pickRebindCandidate(windows, 100)).toBeUndefined()
    expect(pickRebindCandidate([], 100)).toBeUndefined()
  })

  it('skips the Screen Recording consent overlay even when it is the only window', () => {
    const overlay = win({
      pid: 4456,
      windowId: 63495,
      appName: 'universalAccessAuthWarn',
      title: '录屏',
      bounds: { x: 0, y: 0, width: 461, height: 181 },
    })
    expect(pickRebindCandidate([overlay], 4456)).toBeUndefined()
  })
})
