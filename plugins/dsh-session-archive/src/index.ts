import { rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import type { Context, SessionEvent, SessionHeader } from '@just-genius/dsh-plugin-runtime/host'
import { HOST_SERVICES, SessionId } from '@just-genius/dsh-plugin-runtime/host'

import {
  DELETE_PATH,
  LIST_PATH,
  type ArchiveHttpResult,
  type ArchiveListPayload,
  type ArchivedSessionRow,
} from './shared'

export const name = 'dsh-session-archive'
export const inject = [HOST_SERVICES.webServer, HOST_SERVICES.workspaceRegistry, HOST_SERVICES.sessionPersistence] as const

interface WorkspaceDomainState {
  initialized: boolean
  workspaceIds: readonly string[]
  archivedSessionIds: readonly string[]
  pendingMutation?: unknown
}

interface RegistryMutator {
  enqueueOperation: <T>(operation: () => Promise<T>) => Promise<T>
  requireState: () => WorkspaceDomainState
  setState: (state: WorkspaceDomainState) => Promise<void>
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: LIST_PATH,
    handler: (req, res) => void handleList(ctx, req, res),
  }), 'dsh-session-archive: list')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: DELETE_PATH,
    handler: (req, res) => void handleDelete(ctx, req, res),
  }), 'dsh-session-archive: delete')
}

async function handleList(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    json(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  try {
    json(res, 200, { ok: true, value: await listArchived(ctx) })
  } catch (error) {
    json(res, 500, { ok: false, message: errorMessage(error) })
  }
}

async function handleDelete(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    json(res, 400, { ok: false, message: errorMessage(error) })
    return
  }
  const sessionId = typeof (body as { sessionId?: unknown })?.sessionId === 'string'
    ? (body as { sessionId: string }).sessionId.trim()
    : ''
  if (sessionId === '') {
    json(res, 400, { ok: false, message: 'sessionId is required' })
    return
  }
  try {
    await deleteArchived(ctx, sessionId)
    json(res, 200, { ok: true, value: { deleted: true, sessionId } })
  } catch (error) {
    json(res, 500, { ok: false, message: errorMessage(error) })
  }
}

async function listArchived(ctx: Context): Promise<ArchiveListPayload> {
  const archived = [...ctx.workspaceRegistry.archivedSessionIds]
  const headers = await ctx.sessionPersistence.list()
  const headerById = new Map(headers.map((header) => [String(header.id), header]))
  const workspaces = ctx.workspaceRegistry.list()
  const rows: ArchivedSessionRow[] = []

  for (const id of archived) {
    const header = headerById.get(String(id))
    const live = liveSession(ctx, SessionId(String(id)))
    let title = String(id)
    let updatedAt: number | null = header?.createdAt ?? null
    if (live !== undefined) {
      const derived = titleFromEvents(live.events as SessionEvent[], title)
      title = derived.title
      updatedAt = derived.updatedAt ?? updatedAt
    } else if (header !== undefined) {
      try {
        const inspection = await ctx.sessionPersistence.inspect(header.id)
        const derived = titleFromEvents(inspection.events as SessionEvent[], title)
        title = derived.title
        updatedAt = derived.updatedAt ?? inspection.meta.createdAt
      } catch {
        title = String(id)
      }
    }

    const workspace = workspaces.find((item) => item.sessionIds.some((sessionId) => String(sessionId) === String(id)))
      ?? workspaces.find((item) => header?.cwd !== undefined && pathsMatch(item.path, header.cwd))

    rows.push({
      id: String(id),
      title,
      updatedAt,
      workspaceId: workspace === undefined ? null : String(workspace.id),
      workspaceTitle: workspace?.title ?? '未分组',
      workspacePath: workspace?.path ?? header?.cwd ?? null,
    })
  }

  return { sessions: rows }
}

