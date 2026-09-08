import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { isAbsolute, join, normalize } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AssembleContext, Context } from '@just-genius/dsh-plugin-runtime/host'
import { HOST_SERVICES } from '@just-genius/dsh-plugin-runtime/host'

import { adoptFolder } from './scan.ts'
import {
  OPEN_PATH,
  PROJECT_PATH,
  SCAN_PATH,
  normalizePrimaryPath,
  roleOf,
  samePath,
  type HttpResult,
  type ProjectAction,
  type RepoFolder,
  type WorkspaceBinding,
} from './shared.ts'
import { bindBinding, deleteBinding, findBindingForCwd, listBindings, storeRoot } from './store.ts'

export const name = 'dsh-workspace-plus'
export const inject = [
  HOST_SERVICES.systemPrompt,
  HOST_SERVICES.webServer,
] as const

interface PromptAgent {
  session?: { header?: { cwd?: string } }
}

/** The `webRuntime` bind-trust face the web app provides after bind. */
interface WebRuntime {
  trustedHosts: readonly string[]
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
  ctx.systemPrompt.section({
    name: 'workspace-plus:workspace',
    order: 41,
    text: (context) => renderPrompt(bindingFor(context)),
  })

  ctx.effect(() => acquireRoutes(ctx), 'dsh-workspace-plus: host routes')
}

function bindingFor(context: AssembleContext): WorkspaceBinding | null {
  const agent = (context as AssembleContext & { agent?: PromptAgent }).agent
  const cwd = agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd.trim() === '') return null
  const binding = findBindingForCwd(cwd)
  if (binding === null || binding.repos.length < 2) return null
  return binding
}

function renderPrompt(binding: WorkspaceBinding | null): string {
  if (binding === null) return ''
  const primaryPath = normalizePrimaryPath(binding.repos, binding.primaryPath)
  const primary = binding.repos.find((repo) => samePath(repo.path, primaryPath))
  const secondaries = binding.repos.filter((repo) => roleOf(repo.path, primaryPath) === 'secondary')
  const lines: string[] = [
    '## Multi-folder workspace',
    '',
    'This session is one workspace made of multiple folders the user added. They are all in-scope work.',
    `Session working directory and workspace-write follow the primary only: \`${primaryPath}\`.`,
    'Other listed folders are readable and in-scope. Writes there are outside workspace-write: call the tool normally, then follow its denial and request a one-shot escalation so the user can approve.',
    '',
  ]
  if (primary !== undefined) {
    lines.push(`Primary (official workspace / writable range): \`${primary.name}\` — \`${primary.path}\``)
  } else {
    lines.push(`Primary (official workspace / writable range): \`${primaryPath}\``)
  }
  if (secondaries.length > 0) {
    lines.push('', 'Also in this workspace (escalate writes):')
    for (const repo of secondaries) {
      lines.push(`- \`${repo.name}\` — \`${repo.path}\``)
    }
  }
  lines.push(
    '',
    'Prefer the primary unless the task is clearly in another listed folder.',
    'Do not assume a single-package layout.',
  )
  return lines.join('\n')
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
      handler: (req, res) => { void handleAdopt(req, res) },
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

async function handleAdopt(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    json(res, 500, { ok: false, message: errorMessage(error) })
  }
}

async function handleBinding(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isTrustedApiRequest(ctx, req)) {
    json(res, 403, { ok: false, message: 'forbidden' })
    return
  }
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
      repos: action.repos,
      title: action.title,
      primaryPath: action.primaryPath,
    })
    json(res, 200, { ok: true, value: binding })
  } catch (error) {
    json(res, 500, { ok: false, message: errorMessage(error) })
  }
}

async function handleOpen(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isTrustedApiRequest(ctx, req)) {
    json(res, 403, { ok: false, message: 'forbidden' })
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
  const raw = readString(body, 'path')
  if (raw === undefined || !isAbsolute(raw) || raw.includes('\0')) {
    json(res, 400, { ok: false, message: 'invalid absolute path' })
    return
  }
  try {
    await openInOs(normalize(raw))
    json(res, 200, { ok: true, value: { opened: true } })
  } catch (error) {
    json(res, 400, { ok: false, message: errorMessage(error) })
  }
}

function parseBindingAction(body: unknown): ProjectAction | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const value = body as Record<string, unknown>
  if (value.action === 'delete') {
    if (typeof value.root !== 'string') return undefined
    return { action: 'delete', root: value.root }
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

// ── OS file manager ────────────────────────────────────────────────────────

function isDirectoryPath(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function spawnOpener(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.on('spawn', () => {
      if (settled) return
      settled = true
      child.unref()
      resolve()
    })
    child.on('exit', (code) => {
      if (settled) return
      settled = true
      if (code === 0 || code === null) resolve()
      else reject(new Error(`opener exited with code ${code}`))
    })
  })
}

/** Reveal `path` in the platform file manager. */
async function openInOs(path: string): Promise<void> {
  if (process.platform === 'win32') {
    const explorer = process.env.SystemRoot
      ? join(process.env.SystemRoot, 'explorer.exe')
      : 'explorer.exe'
    const args = isDirectoryPath(path) ? [path] : [`/select,${path}`]
    await spawnOpener(explorer, args)
    return
  }
  if (process.platform === 'darwin') {
    await spawnOpener('open', [path])
    return
  }
  // Linux: prefer xdg-open, then the common desktop file managers.
  const candidates: Array<{ cmd: string; args: string[] }> = [
    { cmd: 'xdg-open', args: [path] },
    { cmd: 'gio', args: ['open', path] },
    { cmd: 'nautilus', args: [path] },
    { cmd: 'dolphin', args: [path] },
    { cmd: 'thunar', args: [path] },
    { cmd: 'pcmanfm', args: [path] },
  ]
  let lastError: unknown
  for (const candidate of candidates) {
    try {
      await spawnOpener(candidate.cmd, candidate.args)
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('no file manager available')
}

// ── Trust fence (mirrors the official DSH API route check) ─────────────────

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return typeof value === 'string' ? value : undefined
}

function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function canonicalAuthority(entry: string, entryUrl: URL): string {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/**
 * Read the web app's bind-trust values without declaring `webRuntime`.
 *
 * That service is provided by the web app once the server binds, and an
 * unknown inject name parks the plugin forever, so it is read defensively:
 * when it is absent the fence falls back to the loopback check, which is what
 * the GUI always arrives on anyway.
 */
function trustedHostsOf(ctx: Context): readonly string[] {
  try {
    const runtime = (ctx as Context & { webRuntime?: WebRuntime }).webRuntime
    return runtime?.trustedHosts ?? []
  } catch {
    return []
  }
}

function isTrustedApiRequest(ctx: Context, req: IncomingMessage): boolean {
  const trustedHosts = trustedHostsOf(ctx)
  const host = header(req, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (header(req, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(req, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}
