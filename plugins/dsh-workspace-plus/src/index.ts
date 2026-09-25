import { isAbsolute, normalize } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AssembleContext, Context } from '@just-genius/dsh-plugin-runtime/host'
import { HOST_SERVICES } from '@just-genius/dsh-plugin-runtime/host'

import { adoptFolder, InvalidFolderError } from './scan.ts'
import {
  OPEN_PATH,
  PINS_PATH,
  PROJECT_PATH,
  SCAN_PATH,
  SESSION_EXPORT_PATH,
  type HttpResult,
  type ProjectAction,
  type RepoFolder,
} from './shared.ts'
import { bindBinding, deleteBinding, findBindingForCwd, listBindings, pruneBindings, storeRoot } from './store.ts'
import { requestRejection, type RequestAuthFace } from './request-auth.ts'
import { renderWorkspaceContext, type WorkspacePromptInput } from './workspace-prompt.ts'
import { openInOs } from './open-path.ts'
import { parsePinAction } from './pin-state.ts'
import { changeStoredPins, readStoredPins } from './pin-store.ts'
import { readSessionExportSource, SessionExportSourceError } from './session-export-source.ts'
import { exportSessionMarkdown } from './session-export.ts'

export const name = 'dsh-workspace-plus'
export const inject = [
  HOST_SERVICES.connection,
  HOST_SERVICES.sessions,
  HOST_SERVICES.sessionPersistence,
  HOST_SERVICES.systemPrompt,
  HOST_SERVICES.webServer,
] as const

interface PromptAgent {
  session?: { header?: { cwd?: string } }
}

interface RouteLease {
  references: number
  dispose: () => void
}

// A hot reload can apply the same linked bundle more than once. Newer
// DSH WebServer versions reject duplicate exact routes, so route ownership is
// shared by every plugin instance bound to the same server.
const routeLeases = new WeakMap<object, RouteLease>()

export function apply(ctx: Context): void {
  ctx.systemPrompt.variable('workspace_plus_context', (context) => {
    return renderWorkspaceContext(bindingFor(context))
  })
  ctx.systemPrompt.context({
    name: 'workspace-plus:workspace',
    order: 41,
    text: '{{workspace_plus_context}}',
  })

  ctx.effect(() => acquireRoutes(ctx), 'dsh-workspace-plus: host routes')
}

function bindingFor(context: AssembleContext): WorkspacePromptInput | null {
  const agent = (context as AssembleContext & { agent?: PromptAgent }).agent
  const cwd = agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd.trim() === '') return null
  const binding = findBindingForCwd(cwd)
  if (binding === null || binding.repos.length < 2) return null
  return { binding, cwd }
}

/** Register every host route once per server, shared across duplicate applies. */
function acquireRoutes(ctx: Context): () => void {
  const server = ctx.webServer as unknown as object
  const existing = routeLeases.get(server)
  if (existing !== undefined) {
    existing.references += 1
    return () => releaseRoutes(server, existing)
  }

  const disposers = [
    ctx.webServer.register({
      kind: 'exact',
      path: SCAN_PATH,
      handler: (req, res) => { void handleAdopt(ctx, req, res) },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: PROJECT_PATH,
      handler: (req, res) => { void handleBinding(ctx, req, res) },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: OPEN_PATH,
      handler: (req, res) => { void handleOpen(ctx, req, res) },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: PINS_PATH,
      handler: (req, res) => { void handlePins(ctx, req, res) },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: SESSION_EXPORT_PATH,
      handler: (req, res) => { void handleSessionExport(ctx, req, res) },
    }),
  ]
  const lease: RouteLease = {
    references: 1,
    dispose: () => {
      for (const dispose of disposers) dispose()
    },
  }
  routeLeases.set(server, lease)
  return () => releaseRoutes(server, lease)
}

function releaseRoutes(server: object, lease: RouteLease): void {
  lease.references -= 1
  if (lease.references !== 0 || routeLeases.get(server) !== lease) return
  routeLeases.delete(server)
  lease.dispose()
}

