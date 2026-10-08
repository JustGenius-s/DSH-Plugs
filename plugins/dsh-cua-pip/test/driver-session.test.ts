import { afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { DriverSessions } from '../src/driver-session.ts'
import { backgroundRefusal } from '../src/background-policy.ts'

const runtime = createRequire(new URL('../../../packages/runtime/package.json', import.meta.url))
const toolsEntry = process.env.DSH_HOST_TOOLS_ENTRY ?? runtime.resolve('@deepseek-ai/dsh-tools')
const host = createRequire(toolsEntry)
const { Context } = await import(host.resolve('@deepseek-ai/cordis'))
const { ToolRuntime } = await import(toolsEntry)
const { createScope } = await import(host.resolve('@deepseek-ai/dsh-scope'))
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

const prefix = 'mcp__cua-driver-mcp__'
async function harness() {
  const ctx = new Context()
  ctx.provide('systemPrompt', { tools() {} })
  const fiber = ctx.plugin(ToolRuntime)
  await fiber
  const one = { session: { id: 'one' } }
  const two = { session: { id: 'two' } }
  const scopes = [createScope(ctx, one), createScope(ctx, two)]
  const active = new Set<string>()
  const calls: { operation: string; session: string; args: Record<string, unknown> }[] = []
  const controls = {
    startFailure: '', actionFailure: '', deny: '', conclude: false, cancel: undefined as (() => void) | undefined,
    post: undefined as ((exec: any, result: any, next: any) => Promise<any>) | undefined,
  }
  let sessions: DriverSessions
  let sequence = 0
  const image = { type: 'image', attachment: { attachmentId: 'actual-image', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }
  const plugin = ctx.plugin({
    inject: ['tools'],
    apply(inner: any) {
      for (const operation of ['start_session', 'end_session', 'get_session', 'list_windows', 'get_window_state', 'zoom', 'click', 'check_permissions']) {
        const images = new WeakMap()
        inner.tools.register({
          name: prefix + operation, description: 'Driver contract fixture; no OS input',
          parameters: { type: 'object', properties: {} },
          output: { schema: { type: 'object' }, render: () => [{ type: 'text', text: 'driver text' }] },
          async execute(args: Record<string, unknown>, exec: any) {
            const label = String(args.session)
            calls.push({ operation, session: label, args })
            if (operation === 'start_session') {
              if (controls.startFailure) throw new Error(controls.startFailure)
              active.add(label)
              controls.cancel?.()
              return { session: label }
            }
            if (!active.has(label)) throw new Error(`session '${label}' has ended`)
            if (operation === 'end_session') active.delete(label)
            if (controls.actionFailure) throw new Error(controls.actionFailure)
            if (controls.conclude) exec.concludeTurn()
            if (operation === 'get_window_state') images.set(exec, [image])
            return { session: label, windows: [] }
          },
          finalizeContent(exec: any, result: any) {
            return result.isError ? undefined : images.get(exec)
          },
        })
      }
      sessions = new DriverSessions(inner.tools, () => `fixture-${++sequence}`)
      inner.tools.guard((exec: any) => controls.deny && exec.name.endsWith(controls.deny)
        ? 'another host policy denied dispatch' : backgroundRefusal(exec.name, exec.arguments))
      inner.on('tools/execute', (exec: any, next: any) => sessions.execute(exec, next))
      inner.on('tools/post-execute', async (exec: any, result: any, next: any) => {
        const decision = controls.post === undefined ? await next() : await controls.post(exec, result, next)
        if (decision.kind !== 'accept' || 'value' in decision || 'content' in decision) return decision
        const content = sessions.content(exec, result)
        return content === undefined ? decision : { ...decision, content }
      })
    },
  })
  await plugin
  cleanups.push(async () => {
    sessions.dispose()
    for (const scope of scopes) await scope.dispose()
    await plugin.dispose()
    await fiber.dispose()
  })
  const call = (operation = 'list_windows', args: Record<string, unknown> = {}, agent = one, signal = new AbortController().signal) =>
    ctx.tools.execute({ name: prefix + operation, arguments: args, agent, signal, callId: `test-${++sequence}` })
  return { call, calls, active, controls, one, two, image, sessions: sessions! }
}

describe('managed Cua sessions through the real ToolRuntime', () => {
  it('recovers idle expiry before dispatch and consistently fills omitted or obsolete labels', async () => {
    const h = await harness()
    expect((await h.call('get_window_state', { session: 'cua-fix' })).isError).toBe(false)
    const id = h.calls.at(-1)!.session
    h.active.clear()
    expect((await h.call('zoom', { window_id: 33 })).isError).toBe(false)
    expect(h.calls.map((call) => call.operation)).toEqual(['start_session', 'get_window_state', 'start_session', 'zoom'])
    expect(new Set(h.calls.map((call) => call.session))).toEqual(new Set([id]))
    expect(id).not.toBe('cua-fix')
  })

  it('isolates DSH conversations even when the model copies another conversation label', async () => {
    const h = await harness()
    await h.call()
    const first = h.calls.at(-1)!.session
    await h.call('list_windows', { session: first }, h.two)
    expect(h.calls.at(-1)!.session).not.toBe(first)
    await h.call()
    expect(h.calls.at(-1)!.session).toBe(first)
  })

  it('keeps a stable label for concurrent calls', async () => {
    const h = await harness()
    const results = await Promise.all([h.call(), h.call(), h.call()])
    expect(results.every((result) => !result.isError)).toBe(true)
    expect(new Set(h.calls.map((call) => call.session)).size).toBe(1)
  })

  it('makes permission diagnostics explicitly non-prompting', async () => {
    const h = await harness()
    expect((await h.call('check_permissions')).isError).toBe(false)
    expect(h.calls.at(-1)!.args.prompt).toBe(false)
  })

  it('does not finish an application action after its owning session was disposed during preflight', async () => {
    const h = await harness()
    h.controls.cancel = () => h.sessions.clear('one')
    expect((await h.call()).isError).toBe(true)
    expect(h.calls.map((call) => call.operation)).toEqual(['start_session'])
  })

  it('does not auto-reopen an explicitly ended run', async () => {
    const h = await harness()
    await h.call()
    await h.call('end_session')
    expect(await h.call()).toMatchObject({ isError: true, error: { message: expect.stringContaining('explicitly restart') } })
    await h.call('start_session', { session: 'old' })
    expect((await h.call()).isError).toBe(false)
  })

  it('keeps an uncertain explicit stop paused until an explicit restart', async () => {
    const h = await harness()
    await h.call()
    h.controls.actionFailure = 'connection lost while ending session'
    expect((await h.call('end_session')).isError).toBe(true)
    h.controls.actionFailure = ''
    expect(await h.call()).toMatchObject({ isError: true, error: { message: expect.stringContaining('explicitly restart') } })
  })

  it.each(['permission_denied', 'session revoked', 'transport closed'])('does not dispatch input when preflight fails: %s', async (message) => {
    const h = await harness()
    h.controls.startFailure = message
    expect(await h.call('click', { pid: 1, window_id: 2, element_token: 'real' })).toMatchObject({ isError: true })
    expect(h.calls.map((call) => call.operation)).toEqual(['start_session'])
  })

  it('does not replay uncertain input failures', async () => {
    const h = await harness()
    h.controls.actionFailure = 'session expired after dispatch; input outcome unknown'
    expect((await h.call('click', { pid: 1, window_id: 2, element_token: 'real' })).isError).toBe(true)
    expect(h.calls.filter((call) => call.operation === 'click')).toHaveLength(1)
  })

  it('retains independent host guards on both lifecycle and application calls', async () => {
    const h = await harness()
    h.controls.deny = 'start_session'
    expect((await h.call()).isError).toBe(true)
    expect(h.calls).toEqual([])
    h.controls.deny = 'click'
    expect((await h.call('click', { pid: 1, window_id: 2, element_token: 'real' })).isError).toBe(true)
    expect(h.calls).toEqual([])
  })

  it('cancels between lifecycle preflight and the application body', async () => {
    const h = await harness()
    const abort = new AbortController()
    h.controls.cancel = () => abort.abort()
    expect((await h.call('list_windows', {}, h.one, abort.signal)).isError).toBe(true)
    expect(h.calls.map((call) => call.operation)).toEqual(['start_session'])
  })

  it('preserves MCP image projection across nested result normalization', async () => {
    const h = await harness()
    expect(await h.call('get_window_state')).toMatchObject({ isError: false, content: [h.image] })
  })

  it('preserves lifecycle policy context alongside the original tool result', async () => {
    const h = await harness()
    const notice = {
      id: 'lifecycle-notice', role: 'user', content: [{ type: 'text', text: 'lifecycle policy notice' }],
      source: { kind: 'plugin', plugin: 'test', form: 'notice', summary: 'lifecycle' },
    }
    h.controls.post = async (exec, _result, next) => exec.name.endsWith('start_session')
      ? { kind: 'accept', additionalContexts: [notice] } : next()
    expect(await h.call()).toMatchObject({ isError: false, additionalContexts: [notice] })
  })

  it('never restores an image over another post-result policy', async () => {
    const h = await harness()
    h.controls.post = async () => ({ kind: 'accept', content: [{ type: 'text', text: 'redacted' }] })
    expect(await h.call('get_window_state')).toMatchObject({ isError: false, content: [{ type: 'text', text: 'redacted' }] })
    h.controls.post = async () => ({ kind: 'block', feedback: [{ type: 'text', text: 'blocked' }] })
    expect((await h.call('get_window_state')).isError).toBe(true)
  })

  it('propagates a provider conclusion to the enclosing model call', async () => {
    const h = await harness()
    h.controls.conclude = true
    expect(await h.call()).toMatchObject({ isError: false, concludesTurn: true })
  })

  it('invalidates labels on session disposal and refuses dispatch after unload', async () => {
    const h = await harness()
    await h.call()
    const previous = h.calls.at(-1)!.session
    h.sessions.clear('one')
    await h.call()
    expect(h.calls.at(-1)!.session).not.toBe(previous)
    h.sessions.dispose()
    expect((await h.call()).isError).toBe(true)
  })
})
