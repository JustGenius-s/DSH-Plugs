/**
 * The side-chat settings switches are enforced where every creation passes
 * through — not where each entry point happens to check.
 *
 * Two user-facing surfaces open a side chat: the side-panel tab (REST) and the
 * `/side` slash command. Gating them separately is how a feature ends up half
 * off — the panel entry disappears while the command still forks a side agent
 * nobody can see. Both funnel into one Host check, so these tests drive the
 * real handlers against the same fake seam `sidechat-temp-session.test.ts`
 * uses and assert the switch actually holds.
 *
 * The context option is the other half: turning it off must NOT close the
 * feature, it must open a side chat that simply starts blank — and it must
 * report that as 'off', distinguishable from 'none' (the parent had nothing to
 * give), so the UI never blames the user's setting for an empty parent.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDshCodexSideChatServer, inheritContextOf, sideCommandText } from '../src/host/side-chat/server'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../src/shared/config'

const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>()
const commands = new Map<string, (invocation: unknown) => unknown>()
let created: Record<string, unknown>[] = []
let injected: unknown[] = []

/** One live parent session with a completed turn, so a digest CAN be built. */
const parentId = 'session-parent-0000-0000-000000000000' as never
const parentSession = {
  header: { cwd: '/work/project' },
  events: [
    { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第一轮问题' }] } },
    { seq: 2, type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '第一轮回答' }] } } },
    { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ],
}

beforeEach(() => {
  registered.clear()
  commands.clear()
  created = []
  injected = []
})

function buildCtx(config: Partial<DshCodexConfig> = {}): any {
  const resolved: DshCodexConfig = { ...DEFAULT_CONFIG, ...config }
  return {
    config: resolved,
    webServer: {
      register: (spec: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) => {
        registered.set(spec.path, spec.handler)
        return () => { registered.delete(spec.path) }
      },
    },
    sessions: { get: (id: string) => (id === parentId ? parentSession : undefined) },
    agents: {
      create: async (options: Record<string, unknown>) => {
        created.push(options)
        return {
          agent: {
            status: 'idle',
            inject: (message: unknown) => { injected.push(message) },
          },
        }
      },
      get: () => undefined, // deliberately unusable: injection must use the handle
    },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
    get: (name: string) => (name === 'sessionTitle' ? undefined : undefined),
    on: () => () => {},
    effect: () => () => {},
    commands: {
      register: (spec: { name: string; handler: (invocation: unknown) => unknown }) => {
        commands.set(spec.name, spec.handler)
        return () => { commands.delete(spec.name) }
      },
    },
  }
}

