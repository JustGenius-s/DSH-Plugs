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
 * 2. The parent's digest is injected on the handle `agents.create` resolved to
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
    } finally {
      await close()
    }
  })

  it('injects the parent digest on the handle create resolved to', async () => {
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
      expect(body.context).toBe('inherited')
      expect(injected).toHaveLength(1)
    } finally {
      await close()
    }
  })

  it('reports no digest for a parent with no completed turns', async () => {
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
      expect(body.context).toBe('none')
      expect(injected).toHaveLength(0)
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
