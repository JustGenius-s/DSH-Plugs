import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  createEntry,
  deleteEntry,
  getEntry,
  listEntries,
  memoryRoot,
  updateEntry,
} from './memory-store.ts'
import { MEMORY_POLICY } from './policy.ts'
import {
  ENTRY_PATH,
  LIST_PATH,
  MAX_PROMPT_CHARS,
  MAX_PROMPT_ENTRIES,
  MEMORY_PROPOSE,
  PENDING_PATH,
  PROPOSE_PATH,
  mintMemoryId,
  type MemoryEntryAction,
  type MemoryHttpResult,
  type MemoryPending,
  type MemoryProposeAction,
  type MemoryProposePost,
} from './shared.ts'

export const name = 'dsh-memory'
export const inject = ['tools', 'systemPrompt', 'webServer'] as const

interface LivePropose {
  id: string
  sessionId: string
  title: string
  content: string
  resolve: (value: ProposeResult) => void
  reject: (error: Error) => void
}

interface ProposeResult {
  status: 'accepted' | 'rejected'
  id?: string
  title?: string
  message: string
}

const PROPOSE_DESCRIPTION = 'Propose a durable global memory entry. The tool waits until the user accepts, edits, or rejects it in the UI. '
  + 'Use for preferences and stable facts that should help future sessions. Never store secrets.'

export function apply(ctx: Context): void {
  const proposes = new Map<string, LivePropose>()
  let disposed = false

  ctx.effect(() => () => {
    disposed = true
    for (const [sessionId, live] of proposes) {
      proposes.delete(sessionId)
      live.reject(new Error('memory plugin was reloaded while waiting for confirmation'))
    }
  }, 'dsh-memory: close lifetime')

  ctx.systemPrompt.section({
    name: 'memory:policy',
    order: 39,
    text: MEMORY_POLICY,
  })

  ctx.systemPrompt.section({
    name: 'memory:global',
    order: 40,
    text: () => renderPromptMemories(),
  })

  ctx.tools.register(defineTool({
    name: MEMORY_PROPOSE,
    description: PROPOSE_DESCRIPTION,
    parameters: {
      title: {
        type: 'string',
        required: true,
        description: 'Short memory title (one line).',
      },
      content: {
        type: 'string',
        required: true,
        description: 'Memory body as markdown. Keep it self-contained and concise.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true },
          id: { type: 'string' },
          title: { type: 'string' },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderProposeResult(value as ProposeResult) }],
    },
    execute: async (args, exec) => {
      const agent = exec.agent
      if (agent === undefined) throw new Error(`${MEMORY_PROPOSE} requires a calling agent`)
      const title = String(args.title ?? '').trim()
      const content = String(args.content ?? '').trim()
      if (title === '' || content === '') {
        throw new Error(`${MEMORY_PROPOSE} requires non-empty title and content`)
      }
      if (disposed) throw new Error('memory plugin was reloaded; propose again')

      const sessionId = String(agent.session.id)
      cancelPropose(proposes, sessionId, new Error('A newer memory proposal replaced this one.'))
      const id = mintMemoryId('propose')

      return await new Promise<ProposeResult>((resolve, reject) => {
        const live: LivePropose = {
          id,
          sessionId,
          title,
          content,
          resolve: (value) => {
            proposes.delete(sessionId)
            resolve(value)
          },
          reject: (error) => {
            proposes.delete(sessionId)
            reject(error)
          },
        }
        proposes.set(sessionId, live)
        const onAbort = () => {
          if (proposes.get(sessionId) !== live) return
          live.reject(new Error('The memory proposal wait was cancelled.'))
        }
        if (exec.signal.aborted) {
          onAbort()
          return
        }
        exec.signal.addEventListener('abort', onAbort, { once: true })
      })
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `Memory: ${String(args.title ?? '').trim() || 'Untitled'}`,
      kind: 'other',
      content: [{ type: 'text', text: String(args.content ?? '') }],
    }),
    presentResult: (_args, result) => ({
      card: 'generic',
      title: 'Memory',
      content: result.content,
    }),
    isConcurrencySafe: () => false,
  }))

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: LIST_PATH,
    handler: (req, res) => handleList(req, res),
  }), 'dsh-memory: list route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ENTRY_PATH,
    handler: (req, res) => handleEntry(req, res),
  }), 'dsh-memory: entry route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PENDING_PATH,
    handler: (req, res) => handlePending(proposes, req, res),
  }), 'dsh-memory: pending route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PROPOSE_PATH,
    handler: (req, res) => handlePropose(proposes, req, res),
  }), 'dsh-memory: propose route')
}

function renderPromptMemories(): string {
  const enabled = listEntries().filter((entry) => entry.enabled).slice(0, MAX_PROMPT_ENTRIES)
  if (enabled.length === 0) return ''

  const parts: string[] = ['## Global memory', '']
  let used = parts.join('\n').length

  for (const entry of enabled) {
    const block = `### ${entry.title}\n${entry.content.trim()}\n`
    if (used + block.length > MAX_PROMPT_CHARS) {
      parts.push('_Additional enabled memories were omitted to stay within the prompt budget._')
      break
    }
    parts.push(block.trimEnd(), '')
    used += block.length
  }

  return parts.join('\n').trim()
}

function renderProposeResult(value: ProposeResult): string {
  if (value.status === 'accepted') {
    return `status: accepted\nid: ${value.id ?? ''}\ntitle: ${value.title ?? ''}\nmessage: ${value.message}`
  }
  return `status: rejected\nmessage: ${value.message}`
}

function cancelPropose(proposes: Map<string, LivePropose>, sessionId: string, error: Error): void {
  const live = proposes.get(sessionId)
  if (live === undefined) return
  live.reject(error)
}

