/**
 * A side chat is TEMPORARY, not a fork.
 *
 * These pin the two decisions that make it so, both taken from the reference
 * DSH side-chat plugins:
 *
 * 1. The child's session meta must NOT carry `parentSession`. That field is the
 *    durable lineage the workspace tree and the subagent catalog read, so
 *    setting it makes a "temporary" side chat a permanent child of the main
 *    conversation. The parent link lives in the process registry instead and
 *    disappears on close.
 * 2. The parent's identity-only link is injected on the handle `agents.create` resolved to
 *    — not looked up again with `agents.get()`, which is not reliably visible
 *    on the same tick and silently degraded every side chat to 'none'.
 *
 * The routes are booted against a fake seam so the assertions run on the real
 * handler rather than on a reimplementation of it.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDshCodexSideChatServer } from '../src/host/side-chat/server'

const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>()
let created: Record<string, unknown>[] = []
let injected: unknown[] = []
let childEvents: { type: string; data: unknown }[] = []
let scopedTools: { name: string; execute: (args: unknown, exec: unknown) => Promise<{ text: string }> }[] = []

/** One live parent session with a couple of completed turns. */
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
  created = []
  injected = []
  childEvents = []
  scopedTools = []
})

function buildCtx(): any {
  return {
    webServer: {
      register: (spec: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) => {
        registered.set(spec.path, spec.handler)
        return () => { registered.delete(spec.path) }
      },
    },
    sessions: { get: (id: string) => (id === parentId ? parentSession : undefined) },
    agents: {
      create: async (options: Record<string, unknown>) => {
        const agent = {
          session: {
            id: options.sessionId,
            append: (type: string, data: unknown) => { childEvents.push({ type, data }) },
          },
          status: 'idle',
          inject: (message: unknown) => { injected.push(message) },
        }
        const setup = options.setup as (ctx: unknown, agent?: unknown) => Promise<void>
        await setup({ tools: { register: (tool: typeof scopedTools[number]) => {
          scopedTools.push(tool)
          return () => {}
        } } }, agent)
        // Publication happens only after setup has seeded the selection.
        created.push(options)
        return { agent }
      },
      get: () => undefined, // deliberately unusable: injection must use the handle
    },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
    get: (name: string) => (name === 'sessionTitle' ? undefined : undefined),
    on: () => () => {},
    effect: () => () => {},
    commands: { register: () => () => {} },
  }
}

