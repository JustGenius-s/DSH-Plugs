import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { createWindowTool } from '../src/window-tool.ts'
import type { WindowSessions } from '../src/window-session.ts'
import type { WindowExecution } from '../src/window-driver.ts'

const requireRuntime = createRequire(new URL('../../../packages/runtime/package.json', import.meta.url))
const { assertSupportedJsonSchema, validateJsonSchemaValue } = await import(requireRuntime.resolve('@deepseek-ai/dsh-tools'))
function harness() {
  const base = {
    status: 'unbound', targetId: null, target: null, provider: null, recording: {}, error: null,
    observation: null, capabilities: {}, batch: null,
  }
  const sessions = {
    bind: vi.fn(async () => ({ ...base, status: 'not_ready', targetId: 'bound' })),
    observe: vi.fn(async () => ({ ...base, status: 'queued', observation: { observationId: 'observed' } })),
    act: vi.fn(async () => ({ ...base, status: 'queued', batch: { results: [] } })),
    status: vi.fn(() => base),
  }
  const tool = createWindowTool(sessions as unknown as WindowSessions)
  const exec = { agent: { session: { id: 's1' } }, signal: new AbortController().signal } as WindowExecution
  return { tool, sessions, exec }
}

describe('computer_window public tool contract', () => {
  it('compiles through the shared schema compiler and carries structured results', async () => {
    const h = harness()
    expect(() => assertSupportedJsonSchema(h.tool.parameters)).not.toThrow()
    expect(() => assertSupportedJsonSchema(h.tool.output.schema)).not.toThrow()
    const value = await h.tool.execute({ action: 'bind', pid: 42, windowId: 73 }, h.exec)
    expect(validateJsonSchemaValue(h.tool.output.schema, value)).toEqual([])
    expect(h.sessions.bind).toHaveBeenCalledWith({ app: undefined, pid: 42, windowId: 73 }, h.exec)
    await h.tool.execute({ action: 'observe', targetId: 'bound' }, h.exec)
    expect(h.sessions.observe).toHaveBeenCalledWith('bound', h.exec)
    const steps = [{ kind: 'click', x: 20, y: 20 }]
    await h.tool.execute({ action: 'act', targetId: 'bound', observationId: 'observed', steps }, h.exec)
    expect(h.sessions.act).toHaveBeenCalledWith('bound', 'observed', steps, h.exec)
  })

  it.each([
    {}, { action: 'bind' }, { action: 'bind', pid: 42 }, { action: 'drag' }, { action: 'act', steps: [{ kind: 'drag' }] },
    { action: 'act', steps: [{ kind: 'click', x: '20', y: 20 }] },
    { action: 'act', targetId: 'bound' }, { action: 'observe' },
    { action: 'observe', targetId: 'bound', pid: 99 },
    { action: 'bind', app: 'Test', steps: [] },
    { action: 'observe', targetId: 'bound', steps: [] },
  ])('rejects invalid/ambiguous requests before driver work: %j', async (args) => {
    const h = harness()
    await expect(h.tool.execute(args, h.exec)).rejects.toThrow()
    expect(h.sessions.act).not.toHaveBeenCalled()
    expect(h.sessions.observe).not.toHaveBeenCalled()
    expect(h.sessions.bind).not.toHaveBeenCalled()
  })

  it('takes ownership from the calling session, never a model-supplied session id', async () => {
    const h = harness()
    await h.tool.execute({ action: 'status', sessionId: 's2' }, h.exec)
    expect(h.sessions.status).toHaveBeenCalledWith('s1')
    await expect(h.tool.execute({ action: 'status' }, { signal: new AbortController().signal } as WindowExecution))
      .rejects.toThrow('calling session')
    const abort = new AbortController()
    abort.abort(new Error('cancelled'))
    await expect(h.tool.execute({ action: 'bind', app: 'Test' }, { ...h.exec, signal: abort.signal })).rejects.toThrow('cancelled')
  })
})
