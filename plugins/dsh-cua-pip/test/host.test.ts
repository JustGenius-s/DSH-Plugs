import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import type { createPipTool } from '../src/tool.ts'
import type { createWindowTool } from '../src/window-tool.ts'
import type { WindowExecution } from '../src/window-driver.ts'
import type { CuaWindow } from '../src/shared/types.ts'
import {
  ACTIVITY_PATH, CLOSE_PATH, FOCUS_PATH, FRAME_PATH, HEALTH_PATH,
  RESIZE_PATH, SCHEDULE_PATH, STREAM_PATH, UNWATCH_PATH, WATCH_PATH, WINDOWS_PATH,
} from '../src/shared/routes.ts'

const native = vi.hoisted(() => ({ capture: vi.fn(), release: vi.fn(), dispose: vi.fn() }))
const imageStore = vi.hoisted(() => ({ saveImage: vi.fn() }))
vi.mock('../src/native-capture.ts', () => ({
  CAPTURE_SOURCE: 'screencapturekit-window',
  WindowCaptureSource: class {
    capture = native.capture
    release = native.release
    dispose = native.dispose
    observation() { return undefined }
    health() { return { built: true, supported: true } }
  },
}))

const driver = vi.hoisted(() => ({
  listWindows: vi.fn(),
  openApplication: vi.fn(),
  resizeApplicationWindow: vi.fn(),
  bringToFront: vi.fn(),
}))

vi.mock('../src/cua.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/cua.ts')>(),
  ...driver,
}))

// Real shared runtime helpers parse the request body and compile the tool.
import { apply, inject } from '../src/index.ts'

type Tool = ReturnType<typeof createPipTool>
type WindowTool = ReturnType<typeof createWindowTool>
type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<unknown>
const cleanups: (() => void)[] = []
const windows: CuaWindow[] = [
  { pid: 1, windowId: 10, appName: 'Clock', title: 'Clock' },
  { pid: 2, windowId: 20, appName: 'ima', title: 'ima' },
].map((window) => ({ ...window, isOnScreen: true, bounds: { x: 0, y: 0, width: 800, height: 600 } }))

function harness(options: { providerNames?: string[] } = {}) {
  const routes = new Map<string, Handler>()
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const sessions = new Set(['s1', 's2'])
  const workspace = { archivedSessionIds: [] as string[] }
  let tool: Tool | undefined
  let windowTool: WindowTool | undefined
  const providerNames = options.providerNames ?? [
    'get_window_state', 'click', 'set_value', 'type_text', 'press_key', 'start_session',
    'end_session', 'list_windows', 'zoom', 'get_desktop_state', 'bring_to_front', 'invoke_menu',
  ]
    .map((name) => `mcp__cua-driver-mcp__${name}`)
  const lifecycleExecute = vi.fn(async () => ({ isError: false, content: [], value: { structuredContent: { status: 'active' } } }))
  let snapshot = 0
  const providerExecute = vi.fn(async (exec: { name: string }) => ({
    isError: false, content: [], value: { structuredContent: exec.name.endsWith('get_window_state') ? {
      pid: 1, window_id: 10, snapshot_id: `snapshot-${++snapshot}`,
      elements: [
        { element_index: 0, element_token: `button-${snapshot}`, role: 'AXButton', actions: ['AXPress'],
          frame: { x: 10, y: 10, w: 100, h: 40 } },
        { element_index: 1, element_token: `field-${snapshot}`, role: 'AXTextField', value: 'old',
          frame: { x: 10, y: 70, w: 200, h: 40 } },
      ],
      background_input: { exact_window: { pid: 1, window_id: 10 }, routes: [{ route: 'accessibility', status: 'available' }] },
    } : { path: 'ax', effect: 'confirmed' } },
  }))
  const prompts: { name: string; text: string }[] = []
  const guards: ((exec: {
    name: string; arguments: unknown; agent?: { session: { id: string } }
  }) => string | undefined)[] = []
  const ctx = {
    tools: {
      register: (definition: Tool | WindowTool) => {
        if (definition.name === 'computer_pip') tool = definition as Tool
        else windowTool = definition as WindowTool
        return () => {}
      },
      guard: (guard: typeof guards[number]) => { guards.push(guard); return () => {} },
      schemas: () => providerNames.map((name) => ({ name })),
      get: (name: string) => name === 'computer_pip' ? tool : name === 'computer_window' ? windowTool
        : providerNames.includes(name) || ['cua_driver_native__bring_to_front', 'cua_driver_native__invoke_menu'].includes(name)
          ? { name } : undefined,
      execute: async (raw: WindowExecution) => {
        const input = { signal: new AbortController().signal, callId: 'test', rootCallId: 'test', token: Symbol('test'), ...raw }
        const failure = guards.map((guard) => guard(input)).find((reason) => reason !== undefined)
        if (failure !== undefined) return { isError: true, content: [], error: { message: failure } }
        const around = [...listeners.get('tools/execute')!][0]!
        const result = await around(input, () => input.name.endsWith('__start_session') ? lifecycleExecute() : providerExecute(input))
        const post = [...listeners.get('tools/post-execute')!][0]!
        const decision = await post(input, result, async () => ({ kind: 'accept' })) as { kind: string; additionalContexts?: unknown[] }
        if (decision.kind !== 'accept') return { isError: true, content: [], error: { message: 'result denied' } }
        return { ...result as object, additionalContexts: [...((result as { additionalContexts?: unknown[] }).additionalContexts ?? []), ...(decision.additionalContexts ?? [])] }
      },
    },
    systemPrompt: { section: (section: { name: string; text: string }) => { prompts.push(section); return () => {} } },
    sessions: { get: (id: string) => sessions.has(String(id)) ? { id } : undefined },
    get: (name: string) => name === 'workspaceRegistry' ? workspace : name === 'attachments' ? imageStore : undefined,
    effect: (setup: () => () => void) => { cleanups.push(setup()) },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return () => set.delete(listener)
    },
    webServer: {
      register: ({ path, handler }: { path: string; handler: Handler }) => {
        if (routes.has(path)) throw new Error(`duplicate route: ${path}`)
        routes.set(path, handler)
        return () => { routes.delete(path) }
      },
    },
  } as unknown as Context
  apply(ctx)
  const request = async (path: string, method = 'GET', body?: unknown, rawBody?: string) => {
    const handler = routes.get(path.split('?')[0]!)
    if (handler === undefined) throw new Error(`route not registered: ${path}`)
    const raw = rawBody ?? (body === undefined ? '' : JSON.stringify(body))
    let status = 0
    let headers: Record<string, string> = {}
    let response = ''
    const req = {
      method,
      url: path,
      async *[Symbol.asyncIterator]() { if (raw !== '') yield Buffer.from(raw) },
    } as IncomingMessage
    const res = {
      writeHead(code: number, values: Record<string, string> = {}) { status = code; headers = values },
      end(value?: unknown) { response = value === undefined ? '' : String(value) },
    } as ServerResponse
    await handler(req, res)
    return { status, headers, body: response === '' ? undefined : JSON.parse(response) }
  }
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args)
  }
  return { request, routes, sessions, workspace, emit, listeners, tool: tool!, windowTool: windowTool!, providerExecute, lifecycleExecute, prompts, guards, execute: ctx.tools.execute.bind(ctx.tools) }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000)
  for (const fn of Object.values(driver)) fn.mockReset()
  for (const fn of Object.values(native)) fn.mockReset()
  imageStore.saveImage.mockReset().mockResolvedValue({
    attachmentId: 'image-ref', mediaType: 'image/png', bytes: 3, width: 640, height: 480,
  })
  driver.listWindows.mockResolvedValue(windows)
  driver.openApplication.mockImplementation(async (app: string) => {
    const window = windows.find((window) => window.appName === app)
    if (window === undefined) throw new Error('application_not_found')
    return window
  })
  native.capture.mockResolvedValue({
    mime: 'image/png', base64: 'test', width: 640, height: 480, appName: 'Clock', windowTitle: 'Clock',
  })
  driver.bringToFront.mockResolvedValue(undefined)
  driver.resizeApplicationWindow.mockImplementation(async (
    target: { pid: number; windowId: number }, size: { width: number; height: number },
  ) => {
    const window = windows.find((window) => window.pid === target.pid && window.windowId === target.windowId)!
    return { ...window, bounds: { ...window.bounds, ...size } }
  })
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.useRealTimers()
})