async function deleteArchived(ctx: Context, rawId: string): Promise<void> {
  const sessionId = SessionId(rawId)
  const archived = ctx.workspaceRegistry.archivedSessionIds.map(String)
  if (!archived.includes(rawId)) {
    throw new Error(`session "${rawId}" is not archived`)
  }

  const agents = (ctx as unknown as { get(name: string): AgentRegistryLike | undefined }).get('agents')
  const agent = agents?.get(sessionId)
  if (agent !== undefined) {
    try {
      agent.cancel({ kind: 'user' })
    } catch {
      // already idle / disposed
    }
    disposeContext(agent.ctx)
  }

  for (const workspace of ctx.workspaceRegistry.list()) {
    if (workspace.sessionIds.some((id) => String(id) === rawId)) {
      await workspace.detachSession(sessionId)
    }
  }

  await removeFromArchiveSet(ctx, rawId)

  const header = await readHeader(ctx, sessionId)
  if (header !== undefined) {
    const location = ctx.sessionPersistence.locate(header)
    if (location?.path !== undefined) {
      await rm(dirname(location.path), { recursive: true, force: true })
    }
  }
}

async function removeFromArchiveSet(ctx: Context, sessionId: string): Promise<void> {
  const registry = ctx.workspaceRegistry as unknown as RegistryMutator
  await registry.enqueueOperation(async () => {
    const state = registry.requireState()
    if (!state.archivedSessionIds.map(String).includes(sessionId)) return
    await registry.setState({
      ...state,
      archivedSessionIds: state.archivedSessionIds.filter((id) => String(id) !== sessionId),
    })
  })
}

interface AgentRegistryLike {
  get(id: SessionId): { cancel(cause: { kind: 'user' }): void; ctx: Context } | undefined
}

async function readHeader(ctx: Context, sessionId: SessionId): Promise<SessionHeader | undefined> {
  const live = liveSession(ctx, sessionId)
  if (live !== undefined) return live.header
  const headers = await ctx.sessionPersistence.list()
  return headers.find((header) => String(header.id) === String(sessionId))
}

function liveSession(ctx: Context, sessionId: SessionId): { events: readonly SessionEvent[]; header: SessionHeader } | undefined {
  return ctx.get('sessions')?.get(sessionId)
}

function titleFromEvents(events: readonly SessionEvent[], fallback: string): { title: string; updatedAt: number | null } {
  let title = fallback
  let updatedAt: number | null = null
  for (const event of events) {
    updatedAt = event.time
    const named = eventTitle(event)
    if (named !== null) title = named
  }
  if (title === fallback) {
    for (const event of events) {
      const preview = userPreview(event)
      if (preview !== null) {
        title = preview
        break
      }
    }
  }
  return { title, updatedAt }
}

function eventTitle(event: SessionEvent): string | null {
  const type = String(event.type)
  if (!type.includes('title')) return null
  const data = event.data
  if (data === null || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  const title = record.title ?? record.value
  if (typeof title !== 'string') return null
  const trimmed = title.trim()
  return trimmed === '' ? null : trimmed
}

function userPreview(event: SessionEvent): string | null {
  const type = String(event.type)
  if (!type.includes('user')) return null
  const data = event.data
  if (data === null || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  const content = record.content
  if (typeof content === 'string') {
    const trimmed = content.replace(/\s+/g, ' ').trim()
    return trimmed === '' ? null : clip(trimmed)
  }
  if (!Array.isArray(content)) return null
  const text = content
    .filter((part) => part !== null && typeof part === 'object' && (part as { type?: unknown }).type === 'text')
    .map((part) => String((part as { text?: unknown }).text ?? ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text === '' ? null : clip(text)
}

function clip(text: string, max = 80): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function pathsMatch(left: string, right: string): boolean {
  const a = left.replace(/\/+$/, '')
  const b = right.replace(/\/+$/, '')
  return a === b
}

function disposeContext(target: Context | undefined): void {
  if (target === undefined) return
  const scope = (target as { scope?: { dispose?: () => void } }).scope
  try {
    scope?.dispose?.()
  } catch {
    // already tearing down
  }
}

function json(res: ServerResponse, status: number, value: ArchiveHttpResult<unknown> | { ok: false; message: string }): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function readJsonBody(req: IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}
