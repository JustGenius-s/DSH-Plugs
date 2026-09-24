import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, expect, test, vi } from 'vitest'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { apply } from '../src/index.ts'
import { FlowOrchestrator } from '../src/orchestrator.ts'
import { ACTION_PATH, MODE_PATH, STATE_PATH, type FlowStateResponse } from '../src/shared.ts'

afterEach(() => vi.restoreAllMocks())

function setup(status: 'idle' | 'running' = 'idle') {
  const agent = { session: { id: 'session-1' }, status, steer: vi.fn() }
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>()
  const events = new Map<string, (payload: unknown, next: () => unknown) => unknown>()
  const disposers: Array<() => void> = []
  const command = vi.fn((_registration: {
    name: string
    handler(input: { agent: unknown; rawInput: string }): unknown
  }) => () => {})
  const registerTool = vi.fn((_tool: { name: string }) => () => {})
  const registerGuard = vi.fn((_guard: (exec: { agent: typeof agent; name: string; parent?: symbol }) => string | undefined) => () => {})
  const ctx = {
    agents: { get: (id: string) => id === agent.session.id ? agent : undefined },
    get: () => undefined,
    logger: () => ({ warn: vi.fn() }),
    tools: { register: registerTool, guard: registerGuard },
    systemPrompt: { section: () => () => {} },
    commands: { register: command },
    webServer: {
      register(route: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    on(name: string, handler: (payload: unknown, next: () => unknown) => unknown) {
      events.set(name, handler)
      return () => events.delete(name)
    },
    effect(start: () => (() => void) | undefined) {
      const dispose = start()
      if (dispose !== undefined) disposers.push(dispose)
      return dispose
    },
    inject(_services: string[], start: (ctx: unknown) => void) { start(ctx) },
  }
  apply(ctx as unknown as Context)

  async function request(path: string, body?: unknown, sessionId = agent.session.id) {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as IncomingMessage
    req.method = body === undefined ? 'GET' : 'POST'
    req.url = `${path}?sessionId=${encodeURIComponent(sessionId)}`
    return new Promise<{ status: number; body: { ok: boolean; value: FlowStateResponse; message?: string } }>(resolve => {
      let status = 0
      const res = {
        writeHead(code: number) { status = code },
        end(text: string) { resolve({ status, body: JSON.parse(text) }) },
      } as unknown as ServerResponse
      routes.get(path)!(req, res)
    })
  }
  return {
    agent, request, command, registerTool,
    guard: registerGuard.mock.calls[0]![0],
    preStep: () => events.get('agent/pre-step')!({ agent }, () => ({ kind: 'continue' })),
    dispose: () => { for (const dispose of disposers.reverse()) dispose() },
  }
}

test('menu entry during an open turn is queued and committed at the next step', async () => {
  const host = setup('running')
  expect((await host.request(MODE_PATH, { on: true })).status).toBe(200)
  expect((await host.request(STATE_PATH)).body.value).toMatchObject({ mode: true, modePending: true })
  host.preStep()
  expect((await host.request(STATE_PATH)).body.value).toMatchObject({ mode: true, modePending: null })
  host.dispose()
})

test.each([MODE_PATH, ACTION_PATH])('chip exit through %s clears the plan using slash-command semantics', async path => {
  const host = setup()
  await host.request(MODE_PATH, { on: true })
  const view = vi.spyOn(FlowOrchestrator.prototype, 'view').mockReturnValue({ id: 'plan-1' } as never)
  const action = vi.spyOn(FlowOrchestrator.prototype, 'applyAction').mockReturnValue({ ok: true, message: null })
  const body = path === MODE_PATH ? { on: false } : { kind: 'setMode', on: false }
  expect((await host.request(path, body)).status).toBe(200)
  expect(action).toHaveBeenCalledWith({ kind: 'clear' })
  view.mockRestore()
  expect((await host.request(STATE_PATH)).body.value.mode).toBe(false)
  host.dispose()
})

test('turning off before the next step cancels pending entry', async () => {
  const host = setup('running')
  await host.request(MODE_PATH, { on: true })
  await host.request(MODE_PATH, { on: false })
  expect((await host.request(STATE_PATH)).body.value).toMatchObject({ mode: false, modePending: null })
  host.dispose()
})

test('unknown sessions cannot change Flow mode', async () => {
  const host = setup()
  const result = await host.request(MODE_PATH, { on: true }, 'missing')
  expect(result.status).toBe(404)
  expect(result.body.ok).toBe(false)
  expect((await host.request(STATE_PATH)).body.value.mode).toBe(false)
  host.dispose()
})

test('typed /flow arguments forward task text and accept off without a duplicate Host menu row', async () => {
  const host = setup()
  expect(host.command).not.toHaveBeenCalled()
  expect((await host.request(MODE_PATH, { rawInput: '  调整登录流程  ' })).status).toBe(200)
  expect(host.agent.steer).toHaveBeenCalledWith(expect.objectContaining({
    content: [{ type: 'text', text: '调整登录流程' }],
  }))
  expect((await host.request(STATE_PATH)).body.value.mode).toBe(true)
  await host.request(MODE_PATH, { rawInput: 'off' })
  expect((await host.request(STATE_PATH)).body.value.mode).toBe(false)
  host.dispose()
})

test.each([{ rawInput: 123 }, { rawInput: 'off', on: true }])('invalid command bodies do not change the mode: %j', async body => {
  const host = setup()
  expect((await host.request(MODE_PATH, body)).status).toBe(400)
  expect((await host.request(STATE_PATH)).body.value.mode).toBe(false)
  expect(host.agent.steer).not.toHaveBeenCalled()
  host.dispose()
})

test('Flow mode limits the Leader to the five planning tools', async () => {
  const host = setup()
  await host.request(MODE_PATH, { on: true })
  const names = host.registerTool.mock.calls.map(([tool]) => tool.name)
  const allowed = ['flow_plan', 'flow_status', 'flow_next', 'flow_patch', 'flow_confirm']
  for (const name of allowed) {
    expect(names).toContain(name)
    expect(host.guard({ agent: host.agent, name })).toBeUndefined()
  }
  for (const name of ['flow_expand', 'flow_report', 'flow_clear', 'read', 'glob', 'grep', 'read_image',
    'web_search', 'web_fetch', 'skill', 'todo_write', 'ask_user_question', 'bash', 'edit', 'write']) {
    expect(host.guard({ agent: host.agent, name })).toContain('unavailable')
  }
  host.dispose()
})

test('run_code can transport Flow calls while nested task tools remain blocked', async () => {
  const host = setup()
  await host.request(MODE_PATH, { on: true })
  const parent = Symbol('run_code execution')
  expect(host.guard({ agent: host.agent, name: 'run_code' })).toBeUndefined()
  for (const name of ['flow_plan', 'flow_status', 'flow_next', 'flow_patch', 'flow_confirm']) {
    expect(host.guard({ agent: host.agent, name, parent })).toBeUndefined()
  }
  for (const name of ['read', 'write', 'edit', 'bash', 'web_fetch', 'flow_expand', 'flow_report', 'flow_clear']) {
    expect(host.guard({ agent: host.agent, name, parent })).toContain('unavailable to the Leader')
  }
  host.dispose()
})

test('Leader restrictions do not apply to child sessions and are released on exit', async () => {
  const host = setup()
  await host.request(MODE_PATH, { on: true })
  const child = { ...host.agent, session: { id: 'child-1' } }
  for (const name of ['read', 'bash', 'flow_expand', 'flow_report', 'flow_confirm']) {
    expect(host.guard({ agent: child, name })).toBeUndefined()
  }
  await host.request(MODE_PATH, { on: false })
  expect(host.guard({ agent: host.agent, name: 'read' })).toBeUndefined()
  expect(host.guard({ agent: host.agent, name: 'bash' })).toBeUndefined()
  host.dispose()
})