async function withServer(
  ctx: any,
  config?: Partial<DshCodexConfig>,
): Promise<{ base: string; close: () => Promise<void> }> {
  createDshCodexSideChatServer(ctx, () => ({ ...DEFAULT_CONFIG, ...config }))
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/'
    const handler = registered.get(path)
    if (handler === undefined) { res.writeHead(404).end('{}'); return }
    handler(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

function open(base: string): Promise<Response> {
  return fetch(`${base}/dsh-codex/side-chat/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parentSessionId: parentId }),
  })
}

describe('side chat enabled switch', () => {
  it('refuses to open through the REST route when switched off', async () => {
    const { base, close } = await withServer(buildCtx(), { sideChatEnabled: false })
    try {
      const response = await open(base)
      // 409, not a generic failure: the route exists, the feature is off.
      expect(response.status).toBe(409)
      const body = await response.json() as { disabled?: boolean; reason?: string }
      expect(body.disabled).toBe(true)
      expect(body.reason).toBe('side-chat-disabled')
    } finally {
      await close()
    }
  })

  it('forks no side agent at all when switched off', async () => {
    // The point of the switch: off means off. A refusal that still spawned an
    // agent would leave a running session the user can never reach.
    const { base, close } = await withServer(buildCtx(), { sideChatEnabled: false })
    try {
      await open(base)
      expect(created).toHaveLength(0)
    } finally {
      await close()
    }
  })

  it('refuses through /side as well, so the command is not a back door', async () => {
    // Same gate, second entry point: the panel entry disappearing must not
    // leave the slash command forking side chats nobody can see.
    const { base, close } = await withServer(buildCtx(), { sideChatEnabled: false })
    try {
      const handler = commands.get('side')
      expect(handler).toBeTypeOf('function')
      const result = await handler!({ agent: { session: { id: parentId } } }) as { kind: string; text: string }
      expect(result.kind).toBe('error')
      expect(result.text).toContain('关闭')
      expect(created).toHaveLength(0)
      // The REST surface agrees with the command.
      expect((await open(base)).status).toBe(409)
    } finally {
      await close()
    }
  })

  it('opens normally while the switch is on', async () => {
    const { base, close } = await withServer(buildCtx(), { sideChatEnabled: true })
    try {
      const response = await open(base)
      expect(response.status).toBe(200)
      expect(created).toHaveLength(1)
    } finally {
      await close()
    }
  })

  it('defaults to enabled, so a config without the key still works', async () => {
    const { base, close } = await withServer(buildCtx())
    try {
      const response = await open(base)
      expect(response.status).toBe(200)
    } finally {
      await close()
    }
  })
})

describe('side chat context switch', () => {
  it('opens a side chat but injects nothing when context is off', async () => {
    // The switch is NOT a second on/off for the feature: the side chat still
    // opens, it just starts blank on purpose.
    const { base, close } = await withServer(buildCtx(), { sideChatContextEnabled: false })
    try {
      const response = await open(base)
      expect(response.status).toBe(200)
      expect(created).toHaveLength(1)
      expect(injected).toHaveLength(0)
    } finally {
      await close()
    }
  })

  it("reports 'off', not 'none', so the UI can tell the two apart", async () => {
    // 'none' means "asked for it, the parent had nothing"; 'off' means "asked
    // not to". Collapsing them would blame the user's setting for an empty
    // parent, or claim a setting took effect when nothing was available anyway.
    const { base, close } = await withServer(buildCtx(), { sideChatContextEnabled: false })
    try {
      const body = await (await open(base)).json() as { context?: string }
      expect(body.context).toBe('off')
    } finally {
      await close()
    }
  })

  it('still inherits the digest while the context switch is on', async () => {
    const { base, close } = await withServer(buildCtx(), { sideChatContextEnabled: true })
    try {
      const body = await (await open(base)).json() as { context?: string }
      expect(body.context).toBe('inherited')
      expect(injected).toHaveLength(1)
    } finally {
      await close()
    }
  })

  it("keeps 'none' for a parent with nothing to give, even with context on", async () => {
    // Regression guard: the two reasons must stay distinct.
    const ctx = buildCtx({ sideChatContextEnabled: true })
    ctx.sessions.get = () => ({ header: { cwd: '/work' }, events: [] })
    const { base, close } = await withServer(ctx, { sideChatContextEnabled: true })
    try {
      const body = await (await open(base)).json() as { context?: string }
      expect(body.context).toBe('none')
    } finally {
      await close()
    }
  })

  it('does not read the parent log for a digest when context is off', async () => {
    // Not merely "built and discarded": the switch skips the work. Measured as
    // a difference rather than an absolute count because the open path reads
    // the parent log for other reasons too (preset resolution) — what matters
    // is that turning context off removes the digest's own reads.
    const eventReads = async (contextEnabled: boolean): Promise<number> => {
      let reads = 0
      const parent = {
        header: { cwd: '/work/project' },
        get events() {
          reads += 1
          return parentSession.events
        },
      }
      const ctx = buildCtx()
      ctx.sessions.get = (id: string) => (id === parentId ? parent : undefined)
      const { base, close } = await withServer(ctx, { sideChatContextEnabled: contextEnabled })
      try {
        await open(base)
        return reads
      } finally {
        await close()
      }
    }
    expect(await eventReads(false)).toBeLessThan(await eventReads(true))
  })
})

describe('inheritContextOf', () => {
  it('is on by default, so an unset config keeps the current behavior', () => {
    expect(inheritContextOf(undefined)).toBe(true)
    expect(inheritContextOf(DEFAULT_CONFIG)).toBe(true)
  })

  it('is off only when the setting is explicitly false', () => {
    expect(inheritContextOf({ ...DEFAULT_CONFIG, sideChatContextEnabled: false })).toBe(false)
    expect(inheritContextOf({ ...DEFAULT_CONFIG, sideChatContextEnabled: true })).toBe(true)
  })
})

describe('sideCommandText', () => {
  it('says the context came along when it did', () => {
    expect(sideCommandText('session-1', 'inherited')).toContain('已带上当前对话上下文')
  })

  it('says the setting kept it blank, not that the parent was empty', () => {
    const text = sideCommandText('session-1', 'off')
    expect(text).toContain('设置')
    expect(text).not.toContain('暂无可继承')
  })

  it('says the parent had nothing to give', () => {
    expect(sideCommandText('session-1', 'none')).toContain('暂无可继承')
  })
})