function pendingView(live: LivePropose | undefined): MemoryPending | null {
  if (live === undefined) return null
  return {
    id: live.id,
    sessionId: live.sessionId,
    title: live.title,
    content: live.content,
    waiting: true,
  }
}

function handleList(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET') {
    json(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  json(res, 200, {
    ok: true,
    value: {
      root: memoryRoot(),
      entries: listEntries(),
    },
  })
}

async function handleEntry(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'GET') {
    const url = new URL(req.url ?? '', 'http://dsh.local')
    const id = url.searchParams.get('id')?.trim() ?? ''
    if (id === '') {
      json(res, 400, { ok: false, message: 'id is required' })
      return
    }
    const entry = getEntry(id)
    if (entry === null) {
      json(res, 404, { ok: false, message: 'memory not found' })
      return
    }
    json(res, 200, { ok: true, value: entry })
    return
  }

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

  const action = parseEntryAction(body)
  if (action === undefined) {
    json(res, 400, { ok: false, message: 'invalid entry action' })
    return
  }

  try {
    switch (action.action) {
      case 'create': {
        const entry = createEntry({
          title: action.title,
          content: action.content,
          source: 'manual',
          enabled: action.enabled,
        })
        json(res, 200, { ok: true, value: entry })
        return
      }
      case 'update': {
        const entry = updateEntry(action.id, {
          title: action.title,
          content: action.content,
          enabled: action.enabled,
        })
        if (entry === null) {
          json(res, 404, { ok: false, message: 'memory not found' })
          return
        }
        json(res, 200, { ok: true, value: entry })
        return
      }
      case 'toggle': {
        const entry = updateEntry(action.id, { enabled: action.enabled })
        if (entry === null) {
          json(res, 404, { ok: false, message: 'memory not found' })
          return
        }
        json(res, 200, { ok: true, value: entry })
        return
      }
      case 'delete': {
        if (!deleteEntry(action.id)) {
          json(res, 404, { ok: false, message: 'memory not found' })
          return
        }
        json(res, 200, { ok: true, value: { deleted: true, id: action.id } })
        return
      }
    }
  } catch (error) {
    json(res, 500, { ok: false, message: errorMessage(error) })
  }
}

function handlePending(
  proposes: Map<string, LivePropose>,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (req.method !== 'GET') {
    json(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  const url = new URL(req.url ?? '', 'http://dsh.local')
  const sessionId = url.searchParams.get('sessionId')?.trim() ?? ''
  if (sessionId === '') {
    json(res, 400, { ok: false, message: 'sessionId is required' })
    return
  }
  json(res, 200, { ok: true, value: pendingView(proposes.get(sessionId)) })
}

async function handlePropose(
  proposes: Map<string, LivePropose>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
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
  if (body === null || typeof body !== 'object') {
    json(res, 400, { ok: false, message: 'invalid body' })
    return
  }

  const value = body as MemoryProposePost
  const sessionId = typeof value.sessionId === 'string' ? value.sessionId : ''
  const action = parseProposeAction(value.action)
  if (sessionId === '' || action === undefined) {
    json(res, 400, { ok: false, message: 'sessionId and accept/reject action are required' })
    return
  }

  const live = proposes.get(sessionId)
  if (live === undefined) {
    json(res, 409, { ok: false, message: 'no live memory proposal' })
    return
  }

  if (action === 'reject') {
    const result: ProposeResult = {
      status: 'rejected',
      message: 'The user rejected this memory proposal.',
    }
    live.resolve(result)
    json(res, 200, { ok: true, value: result })
    return
  }

  const title = (typeof value.title === 'string' ? value.title : live.title).trim() || live.title
  const content = (typeof value.content === 'string' ? value.content : live.content).trim() || live.content
  try {
    const entry = createEntry({ title, content, source: 'ai', enabled: true })
    const result: ProposeResult = {
      status: 'accepted',
      id: entry.id,
      title: entry.title,
      message: 'Memory saved and enabled for future sessions.',
    }
    live.resolve(result)
    json(res, 200, { ok: true, value: result })
  } catch (error) {
    json(res, 500, { ok: false, message: errorMessage(error) })
  }
}

function parseProposeAction(value: unknown): MemoryProposeAction | undefined {
  if (value === 'accept' || value === 'reject') return value
  return undefined
}

function parseEntryAction(body: unknown): MemoryEntryAction | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const value = body as Record<string, unknown>
  const action = value.action
  if (action === 'create') {
    if (typeof value.title !== 'string' || typeof value.content !== 'string') return undefined
    return {
      action: 'create',
      title: value.title,
      content: value.content,
      enabled: typeof value.enabled === 'boolean' ? value.enabled : undefined,
    }
  }
  if (action === 'update') {
    if (typeof value.id !== 'string') return undefined
    return {
      action: 'update',
      id: value.id,
      title: typeof value.title === 'string' ? value.title : undefined,
      content: typeof value.content === 'string' ? value.content : undefined,
      enabled: typeof value.enabled === 'boolean' ? value.enabled : undefined,
    }
  }
  if (action === 'delete') {
    if (typeof value.id !== 'string') return undefined
    return { action: 'delete', id: value.id }
  }
  if (action === 'toggle') {
    if (typeof value.id !== 'string' || typeof value.enabled !== 'boolean') return undefined
    return { action: 'toggle', id: value.id, enabled: value.enabled }
  }
  return undefined
}

function json(res: ServerResponse, status: number, value: MemoryHttpResult<unknown> | { ok: false; message: string }): void {
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

function readJsonBody(req: IncomingMessage, limit = 256 * 1024): Promise<unknown> {
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
