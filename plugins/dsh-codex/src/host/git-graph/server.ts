import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  DEFAULT_GRAPH_LIMIT,
  GIT_GRAPH_ACTION_PATH,
  GIT_GRAPH_COMMIT_PATH,
  GIT_GRAPH_PATH,
  type GitGraphActionName,
  type GitGraphActionRequest,
  type GitGraphActionResponse,
  type GitGraphCommitResponse,
  type GitGraphErr,
  type GitGraphResponse,
  type GitResetMode,
} from '../../shared/git-graph'
import { runGraphAction } from './actions'
import { clampLimit, clampSkip, loadCommitBody, loadGraphLog } from './log'

export interface DshCodexGitGraphServer {
  dispose(): void
}

export function createDshCodexGitGraphServer(ctx: Context): DshCodexGitGraphServer {
  const disposeGraph = ctx.webServer.register({
    kind: 'exact',
    path: GIT_GRAPH_PATH,
    handler: handleGraph,
  })
  const disposeCommit = ctx.webServer.register({
    kind: 'exact',
    path: GIT_GRAPH_COMMIT_PATH,
    handler: handleCommit,
  })
  const disposeAction = ctx.webServer.register({
    kind: 'exact',
    path: GIT_GRAPH_ACTION_PATH,
    handler: handleAction,
  })
  return {
    dispose() {
      disposeGraph()
      disposeCommit()
      disposeAction()
    },
  }
}

async function handleGraph(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, 405, fail('bad-request', 'method not allowed'))
    return
  }
  const url = readUrl(req)
  const cwd = readCwd(url.searchParams.get('cwd'))
  if (cwd === undefined) {
    json(res, 400, fail('no-cwd', 'workspace directory is missing'))
    return
  }
  const skip = clampSkip(Number.parseInt(url.searchParams.get('skip') ?? '0', 10))
  const limit = clampLimit(Number.parseInt(
    url.searchParams.get('limit') ?? String(DEFAULT_GRAPH_LIMIT),
    10,
  ))
  const requested = url.searchParams.getAll('ref').filter((value) => value.length > 0)
  try {
    const log = await loadGraphLog(
      cwd,
      skip,
      limit,
      requested.length === 0 ? undefined : requested,
    )
    const body: GitGraphResponse = { ok: true, cwd, ...log }
    json(res, 200, body)
  } catch (error) {
    writeGitError(res, error)
  }
}

async function handleCommit(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, 405, fail('bad-request', 'method not allowed'))
    return
  }
  const url = readUrl(req)
  const cwd = readCwd(url.searchParams.get('cwd'))
  const sha = url.searchParams.get('sha') ?? ''
  if (cwd === undefined) {
    json(res, 400, fail('no-cwd', 'workspace directory is missing'))
    return
  }
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    json(res, 400, fail('bad-request', 'invalid commit'))
    return
  }
  try {
    const body = await loadCommitBody(cwd, sha)
    const value: GitGraphCommitResponse = { ok: true, sha, body }
    json(res, 200, value)
  } catch (error) {
    writeGitError(res, error)
  }
}

async function handleAction(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    json(res, 405, fail('bad-request', 'method not allowed'))
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    json(res, 400, fail('bad-request', errorMessage(error)))
    return
  }
  const request = parseAction(body)
  if (request === undefined) {
    json(res, 400, fail('bad-request', 'invalid action'))
    return
  }
  try {
    const message = await runGraphAction(request)
    const value: GitGraphActionResponse = {
      ok: true,
      action: request.action,
      sha: request.sha,
      message: message.length === 0 ? undefined : message,
    }
    json(res, 200, value)
  } catch (error) {
    writeGitError(res, error)
  }
}

function parseAction(value: unknown): GitGraphActionRequest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<GitGraphActionRequest>
  const cwd = readCwd(typeof candidate.cwd === 'string' ? candidate.cwd : null)
  const sha = typeof candidate.sha === 'string' ? candidate.sha : ''
  const action = parseActionName(candidate.action)
  if (cwd === undefined || action === undefined) return undefined
  const request: GitGraphActionRequest = { cwd, sha, action }
  if (typeof candidate.branch === 'string') request.branch = candidate.branch
  if (candidate.mode === 'soft' || candidate.mode === 'mixed' || candidate.mode === 'hard') {
    request.mode = candidate.mode as GitResetMode
  }
  return request
}

function parseActionName(value: unknown): GitGraphActionName | undefined {
  if (value === 'checkout' || value === 'create-branch' || value === 'cherry-pick' || value === 'revert' || value === 'reset') {
    return value
  }
  return undefined
}

function writeGitError(res: ServerResponse, error: unknown): void {
  if (error instanceof Error && error.name === 'NotGit') {
    json(res, 200, fail('not-git', 'not a git repository'))
    return
  }
  if (error instanceof Error && error.name === 'BadRequest') {
    json(res, 400, fail('bad-request', error.message))
    return
  }
  json(res, 200, fail('git', errorMessage(error)))
}

function readCwd(raw: string | null): string | undefined {
  if (raw === null || raw.length === 0 || raw.includes('\0')) return undefined
  if (!isAbsolute(raw)) return undefined
  return raw
}

function readUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', 'http://127.0.0.1')
}

function fail(code: GitGraphErr['code'], message: string): GitGraphErr {
  return { ok: false, code, message }
}

function json(res: ServerResponse, status: number, value: unknown): void {
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

function readJsonBody(req: IncomingMessage, limit = 16384): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}