describe('PiP host interfaces', () => {
  it.each([false, true])('passes direct Cua arguments unchanged without lifecycle preflights (nested=%s)', async (nested) => {
    const h = harness({ providerNames: ['mcp__cua-driver-mcp__click'] })
    const args = { session: 'user-session', scope: 'desktop', x: 10, y: 20, delivery_mode: 'foreground' }
    const result = await h.execute({
      agent: { session: { id: 's1' } }, name: 'mcp__cua-driver-mcp__click', arguments: args,
      ...(nested ? { parent: Symbol('run_code') } : {}),
    } as Parameters<typeof h.execute>[0])
    expect(result).toMatchObject({ isError: false })
    expect(h.providerExecute).toHaveBeenCalledOnce()
    expect(h.providerExecute.mock.calls[0]![0]).toMatchObject({ arguments: args })
    expect(h.lifecycleExecute).not.toHaveBeenCalled()
    expect(native.capture).not.toHaveBeenCalled()
  })

  it('keeps Cua available after optional binding fails with no window provider', async () => {
    const h = harness({ providerNames: ['mcp__cua-driver-mcp__click'] })
    const agent = { session: { id: 's1' } }
    const exec = { agent, signal: new AbortController().signal } as WindowExecution
    await expect(h.windowTool.execute({ action: 'bind', app: 'Clock' }, exec))
      .rejects.toThrow('window_provider_unavailable')
    expect(await h.execute({
      ...exec, name: 'mcp__cua-driver-mcp__click', arguments: { x: 10, y: 20 },
    } as Parameters<typeof h.execute>[0])).toMatchObject({ isError: false })
    expect(h.lifecycleExecute).not.toHaveBeenCalled()
  })

  it('does not block direct input when PiP recording has stopped', async () => {
    const h = harness()
    const { CuaError } = await import('../src/cua.ts')
    native.capture.mockRejectedValue(new CuaError('user stopped sharing', 'capture_stopped'))
    await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'Clock' })
    await vi.advanceTimersByTimeAsync(100)
    expect(await h.execute({
      agent: { session: { id: 's1' } }, name: 'mcp__cua-driver-mcp__click',
      arguments: { pid: 2, window_id: 20, x: 10, y: 20 },
    } as Parameters<typeof h.execute>[0])).toMatchObject({ isError: false })
    expect(h.providerExecute).toHaveBeenCalledOnce()
    expect(h.lifecycleExecute).not.toHaveBeenCalled()
  })

  it('preserves other host guards for direct Cua calls', async () => {
    const h = harness()
    h.guards.push(() => 'host approval denied')
    expect(await h.execute({
      agent: { session: { id: 's1' } }, name: 'mcp__cua-driver-mcp__click', arguments: { x: 10, y: 20 },
    } as Parameters<typeof h.execute>[0])).toMatchObject({ isError: true, error: { message: 'host approval denied' } })
    expect(h.providerExecute).not.toHaveBeenCalled()
  })

  it('runs the bound-window path through existing guards and carries its post-action image into the next model request', async () => {
    const h = harness()
    native.capture.mockImplementation(async () => ({
      mime: 'image/png', base64: 'test', width: 640, height: 480, appName: 'Clock', windowTitle: 'Clock',
      windowBounds: windows[0]!.bounds, capturedAt: Date.now(), frameId: `native:${Date.now()}`,
    }))
    const contexts: unknown[] = []
    const exec = {
      agent: { session: { id: 's1' } }, callId: 'bound', rootCallId: 'bound', token: Symbol('bound'),
      signal: new AbortController().signal, deferContext: (message: unknown) => contexts.push(message), concludeTurn: vi.fn(),
    } as WindowExecution
    expect(h.windowTool.name).toBe('computer_window')
    const bound = await h.windowTool.execute({ action: 'bind', pid: 1, windowId: 10 }, exec)
    await vi.advanceTimersByTimeAsync(40)
    const observed = await h.windowTool.execute({ action: 'observe', targetId: bound.targetId }, exec)
    const observation = observed.observation as { observationId: string }
    await expect(h.windowTool.execute({
      action: 'act', targetId: bound.targetId, observationId: observation.observationId, steps: [{ kind: 'click', x: 20, y: 20 }],
    }, exec)).rejects.toThrow('window_observation_required')
    const modelRequest = [...h.listeners.get('llm/stream')!][0]!
    await modelRequest({ sessionId: 's1', messages: contexts }, () => [])
    const acted = h.windowTool.execute({
      action: 'act', targetId: bound.targetId, observationId: observation.observationId,
      steps: [{ kind: 'set_value', elementIndex: 1, text: 'new' }, { kind: 'click', x: 20, y: 20 }],
    }, exec)
    await vi.advanceTimersByTimeAsync(100)
    expect(await acted).toMatchObject({
      status: 'queued', batch: { results: [{ operation: 'set_value' }, { operation: 'click', targeting: 'pip-pixels-to-ax' }] },
    })
    expect(h.providerExecute.mock.calls.map(([call]) => call.name)).toEqual([
      'mcp__cua-driver-mcp__get_window_state', 'mcp__cua-driver-mcp__set_value',
      'mcp__cua-driver-mcp__click', 'mcp__cua-driver-mcp__get_window_state',
    ])
    expect(imageStore.saveImage).toHaveBeenCalledTimes(2)
  })

  it('does not let a bound batch bypass another host policy denying an application action', async () => {
    const h = harness()
    native.capture.mockImplementation(async () => ({
      mime: 'image/png', base64: 'test', width: 640, height: 480, appName: 'Clock', windowTitle: 'Clock',
      windowBounds: windows[0]!.bounds, capturedAt: Date.now(), frameId: `native:${Date.now()}`,
    }))
    const contexts: unknown[] = []
    const exec = {
      agent: { session: { id: 's1' } }, callId: 'bound', rootCallId: 'bound', token: Symbol('bound'),
      signal: new AbortController().signal, deferContext: (message: unknown) => contexts.push(message), concludeTurn: vi.fn(),
    } as WindowExecution
    const bound = await h.windowTool.execute({ action: 'bind', pid: 1, windowId: 10 }, exec)
    await vi.advanceTimersByTimeAsync(40)
    const observed = await h.windowTool.execute({ action: 'observe', targetId: bound.targetId }, exec)
    const modelRequest = [...h.listeners.get('llm/stream')!][0]!
    await modelRequest({ sessionId: 's1', messages: contexts }, () => [])
    h.guards.push((call) => call.name.endsWith('__click') ? 'application_action_denied' : undefined)
    const acted = h.windowTool.execute({
      action: 'act', targetId: bound.targetId, observationId: (observed.observation as { observationId: string }).observationId,
      steps: [{ kind: 'click', elementIndex: 0 }],
    }, exec)
    await vi.advanceTimersByTimeAsync(100)
    expect(await acted).toMatchObject({ batch: {
      stoppedReason: 'step_failed', results: [{ error: 'application_action_denied', outcome: 'failed' }],
    } })
    expect(h.providerExecute.mock.calls.every(([call]) => call.name.endsWith('get_window_state'))).toBe(true)
  })

  it('registers the explicit tool and prompt with the required host services', () => {
    const h = harness()
    expect(inject).toEqual(expect.arrayContaining(['webServer', 'sessions', 'tools', 'systemPrompt']))
    expect(h.tool.name).toBe('computer_pip')
    expect(h.tool.parameters).toMatchObject({ type: 'object', required: ['action'] })
    expect(h.prompts).toEqual([expect.objectContaining({ name: 'computer-use:pip', text: expect.stringContaining('Ordinary computer-use calls do not open') })])
    expect(driver.openApplication).not.toHaveBeenCalled()
  })

  it.each([
    [WINDOWS_PATH, 'GET'], [WATCH_PATH, 'POST'], [CLOSE_PATH, 'POST'],
    [UNWATCH_PATH, 'POST'], [SCHEDULE_PATH, 'POST'], [RESIZE_PATH, 'POST'], [FRAME_PATH, 'GET'],
    [FOCUS_PATH, 'POST'], [ACTIVITY_PATH, 'GET'], [STREAM_PATH, 'GET'], [HEALTH_PATH, 'GET'],
  ])('rejects the wrong method for %s before using the driver', async (path, method) => {
    const h = harness()
    const response = await h.request(path, method === 'GET' ? 'POST' : 'GET')
    expect(response.status).toBe(405)
    expect(response.headers.allow).toBe(method)
    expect(driver.listWindows).not.toHaveBeenCalled()
    expect(driver.openApplication).not.toHaveBeenCalled()
  })

  it('reports the capabilities of the running build without accessing any application', async () => {
    const h = harness()
    expect(await h.request(HEALTH_PATH)).toMatchObject({
      status: 200,
      body: {
        runtimeVersion: '2026-09-29-optional-pip-v9',
        capture: 'screencapturekit-window', transport: 'sse', resize: true,
        backgroundPolicy: 'background-first-desktop-fallback-v2',
        directCua: 'passthrough',
        driverSessions: { appliesTo: 'computer_window', scope: 'dsh-session-and-provider', preflight: 'start_session', replayInputs: false },
        desktopFallback: { enabled: true, scope: 'session-and-window-or-desktop', ttlMs: 300_000 },
        actionBindings: 'canonical-session-provider-v2',
        monitor: { appliesTo: 'pip-managed-actions', readyGate: true, observe: 'native-image', postActionObservation: true, modelRequestGate: true },
        windowControl: { tool: 'computer_window', binding: 'session-window-v1', visualClick: 'ax-hit-test-only', maxBatchSteps: 6, rawPointer: false },
        recovery: { maxRetries: 2, delaysMs: [500, 1500], restartUserStopped: false },
      },
    })
    expect(driver.listWindows).not.toHaveBeenCalled()
    expect(native.capture).not.toHaveBeenCalled()
  })

  it('allows direct foreground actions before opening and after closing a preview', async () => {
    const h = harness()
    const guard = h.guards[0]!
    expect(guard({ name: 'mcp__cua-driver-mcp__invoke_menu', arguments: { pid: 1, window_id: 10 } }))
      .toBeUndefined()
    expect(guard({ name: 'mcp__cua-driver-mcp__click', arguments: {
      pid: 1, window_id: 10, element_token: 'actual', delivery_mode: 'background',
    } })).toBeUndefined()
    await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'Clock' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(native.capture).toHaveBeenCalledWith({ pid: 1, windowId: 10 }, 1024, 's1')
    await h.request(CLOSE_PATH, 'POST', { sessionId: 's1' })
    expect(native.release).toHaveBeenCalledWith('s1')
    expect(guard({ name: 'mcp__cua-driver-mcp__bring_to_front', arguments: { pid: 1, window_id: 10 } }))
      .toBeUndefined()
  })

  it('keeps direct Cua independent of another session desktop declaration or its expiry', async () => {
    const h = harness()
    const agent = { session: { id: 's1' } }
    const signal = new AbortController().signal
    const control = await h.tool.execute({
      action: 'control', controlMode: 'desktop', pid: 1, windowId: 10,
      reason: 'Clock does not respond to background AXPress',
    }, { agent, signal } as Parameters<Tool['execute']>[1])
    expect(control).toMatchObject({ open: false, control: { mode: 'desktop', target: { pid: 1, windowId: 10 } } })
    expect(driver.bringToFront).not.toHaveBeenCalled()
    expect(native.capture).not.toHaveBeenCalled()
    const guard = h.guards[0]!
    expect(guard({ agent, name: 'cua_driver_native__bring_to_front', arguments: { pid: 1, window_id: 10 } })).toBeUndefined()
    expect(guard({ agent, name: 'mcp__cua-driver-mcp__get_desktop_state', arguments: {} })).toBeUndefined()
    expect(guard({
      agent, name: 'mcp__cua-driver-mcp__click',
      arguments: { target: { kind: 'desktop', display_id: 'primary' }, x: 10, y: 20 },
    })).toBeUndefined()
    expect(guard({
      agent: { session: { id: 's2' } }, name: 'cua_driver_native__bring_to_front', arguments: { pid: 1, window_id: 10 },
    })).toBeUndefined()
    h.emit('session/event', { id: 's1' }, { type: 'turn/end' })
    expect(guard({ agent, name: 'cua_driver_native__bring_to_front', arguments: { pid: 1, window_id: 10 } }))
      .toBeUndefined()
  })

  it('releases desktop control when the authoritative turn is interrupted', async () => {
    const h = harness()
    const turn = new AbortController()
    const code = new AbortController()
    const agent = { session: { id: 's1' } }
    const preStep = [...h.listeners.get('agent/pre-step')!][0]!
    const allowed = { kind: 'accept', messages: [] }
    expect(await preStep({ agent, signal: turn.signal }, async () => allowed)).toBe(allowed)
    await h.tool.execute({
      action: 'control', controlMode: 'desktop', pid: 1, windowId: 10, reason: 'foreground required',
    }, { agent, signal: code.signal } as Parameters<Tool['execute']>[1])
    code.abort('run_code settled')
    expect(h.guards[0]!({ agent, name: 'cua_driver_native__invoke_menu', arguments: { pid: 1, window_id: 10 } }))
      .toBeUndefined()
    turn.abort('user interrupted')
    expect(await h.tool.execute({ action: 'status' }, { agent, signal: new AbortController().signal } as Parameters<Tool['execute']>[1]))
      .toMatchObject({ control: { mode: 'background' } })
    expect(h.guards[0]!({ agent, name: 'cua_driver_native__invoke_menu', arguments: { pid: 1, window_id: 10 } }))
      .toBeUndefined()
  })

  it.each(['archived', 'deleted', 'disposed', 'unloaded'])('releases a desktop-only session when %s', async (event) => {
    const h = harness()
    const agent = { session: { id: 's1' } }
    await h.tool.execute({
      action: 'control', controlMode: 'desktop', pid: 1, windowId: 10, reason: 'foreground required',
    }, { agent, signal: new AbortController().signal } as Parameters<Tool['execute']>[1])
    if (event === 'archived') h.workspace.archivedSessionIds.push('s1')
    if (event === 'deleted') h.sessions.delete('s1')
    if (event === 'disposed') h.emit('session/disposed', { id: 's1' })
    if (event === 'unloaded') for (const cleanup of cleanups.splice(0)) cleanup()
    await vi.advanceTimersByTimeAsync(1000)
    expect(await h.tool.execute({ action: 'status' }, { agent, signal: new AbortController().signal } as Parameters<Tool['execute']>[1]))
      .toMatchObject({ control: { mode: 'background' } })
    expect(h.guards[0]!({ agent, name: 'cua_driver_native__invoke_menu', arguments: { pid: 1, window_id: 10 } }))
      .toBeUndefined()
    expect(native.capture).not.toHaveBeenCalled()
  })

  it('attaches actual AX bindings without replacing MCP image content or canonical values', async () => {
    const h = harness()
    const hook = [...h.listeners.get('tools/post-execute')!][0]!
    const value = {
      content: [{ type: 'text', text: 'window tree' }],
      structuredContent: {
        pid: 1, window_id: 10, snapshot_id: 'snapshot:real',
        elements: [{ element_index: 7, element_token: 'element:real', role: 'AXButton', label: 'Start' }],
      },
    }
    const result = { isError: false, value, content: [{ type: 'text', text: 'original image projection' }] }
    const decision = await hook(
      { name: 'mcp__cua-driver-mcp__get_window_state', agent: { session: { id: 's1' } } },
      result,
      async () => ({ kind: 'accept' }),
    ) as { kind: string; additionalContexts: { content: { text?: string }[] }[] }
    expect(decision.kind).toBe('accept')
    expect(decision).not.toHaveProperty('content')
    expect(decision).not.toHaveProperty('value')
    const text = decision.additionalContexts[0]?.content.map((part) => part.text ?? '').join('')
    expect(text).toContain('snapshot:real')
    expect(text).toContain('element:real')
    expect(result.value).toBe(value)
  })

  it('leaves direct token-only validation to the provider without rewriting arguments', async () => {
    const h = harness()
    const agent = { session: { id: 's1' } }
    const hook = [...h.listeners.get('tools/post-execute')!][0]!
    const result = { isError: false, value: { structuredContent: {
      pid: 1, window_id: 10, snapshot_id: 'real-snapshot',
      elements: [{ element_index: 18, element_token: 'real-token' }],
    } } }
    await hook({ agent, name: 'mcp__cua-driver-mcp__get_window_state' }, result, async () => ({ kind: 'accept' }))
    const args = { pid: 1, element_token: 'real-token' }
    expect(h.guards[0]!({ agent, name: 'mcp__cua-driver-mcp__click', arguments: args })).toBeUndefined()
    expect(args).not.toHaveProperty('window_id')
    expect(h.guards[0]!({
      agent: { session: { id: 's2' } }, name: 'mcp__cua-driver-mcp__click', arguments: args,
    })).toBeUndefined()
  })

  it('passes direct input through while tracking optional PiP observations', async () => {
    const h = harness()
    const agent = { session: { id: 's1' } }
    const call = { agent, name: 'mcp__cua-driver-mcp__click', arguments: {
      pid: 1, window_id: 10, element_token: 'real-token', delivery_mode: 'background',
    } }
    const invoke = () => h.execute(call as Parameters<typeof h.execute>[0])
    const body = h.providerExecute
    const contexts: unknown[] = []
    const exec = {
      agent, signal: new AbortController().signal,
      deferContext: (context: unknown) => contexts.push(context),
    } as Parameters<Tool['execute']>[1]
    await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'Clock' })
    expect(h.guards[0]!(call)).toBeUndefined()
    expect(await invoke()).toMatchObject({ isError: false })
    expect(body).toHaveBeenCalledOnce()
    const observed = h.tool.execute({ action: 'observe' }, exec)
    await vi.advanceTimersByTimeAsync(40)
    expect(await observed).toMatchObject({ recording: { ready: true }, needsObservation: false, observationDelivery: 'queued' })
    expect(contexts).toEqual([expect.objectContaining({
      content: expect.arrayContaining([expect.objectContaining({
        type: 'image', attachment: expect.objectContaining({ attachmentId: 'image-ref' }),
      })]),
    })])
    expect(imageStore.saveImage).toHaveBeenCalledOnce()
    expect(h.guards[0]!(call)).toBeUndefined()
    expect(await invoke()).toMatchObject({ isError: false })
    const modelRequest = [...h.listeners.get('llm/stream')!][0]!
    const next = vi.fn(() => [])
    await modelRequest({ sessionId: 's1', messages: contexts }, next)
    expect(next).toHaveBeenCalledOnce()
    expect(h.guards[0]!(call)).toBeUndefined()
    await invoke()
    expect(body).toHaveBeenCalledTimes(3)
    expect(h.guards[0]!(call)).toBeUndefined()
    expect(h.guards[0]!({
      agent, name: 'computer_pip', arguments: { action: 'resize', width: 900, height: 600 },
    })).toContain('pip_observation_required')
    const after = h.tool.execute({ action: 'observe' }, exec)
    await vi.advanceTimersByTimeAsync(1100)
    expect(await after).toMatchObject({ needsObservation: false })
    expect(h.guards[0]!(call)).toBeUndefined()
    await modelRequest({ sessionId: 's1', messages: contexts }, next)
    expect(h.guards[0]!(call)).toBeUndefined()
  })

  it('does not treat auxiliary, cancelled or image-stripped model requests as PiP image delivery', async () => {
    const h = harness()
    const agent = { session: { id: 's1' } }
    const contexts: unknown[] = []
    const exec = {
      agent, signal: new AbortController().signal, deferContext: (context: unknown) => contexts.push(context),
    } as Parameters<Tool['execute']>[1]
    await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'Clock' })
    await vi.advanceTimersByTimeAsync(40)
    await h.tool.execute({ action: 'observe' }, exec)
    const call = { agent, name: 'computer_pip', arguments: { action: 'resize', width: 900, height: 600 } }
    const modelRequest = [...h.listeners.get('llm/stream')!][0]!
    const abort = new AbortController()
    abort.abort()
    for (const overrides of [
      { purpose: 'compaction' }, { purpose: 'session-title' }, { sessionId: 's2' },
      { messages: [] }, { signal: abort.signal },
    ]) {
      await modelRequest({ sessionId: 's1', messages: contexts, ...overrides }, () => [])
      expect(h.guards[0]!(call)).toContain('pip_observation_pending')
    }
    await modelRequest({ sessionId: 's1', messages: contexts }, () => [])
    expect(h.guards[0]!(call)).toBeUndefined()
  })

  it('surfaces failed monitoring to the next model step and to read-only Cua results', async () => {
    const h = harness()
    const { CuaError } = await import('../src/cua.ts')
    native.capture.mockRejectedValue(new CuaError('user stopped sharing', 'capture_stopped'))
    await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'Clock' })
    await vi.advanceTimersByTimeAsync(100)
    const agent = { session: { id: 's1' } }
    const preStep = [...h.listeners.get('agent/pre-step')!][0]!
    const result = await preStep({ agent, signal: new AbortController().signal }, async () => ({
      kind: 'enter', messages: [],
    })) as { messages: { content: { text?: string }[] }[] }
    expect(JSON.stringify(result.messages)).toContain('stopped')
    expect(JSON.stringify(result.messages)).toContain('direct Cua calls remain available')
    const post = [...h.listeners.get('tools/post-execute')!][0]!
    const decision = await post({
      agent, name: 'mcp__cua-driver-mcp__get_window_state',
    }, { isError: true }, async () => ({ kind: 'accept' }))
    expect(JSON.stringify(decision)).toContain('user stopped sharing')
    expect(h.guards[0]!({
      agent, name: 'mcp__cua-driver-mcp__get_window_state', arguments: { pid: 1, window_id: 10 },
    })).toBeUndefined()
  })

  it('does not unlock input when image persistence or final result acceptance fails', async () => {
    const h = harness()
    const agent = { session: { id: 's1' } }
    const contexts: unknown[] = []
    const exec = {
      agent, signal: new AbortController().signal, deferContext: (context: unknown) => contexts.push(context),
    } as Parameters<Tool['execute']>[1]
    await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'Clock' })
    await vi.advanceTimersByTimeAsync(40)
    const call = { agent, name: 'computer_pip', arguments: { action: 'resize', width: 900, height: 600 } }
    imageStore.saveImage.mockRejectedValueOnce(new Error('disk full'))
    await expect(h.tool.execute({ action: 'observe' }, exec)).rejects.toThrow('disk full')
    expect(h.guards[0]!(call)).toContain('pip_observation_required')
    const value = await h.tool.execute({ action: 'observe' }, exec)
    const post = [...h.listeners.get('tools/post-execute')!][0]!
    const blocked = { kind: 'block', feedback: [] }
    expect(await post({ ...exec, name: 'computer_pip', arguments: { action: 'observe' } },
      { value, isError: false }, async () => blocked)).toBe(blocked)
    const modelRequest = [...h.listeners.get('llm/stream')!][0]!
    await modelRequest({ sessionId: 's1', messages: contexts }, () => [])
    expect(h.guards[0]!(call)).toContain('pip_observation_required')
  })

  it('does not append old observation bindings when another result policy blocks the call', async () => {
    const h = harness()
    const hook = [...h.listeners.get('tools/post-execute')!][0]!
    const blocked = { kind: 'block', feedback: [{ type: 'text', text: 'denied' }] }
    expect(await hook(
      { name: 'mcp__cua-driver-mcp__get_window_state', agent: { session: { id: 's1' } } },
      { isError: false, value: { structuredContent: { pid: 1, window_id: 10, snapshot_id: 'old' } } },
      async () => blocked,
    )).toBe(blocked)
  })

  it.each([
    [null, 'expected an object'], [[], 'expected an object'],
    [{}, 'sessionId'], [{ sessionId: ' ' }, 'sessionId'],
    [{ sessionId: 's1', app: '' }, 'app'],
    [{ sessionId: 's1', app: 'Clock', pid: 1 }, 'not both'],
    [{ sessionId: 's1', pid: -1 }, 'positive integer'],
    [{ sessionId: 's1', windowId: 10 }, 'requires pid'],
    [{ sessionId: 's1', app: 'Clock', closeAfterSeconds: 0 }, 'closeAfterSeconds'],
  ])('rejects invalid open input with 400: %j', async (body, message) => {
    const h = harness()
    const response = await h.request(WATCH_PATH, 'POST', body)
    expect(response.status).toBe(400)
    expect(response.body.error).toContain(message)
    expect(driver.openApplication).not.toHaveBeenCalled()
  })

  it('rejects malformed and oversized JSON using the actual runtime body parser', async () => {
    const h = harness()
    expect((await h.request(WATCH_PATH, 'POST', undefined, '{')).status).toBe(400)
    expect((await h.request(WATCH_PATH, 'POST', undefined, ' '.repeat(256 * 1024 + 1))).status).toBe(413)
  })

  it('rejects missing and archived sessions before launching an application', async () => {
    const h = harness()
    expect((await h.request(WATCH_PATH, 'POST', { sessionId: 'missing', app: 'Clock' })).status).toBe(404)
    h.workspace.archivedSessionIds.push('s1')
    expect((await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'Clock' })).status).toBe(404)
    expect(driver.openApplication).not.toHaveBeenCalled()
  })

  it('supports explicit open, retained frames, focus, and idempotent close', async () => {
    const h = harness()
    const opened = await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'Clock' })
    expect(opened).toMatchObject({ status: 200, body: { ok: true, status: { sessionId: 's1', open: true, target: { pid: 1, windowId: 10 } } } })
    await vi.advanceTimersByTimeAsync(1000)
    const captured = await h.request(`${FRAME_PATH}?session=s1`)
    expect(captured).toMatchObject({
      status: 200, body: { ok: true, watching: true, state: { sessionId: 's1' } },
    })
    expect(captured.body.state.frames).toBeGreaterThan(0)
    expect((await h.request(FOCUS_PATH, 'POST', { sessionId: 's1' })).status).toBe(200)
    expect(driver.bringToFront).toHaveBeenCalledWith({ pid: 1, windowId: 10 })
    expect((await h.request(CLOSE_PATH, 'POST', { sessionId: 's1' })).body.status.open).toBe(false)
    expect((await h.request(UNWATCH_PATH, 'POST', { sessionId: 's1' })).body.status.open).toBe(false)
    expect((await h.request(`${FRAME_PATH}?session=s1`)).body).toEqual({ ok: true, watching: false })
  })

  it('keeps a host-scheduled close running after turn end and preserves the other session', async () => {
    const h = harness()
    await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'Clock' })
    await h.request(WATCH_PATH, 'POST', { sessionId: 's2', app: 'ima' })
    const scheduled = await h.request(SCHEDULE_PATH, 'POST', { sessionId: 's1', closeAfterSeconds: 30 })
    expect(scheduled).toMatchObject({ status: 200, body: { status: { closeAt: 31_000 } } })
    h.emit('session/event', { id: 's1' }, { type: 'turn/end' })
    await vi.advanceTimersByTimeAsync(30_000)
    const activity = await h.request(ACTIVITY_PATH)
    expect(activity.body.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: 's1', visible: false }),
      expect.objectContaining({ sessionId: 's2', visible: true }),
    ]))
    expect((await h.request(`${FRAME_PATH}?session=s1`)).body.watching).toBe(false)
    expect((await h.request(`${FRAME_PATH}?session=s2`)).body.watching).toBe(true)
  })

  it('ignores a close from an older preview and accepts the current preview timestamp', async () => {
    const h = harness()
    await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'Clock' })
    const first = (await h.request(ACTIVITY_PATH)).body.sessions[0].openedAt
    await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'ima' })
    const current = (await h.request(ACTIVITY_PATH)).body.sessions[0].openedAt
    expect(current).toBeGreaterThan(first)
    expect((await h.request(CLOSE_PATH, 'POST', { sessionId: 's1', openedAt: first })).body.status)
      .toMatchObject({ open: true, target: { pid: 2, windowId: 20 } })
    expect((await h.request(CLOSE_PATH, 'POST', { sessionId: 's1', openedAt: current })).body.status.open).toBe(false)
  })

  it('rejects focus from a stale displayed frame before activating an unrelated target', async () => {
    const h = harness()
    await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'Clock' })
    await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'ima' })
    const stale = await h.request(FOCUS_PATH, 'POST', { sessionId: 's1', pid: 1, windowId: 10 })
    expect(stale).toMatchObject({ status: 409, body: { error: expect.stringContaining('target changed') } })
    expect(driver.bringToFront).not.toHaveBeenCalled()
    const current = await h.request(FOCUS_PATH, 'POST', { sessionId: 's1', pid: 2, windowId: 20 })
    expect(current.status).toBe(200)
    expect(driver.bringToFront).toHaveBeenCalledWith({ pid: 2, windowId: 20 })
  })

  it('rejects malformed close timestamps and close schedules before mutating a preview', async () => {
    const h = harness()
    await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'Clock' })
    expect((await h.request(CLOSE_PATH, 'POST', { sessionId: 's1', openedAt: '1000' })).status).toBe(400)
    for (const duration of [undefined, '30', 0, -1, 86_401]) {
      expect((await h.request(SCHEDULE_PATH, 'POST', { sessionId: 's1', closeAfterSeconds: duration })).status).toBe(400)
    }
    expect((await h.request(ACTIVITY_PATH)).body.sessions[0]).toMatchObject({ visible: true })
  })

  it('returns a client-state conflict when scheduling a preview that is not open', async () => {
    const h = harness()
    const response = await h.request(SCHEDULE_PATH, 'POST', { sessionId: 's1', closeAfterSeconds: 30 })
    expect(response.status).toBe(409)
    expect(response.body.error).toMatch(/Open a PiP|not open/)
    expect(driver.openApplication).not.toHaveBeenCalled()
  })

  it('resizes an existing application and exposes preview preferences to the conversation client', async () => {
    const h = harness()
    await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'Clock', closeAfterSeconds: 30 })
    expect(await h.request(RESIZE_PATH, 'POST', { sessionId: 's1', width: 1000, height: 700 }))
      .toMatchObject({
        status: 200,
        body: { ok: true, status: { windowBounds: { width: 1000, height: 700 }, previewSize: null, closeAt: 31_000 } },
      })
    expect(driver.resizeApplicationWindow).toHaveBeenCalledWith(
      { pid: 1, windowId: 10 }, { width: 1000, height: 700 }, { signal: undefined },
    )
    expect(await h.request(RESIZE_PATH, 'POST', {
      sessionId: 's1', resizeTarget: 'preview', width: 480, height: 320,
    })).toMatchObject({
      status: 200, body: { status: { previewSize: { width: 480, height: 320 }, closeAt: 31_000 } },
    })
    expect((await h.request(ACTIVITY_PATH)).body.sessions).toEqual([
      expect.objectContaining({
        sessionId: 's1', windowBounds: { x: 0, y: 0, width: 1000, height: 700 },
        previewSize: { width: 480, height: 320 },
      }),
    ])
    expect(driver.resizeApplicationWindow).toHaveBeenCalledTimes(1)
    expect(driver.bringToFront).not.toHaveBeenCalled()
  })

  it.each([
    null, [], {}, { sessionId: ' ' },
    { sessionId: 's1' },
    { sessionId: 's1', width: 800 },
    { sessionId: 's1', width: '800', height: 600 },
    { sessionId: 's1', width: 800, height: 600.5 },
    { sessionId: 's1', width: 800, height: 0 },
    { sessionId: 's1', width: 16_385, height: 600 },
    { sessionId: 's1', width: 800, height: 600, resizeTarget: 'desktop' },
    { sessionId: 's1', width: 63, height: 320, resizeTarget: 'preview' },
  ])('rejects malformed resize input without changing the window: %j', async (body) => {
    const h = harness()
    await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'Clock' })
    expect((await h.request(RESIZE_PATH, 'POST', body)).status).toBe(400)
    expect(driver.resizeApplicationWindow).not.toHaveBeenCalled()
    expect((await h.request(ACTIVITY_PATH)).body.sessions[0]).toMatchObject({
      visible: true, windowBounds: windows[0]!.bounds,
    })
  })

  it.each([{ app: 'ima' }, { pid: 2 }, { windowId: 20 }])(
    'returns 400 for target selectors on resize before touching any app: %j',
    async (selector) => {
      const h = harness()
      await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'Clock' })
      driver.openApplication.mockClear()
      expect(await h.request(RESIZE_PATH, 'POST', {
        sessionId: 's1', width: 1000, height: 700, ...selector,
      })).toMatchObject({
        status: 400,
        body: { error: 'resize uses the currently watched window; use open to select app/pid/windowId first' },
      })
      expect(driver.resizeApplicationWindow).not.toHaveBeenCalled()
      expect(driver.openApplication).not.toHaveBeenCalled()
      expect((await h.request(ACTIVITY_PATH)).body.sessions[0]).toMatchObject({
        visible: true, target: { pid: 1, windowId: 10 }, windowBounds: windows[0]!.bounds,
      })
    },
  )

  it('rejects nonexistent, archived, and closed sessions before a native resize', async () => {
    const h = harness()
    const input = { width: 1000, height: 700 }
    expect((await h.request(RESIZE_PATH, 'POST', { sessionId: 'missing', ...input })).status).toBe(404)
    expect((await h.request(RESIZE_PATH, 'POST', { sessionId: 's1', ...input })).status).toBe(409)
    await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'Clock' })
    await h.request(CLOSE_PATH, 'POST', { sessionId: 's1' })
    expect((await h.request(RESIZE_PATH, 'POST', { sessionId: 's1', ...input })).status).toBe(409)
    await h.request(WATCH_PATH, 'POST', { sessionId: 's2', app: 'ima' })
    h.workspace.archivedSessionIds.push('s2')
    expect((await h.request(RESIZE_PATH, 'POST', { sessionId: 's2', ...input })).status).toBe(404)
    expect(driver.resizeApplicationWindow).not.toHaveBeenCalled()
  })

  it('returns a driver resize failure instead of claiming the requested bounds were applied', async () => {
    const h = harness()
    await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'Clock' })
    driver.resizeApplicationWindow.mockRejectedValueOnce(new Error('native resize refused'))
    expect(await h.request(RESIZE_PATH, 'POST', { sessionId: 's1', width: 1000, height: 700 }))
      .toMatchObject({ status: 502, body: { error: 'native resize refused' } })
    expect((await h.request(ACTIVITY_PATH)).body.sessions[0]).toMatchObject({
      visible: true, windowBounds: windows[0]!.bounds,
    })
  })

  it('does not open a preview in response to ordinary computer use events', async () => {
    const h = harness()
    h.emit('session/event', { id: 's1' }, {
      type: 'tool/call',
      data: { name: 'mcp__cua-driver__get_window_state', callId: 'call-1', arguments: { pid: 1, window_id: 10 } },
    })
    expect((await h.request(ACTIVITY_PATH)).body.sessions).toEqual([])
    expect(driver.listWindows).not.toHaveBeenCalled()
    expect(native.capture).not.toHaveBeenCalled()
  })

  it('removes disposed or archived session previews and their scheduled closes', async () => {
    const h = harness()
    await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'Clock', closeAfterSeconds: 30 })
    await h.request(WATCH_PATH, 'POST', { sessionId: 's2', app: 'ima', closeAfterSeconds: 30 })
    h.emit('session/disposed', { id: 's1' })
    h.workspace.archivedSessionIds.push('s2')
    await vi.advanceTimersByTimeAsync(1000)
    expect((await h.request(ACTIVITY_PATH)).body.sessions).toEqual([])
    expect((await h.request(`${FRAME_PATH}?session=s1`)).body.watching).toBe(false)
    expect((await h.request(`${FRAME_PATH}?session=s2`)).body.watching).toBe(false)
    const captures = native.capture.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(native.capture).toHaveBeenCalledTimes(captures)
  })

  it('reports driver failures without returning a successful empty preview', async () => {
    const h = harness()
    driver.openApplication.mockRejectedValue(new Error('permission_denied'))
    const response = await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'Clock' })
    expect(response).toMatchObject({ status: 502, body: { error: 'permission_denied' } })
    expect((await h.request(ACTIVITY_PATH)).body.sessions).toEqual([])
  })

  it('unregisters routes and session listeners and stops captures when unloaded', async () => {
    const h = harness()
    await h.request(WATCH_PATH, 'POST', { sessionId: 's1', app: 'Clock', closeAfterSeconds: 30 })
    for (const cleanup of cleanups.splice(0)) cleanup()
    expect(h.routes.size).toBe(0)
    h.emit('session/event', { id: 's1' }, { type: 'turn/end' })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(native.capture).not.toHaveBeenCalled()
    expect(native.dispose).toHaveBeenCalledOnce()
  })
})