async function withServer(ctx: any): Promise<{ base: string; close: () => Promise<void> }> {
  createDshCodexSideChatServer(ctx)
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

describe('side chat open', () => {
  it('serves recent non-subagent references with the parent workspace first', async () => {
    const ctx = buildCtx()
    const { base, close } = await withServer(ctx)
    try {
      const opened = await fetch(`${base}/dsh-codex/side-chat/open`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentSessionId: parentId }),
      })
      const { sideSessionId } = await opened.json() as { sideSessionId: string }
      ctx.agents.get = (id: string) => ({ id, session: { header: parentSession.header } })
      const now = Date.now()
      const candidates = [
        { sessionId: 'other', label: 'Other', cwd: '/elsewhere' },
        { sessionId: parentId, label: 'Parent', cwd: '/work/project' },
        { sessionId: 'child', label: 'Worker', cwd: '/work/project' },
        { sessionId: 'old', label: 'Old', cwd: '/work/project' },
        { sessionId: 'blank', label: 'New draft', cwd: '/work/project' },
        { sessionId: 'untitled', label: 'untitled', displayTitle: 'untitled', cwd: '/work/project' },
        { sessionId: 'archived', label: 'Archived conversation', cwd: '/elsewhere' },
      ]
      const resolver = {
        listCandidates: async () => [
          ...candidates,
        ],
      }
      const controller = { list: async () => ({ items: [
        { sessionId: parentId, cwd: '/work/project', updatedAt: now - 1000 },
        { sessionId: 'other', cwd: '/elsewhere', updatedAt: now },
        { sessionId: 'child', cwd: '/work/project', updatedAt: now, origin: 'subagent' },
        { sessionId: 'old', cwd: '/work/project', updatedAt: now - 8 * 24 * 60 * 60 * 1000 },
        { sessionId: 'blank', cwd: '/work/project', updatedAt: now, blank: true },
        { sessionId: 'untitled', cwd: '/work/project', updatedAt: now, blank: false },
        { sessionId: 'archived', cwd: '/elsewhere', updatedAt: now, blank: false },
      ] }) }
      ctx.get = (name: string) => name === 'sessionReferenceResolver' ? resolver
        : name === 'sessionController' ? controller
          : name === 'workspaceRegistry' ? { archivedSessionIds: ['archived'] } : undefined
      const response = await fetch(`${base}/dsh-codex/side-chat/references?sideSessionId=${sideSessionId}`)
      expect(response.status).toBe(200)
      const body = await response.json() as { candidates: { sessionId: string; mention: string; sameWorkspace: boolean }[] }
      expect(body.candidates.map(row => row.sessionId)).toEqual([parentId, 'other'])
      expect(body.candidates.map(row => row.sameWorkspace)).toEqual([true, false])
      expect(body.candidates[0]?.mention).toContain('dsh-session:')
      expect((await fetch(`${base}/dsh-codex/side-chat/references?sideSessionId=unknown`)).status).toBe(404)
      expect((await fetch(`${base}/dsh-codex/side-chat/references`)).status).toBe(404)
      expect((await fetch(`${base}/dsh-codex/side-chat/references`, { method: 'POST' })).status).toBe(405)
      ctx.get = (name: string) => name === 'sessionReferenceResolver' ? resolver : undefined
      const unavailable = await fetch(`${base}/dsh-codex/side-chat/references?sideSessionId=${sideSessionId}`)
      expect(unavailable.status).toBe(503)
      expect(await unavailable.json()).toMatchObject({ error: '会话活跃记录服务不可用' })
      ctx.get = () => undefined
      expect((await fetch(`${base}/dsh-codex/side-chat/references?sideSessionId=${sideSessionId}`)).status).toBe(503)
    } finally {
      await close()
    }
  })

  it(
    'seeds the inherited model before publication with 0.1.7 agent setup',
    async () => {
      const ctx = buildCtx()
      const config = { provider: 'cursor', model: 'kimi-k3', reasoningEffort: 'high' }
      ctx.sessions.get = () => ({
        ...parentSession,
        requestHeader: () => ({ config }),
      })
      const { base, close } = await withServer(ctx)
      try {
        const response = await fetch(`${base}/dsh-codex/side-chat/open`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ parentSessionId: parentId }),
        })
        expect(response.status).toBe(200)
        expect(created[0]?.agentOptions).toEqual(config)
        expect(childEvents).toEqual([{ type: 'model/selection', data: config }])
      } finally {
        await close()
      }
    },
  )

  it('reads a pending parent selection from the host projection', async () => {
    const ctx = buildCtx()
    const selected = { provider: 'cursor', model: 'new-model', reasoningEffort: 'low' }
    ctx.get = (name: string) => name === 'sessionProjections'
      ? { stateOf: () => ({ pending: selected }) }
      : undefined
    const { base, close } = await withServer(ctx)
    try {
      const response = await fetch(`${base}/dsh-codex/side-chat/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentSessionId: parentId }),
      })
      expect(response.status).toBe(200)
      expect(created[0]?.agentOptions).toEqual(selected)
      expect(childEvents).toEqual([{ type: 'model/selection', data: selected }])
    } finally {
      await close()
    }
  })

  it('creates the child WITHOUT durable parent lineage', async () => {
    const ctx = buildCtx()
    const { base, close } = await withServer(ctx)
    try {
      const response = await fetch(`${base}/dsh-codex/side-chat/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentSessionId: parentId }),
      })
      expect(response.status).toBe(200)
      const meta = created[0]?.meta as Record<string, unknown> | undefined
      expect(meta).toBeDefined()
      // The whole point: no durable link back to the parent.
      expect(meta?.parentSession).toBeUndefined()
      // The sandbox still comes along, so the side chat reads the same files.
      expect(meta?.cwd).toBe('/work/project')
      expect(childEvents).toEqual([])
    } finally {
      await close()
    }
  })

  it('injects only a parent link on the created handle and scopes the read tool', async () => {
    const ctx = buildCtx()
    const { base, close } = await withServer(ctx)
    try {
      const response = await fetch(`${base}/dsh-codex/side-chat/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentSessionId: parentId }),
      })
      const body = await response.json() as { context?: string }
      // With agents.get() deliberately unusable, an implementation that looked
      // the agent up in the registry would report 'none'. The handle is the
      // only path that works, so this also proves it is the path taken.
      expect(body.context).toBe('linked')
      expect(injected).toHaveLength(1)
      expect(JSON.stringify(injected[0])).toContain(parentId)
      expect(JSON.stringify(injected[0])).not.toContain('第一轮问题')
      expect(JSON.stringify(injected[0])).not.toContain('第一轮回答')
      expect(scopedTools.map(tool => tool.name)).toEqual(['side_chat_read_main_session'])
    } finally {
      await close()
    }
  })

  it('opens without reading parent history, then reads it on demand', async () => {
    const ctx = buildCtx()
    ctx.sessions.get = () => ({ id: parentId, header: parentSession.header })
    let finishRead!: (value: { events: readonly unknown[] }) => void
    const history = new Promise<{ events: readonly unknown[] }>(resolve => { finishRead = resolve })
    let markRead!: () => void
    const readStarted = new Promise<void>(resolve => { markRead = resolve })
    ctx.get = (name: string) => name === 'sessionQuery'
      ? {
          readSurface: (id: string) => {
            expect(id).toBe(parentId)
            markRead()
            return history
          },
        }
      : undefined
    const { base, close } = await withServer(ctx)
    try {
      const response = await fetch(`${base}/dsh-codex/side-chat/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentSessionId: parentId }),
      })
      expect(response.status).toBe(200)
      const body = await response.json() as { sideSessionId: string; context: string }
      expect(body.context).toBe('linked')
      expect(injected).toHaveLength(1)
      expect(JSON.stringify(injected[0])).not.toContain('第一轮问题')
      const read = scopedTools[0]!.execute({}, { agent: { session: { id: body.sideSessionId } } })
      await readStarted
      finishRead({ events: parentSession.events })
      expect((await read).text).toContain('第一轮回答')
      expect(created[0]?.seed).toBeUndefined()
      expect(childEvents).toEqual([])
    } finally {
      finishRead({ events: [] })
      await close()
    }
  })

  it('opens despite failed history reads and reports failure only when asked', async () => {
    const ctx = buildCtx()
    const warnings: string[] = []
    ctx.logger.warn = (message: string) => { warnings.push(message) }
    ctx.sessions.get = () => ({ id: parentId, header: parentSession.header })
    ctx.get = (name: string) => name === 'sessionQuery'
      ? { readSurface: async () => { throw new Error('history read failed') } }
      : undefined
    const { base, close } = await withServer(ctx)
    try {
      const response = await fetch(`${base}/dsh-codex/side-chat/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentSessionId: parentId }),
      })
      expect(response.status).toBe(200)
      const body = await response.json() as { sideSessionId: string; context: string }
      expect(body.context).toBe('linked')
      expect(injected).toHaveLength(1)
      expect(warnings).toHaveLength(0)
      const result = await scopedTools[0]!.execute({}, { agent: { session: { id: body.sideSessionId } } })
      expect(result.text).toContain('读取主会话失败')
      expect(warnings.join('\n')).toContain('history read failed')
    } finally {
      await close()
    }
  })

  it('links an empty parent without inventing conversation content', async () => {
    const ctx = buildCtx()
    ctx.sessions.get = () => ({ header: { cwd: '/work' }, events: [] })
    const { base, close } = await withServer(ctx)
    try {
      const response = await fetch(`${base}/dsh-codex/side-chat/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentSessionId: parentId }),
      })
      const body = await response.json() as { context?: string }
      expect(body.context).toBe('linked')
      expect(injected).toHaveLength(1)
      expect(JSON.stringify(injected[0])).not.toContain('问：')
    } finally {
      await close()
    }
  })

  it('lists side chats without crashing on a log-less child', async () => {
    const ctx = buildCtx()
    const { base, close } = await withServer(ctx)
    try {
      // Open, then list: the child has no materialized event log yet, which is
      // what used to throw in sideChatTitleOf and fail the whole route.
      const opened = await fetch(`${base}/dsh-codex/side-chat/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentSessionId: parentId }),
      })
      const { sideSessionId } = await opened.json() as { sideSessionId: string }
      const listed = await fetch(
        `${base}/dsh-codex/side-chat/list?parentSessionId=${encodeURIComponent(parentId)}`,
      )
      expect(listed.status).toBe(200)
      const rows = (await listed.json() as { sideChats: { sideSessionId: string }[] }).sideChats
      expect(rows.map(row => row.sideSessionId)).toContain(sideSessionId)
    } finally {
      await close()
    }
  })

  it('opens even when the parent cannot report a request header', async () => {
    // `requestHeader` is absent on some session shapes; calling it unguarded
    // threw "parent.requestHeader is not a function" and failed the fork.
    const ctx = buildCtx()
    ctx.sessions.get = () => ({
      header: { cwd: '/work' },
      events: [{ seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Q' }] } }],
    })
    const { base, close } = await withServer(ctx)
    try {
      const response = await fetch(`${base}/dsh-codex/side-chat/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentSessionId: parentId }),
      })
      expect(response.status).toBe(200)
    } finally {
      await close()
    }
  })
})
