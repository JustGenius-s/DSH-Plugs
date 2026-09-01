import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AssembleContext, Context } from '@just-genius/dsh-plugin-runtime/host'
import { HOST_SERVICES } from '@just-genius/dsh-plugin-runtime/host'

import { adoptFolder } from './scan'
import {
  PROJECT_PATH,
  SCAN_PATH,
  normalizePrimaryPath,
  roleOf,
  samePath,
  type HttpResult,
  type MultiRepoProject,
  type ProjectAction,
  type RepoFolder,
} from './shared'
import { bindProject, deleteProject, findProjectForCwd, listProjects, storeRoot } from './store'

export const name = 'dsh-multi-repo'
export const inject = [HOST_SERVICES.systemPrompt, HOST_SERVICES.webServer] as const

interface PromptAgent {
  session?: { header?: { cwd?: string } }
}

export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'multi-repo:workspace',
    order: 41,
    text: (context) => renderPrompt(projectFor(context)),
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SCAN_PATH,
    handler: (req, res) => { void handleAdopt(req, res) },
  }), 'dsh-multi-repo: adopt route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PROJECT_PATH,
    handler: (req, res) => { void handleProject(req, res) },
  }), 'dsh-multi-repo: project route')
}

function projectFor(context: AssembleContext): MultiRepoProject | null {
  const agent = (context as AssembleContext & { agent?: PromptAgent }).agent
  const cwd = agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd.trim() === '') return null
  const project = findProjectForCwd(cwd)
  if (project === null || project.repos.length < 2) return null
  return project
}

function renderPrompt(project: MultiRepoProject | null): string {
  if (project === null) return ''
  const primaryPath = normalizePrimaryPath(project.repos, project.primaryPath)
  const primary = project.repos.find((repo) => samePath(repo.path, primaryPath))
  const secondaries = project.repos.filter((repo) => roleOf(repo.path, primaryPath) === 'secondary')
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

async function handleProject(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'GET') {
    json(res, 200, {
      ok: true,
      value: { root: storeRoot(), projects: listProjects() },
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
  const action = parseProjectAction(body)
  if (action === undefined) {
    json(res, 400, { ok: false, message: 'invalid project action' })
    return
  }
  try {
    if (action.action === 'delete') {
      if (!deleteProject(action.root)) {
        json(res, 404, { ok: false, message: 'project not found' })
        return
      }
      json(res, 200, { ok: true, value: { deleted: true, root: action.root } })
      return
    }
    const project = bindProject({
      root: action.root,
      repos: action.repos,
      title: action.title,
      primaryPath: action.primaryPath,
    })
    json(res, 200, { ok: true, value: project })
  } catch (error) {
    json(res, 500, { ok: false, message: errorMessage(error) })
  }
}

function parseProjectAction(body: unknown): ProjectAction | undefined {
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