async function handlePins(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authorizeRequest(ctx, req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') {
    json(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  let action
  if (req.method === 'POST') {
    try {
      action = parsePinAction(await readJsonBody(req))
    } catch (error) {
      json(res, 400, { ok: false, message: errorMessage(error) })
      return
    }
    if (action === undefined) {
      json(res, 400, { ok: false, message: 'invalid pin action' })
      return
    }
  }
  try {
    json(res, 200, { ok: true, value: action === undefined ? readStoredPins() : changeStoredPins(action) })
  } catch (error) {
    json(res, 500, { ok: false, message: errorMessage(error) })
  }
}

async function handleAdopt(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authorizeRequest(ctx, req, res)) return
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
  const path = readString(body, 'path')
  if (path === undefined) {
    json(res, 400, { ok: false, message: 'path is required' })
    return
  }
  try {
    json(res, 200, { ok: true, value: adoptFolder(path) })
  } catch (error) {
    json(res, error instanceof InvalidFolderError ? 400 : 500, { ok: false, message: errorMessage(error) })
  }
}

async function handleBinding(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authorizeRequest(ctx, req, res)) return
  if (req.method === 'GET') {
    json(res, 200, {
      ok: true,
      value: { root: storeRoot(), bindings: listBindings() },
    })
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
  const action = parseBindingAction(body)
  if (action === undefined) {
    json(res, 400, { ok: false, message: 'invalid binding action' })
    return
  }
  try {
    if (action.action === 'prune') {
      json(res, 200, { ok: true, value: { removed: pruneBindings(action.livePaths).map((b) => b.root) } })
      return
    }
    if (action.action === 'delete') {
      if (!deleteBinding(action.root)) {
        json(res, 404, { ok: false, message: 'binding not found' })
        return
      }
      json(res, 200, { ok: true, value: { deleted: true, root: action.root } })
      return
    }
    const binding = bindBinding({
      root: action.root,
      previousRoot: action.previousRoot,
      repos: action.repos,
      title: action.title,
      primaryPath: action.primaryPath,
    })
    json(res, 200, { ok: true, value: binding })
  } catch (error) {
    json(res, error instanceof InvalidFolderError ? 400 : 500, { ok: false, message: errorMessage(error) })
  }
}

async function handleOpen(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authorizeRequest(ctx, req, res)) return
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
  const raw = readString(body, 'path')
  if (raw === undefined || !isAbsolute(raw) || raw.includes('\0')) {
    json(res, 400, { ok: false, message: 'invalid absolute path' })
    return
  }
  try {
    const path = normalize(raw)
    await openInOs(path)
    json(res, 200, { ok: true, value: { opened: true } })
  } catch (error) {
    json(res, 400, { ok: false, message: errorMessage(error) })
  }
}

async function handleSessionExport(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authorizeRequest(ctx, req, res)) return
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
  const sessionId = readString(body, 'sessionId')
  if (sessionId === undefined || sessionId.length > 256 || sessionId !== sessionId.trim()
    || sessionId === '.' || sessionId === '..' || /[/\\\u0000-\u001f\u007f]/.test(sessionId)) {
    json(res, 400, { ok: false, message: 'invalid session id' })
    return
  }
  try {
    const source = await readSessionExportSource(ctx, sessionId)
    json(res, 200, { ok: true, value: exportSessionMarkdown(source) })
  } catch (error) {
    json(res, error instanceof SessionExportSourceError ? error.status : 500, { ok: false, message: errorMessage(error) })
  }
}

function parseBindingAction(body: unknown): ProjectAction | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const value = body as Record<string, unknown>
  if (value.action === 'delete') {
    if (typeof value.root !== 'string') return undefined
    return { action: 'delete', root: value.root }
  }
  if (value.action === 'prune') {
    if (!Array.isArray(value.livePaths)) return undefined
    return { action: 'prune', livePaths: value.livePaths.filter((p): p is string => typeof p === 'string') }
  }
  if (value.action === 'bind') {
    if (typeof value.root !== 'string' || !Array.isArray(value.repos)) return undefined
    const repos: RepoFolder[] = []
    for (const item of value.repos) {
      if (item === null || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      if (typeof row.name !== 'string' || typeof row.path !== 'string') continue
      repos.push({
        name: row.name,
        path: row.path,
        kind: 'folder',
        external: row.external === true ? true : undefined,
      })
    }
    if (repos.length === 0) return undefined
    return {
      action: 'bind',
      root: value.root,
      repos,
      title: typeof value.title === 'string' ? value.title : undefined,
      primaryPath: typeof value.primaryPath === 'string' ? value.primaryPath : undefined,
      previousRoot: typeof value.previousRoot === 'string' ? value.previousRoot : undefined,
    }
  }
  return undefined
}

function readString(body: unknown, key: string): string | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const value = (body as Record<string, unknown>)[key]
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return value
}

function json(res: ServerResponse, status: number, value: HttpResult<unknown> | { ok: false; message: string }): void {
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

// ── Browser authentication ────────────────────────────────────────────────

function authorizeRequest(ctx: Context, req: IncomingMessage, res: ServerResponse): boolean {
  const connection = (ctx as unknown as { connection?: RequestAuthFace }).connection
  const status = requestRejection(connection, req)
  if (status === undefined) return true
  json(res, status, { ok: false, message: status === 401 ? 'unauthorized' : 'forbidden' })
  return false
}
