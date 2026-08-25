import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { errorMessage, readJsonBody, sendJson as json } from '@just-genius/dsh-plugin-runtime/host'
import {
  DEFAULT_GRAPH_LIMIT,
  GIT_GRAPH_ACTION_PATH,
  GIT_GRAPH_COMMIT_PATH,
  GIT_GRAPH_DIFF_PATH,
  GIT_GRAPH_FILE_PATH,
  GIT_GRAPH_FILES_PATH,
  GIT_GRAPH_MESSAGE_PATH,
  GIT_GRAPH_PATH,
  GIT_GRAPH_TREE_PATH,
  GIT_GRAPH_WATCH_PATH,
  type GitGraphActionName,
  type GitGraphActionRequest,
  type GitGraphActionResponse,
  type GitGraphCommitResponse,
  type GitGraphDiffResponse,
  type GitGraphErr,
  type GitGraphFileResponse,
  type GitGraphFilesResponse,
  type GitGraphMessageResponse,
  type GitGraphResponse,
  type GitGraphTreeResponse,
  type GitResetMode,
} from '../../shared/git-graph'
import { runGraphAction } from './actions'
import { loadChangeFiles, loadFile, loadFileDiff, loadTree, searchTree } from './browse'
import { clampLimit, clampSkip, loadCommitBody, loadGraphLog } from './log'
import { generateCommitMessage } from './message'
import { handleWatch } from './watch'

export interface DshCodexGitGraphServer {
  dispose(): void
}

export function createDshCodexGitGraphServer(ctx: Context): DshCodexGitGraphServer {
  const disposeGraph = ctx.webServer.register({
    kind: 'exact',
    path: GIT_GRAPH_PATH,
    handler: (req, res) => handleGraph(ctx, req, res),
  })
  const disposeCommit = ctx.webServer.register({
    kind: 'exact',
    path: GIT_GRAPH_COMMIT_PATH,
    handler: (req, res) => handleCommit(ctx, req, res),
  })
  const disposeAction = ctx.webServer.register({
    kind: 'exact',
    path: GIT_GRAPH_ACTION_PATH,
    handler: (req, res) => handleAction(ctx, req, res),
  })
  const disposeFiles = ctx.webServer.register({
    kind: 'exact',
    path: GIT_GRAPH_FILES_PATH,
    handler: (req, res) => handleFiles(ctx, req, res),
  })
  const disposeTree = ctx.webServer.register({
    kind: 'exact',
    path: GIT_GRAPH_TREE_PATH,
    handler: (req, res) => handleTree(ctx, req, res),
  })
  const disposeFile = ctx.webServer.register({
    kind: 'exact',
    path: GIT_GRAPH_FILE_PATH,
    handler: (req, res) => handleFile(ctx, req, res),
  })
  const disposeDiff = ctx.webServer.register({
    kind: 'exact',
    path: GIT_GRAPH_DIFF_PATH,
    handler: (req, res) => handleDiff(ctx, req, res),
  })
  const disposeMessage = ctx.webServer.register({
    kind: 'exact',
    path: GIT_GRAPH_MESSAGE_PATH,
    handler: (req, res) => handleMessage(ctx, req, res),
  })
  const disposeWatch = ctx.webServer.register({
    kind: 'exact',
    path: GIT_GRAPH_WATCH_PATH,
    handler: (req, res) => handleWatchRoute(ctx, req, res),
  })
  return {
    dispose() {
      disposeGraph()
      disposeCommit()
      disposeAction()
      disposeFiles()
      disposeTree()
      disposeFile()
      disposeDiff()
      disposeMessage()
      disposeWatch()
    },
  }
}

async function handleWatchRoute(ctx: Context, req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    json(res, 405, fail('bad-request', 'method not allowed'))
    return
  }
  const url = readUrl(req)
  const cwd = readCwd(url.searchParams.get('cwd'))
  if (cwd === undefined) {
    json(res, 400, fail('no-cwd', 'workspace directory is missing'))
    return
  }
  try {
    // Keeps the response open; the stream ends when the client disconnects.
    await handleWatch(ctx, req, res, cwd)
  } catch (error) {
    writeGitError(res, error)
  }
}

async function handleGraph(ctx: Context, req: IncomingMessage, res: ServerResponse) {
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
      ctx,
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

async function handleCommit(ctx: Context, req: IncomingMessage, res: ServerResponse) {
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
    const body = await loadCommitBody(ctx, cwd, sha)
    const value: GitGraphCommitResponse = { ok: true, sha, body }
    json(res, 200, value)
  } catch (error) {
    writeGitError(res, error)
  }
}

async function handleAction(ctx: Context, req: IncomingMessage, res: ServerResponse) {
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
    const message = await runGraphAction(ctx, request)
    const value: GitGraphActionResponse = {
      ok: true,
      action: request.action,
      message: message.length === 0 ? undefined : message,
    }
    if (request.sha !== undefined) value.sha = request.sha
    json(res, 200, value)
  } catch (error) {
    writeGitError(res, error)
  }
}

async function handleFiles(ctx: Context, req: IncomingMessage, res: ServerResponse) {
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
  const sha = url.searchParams.get('sha') ?? ''
  if (sha !== '' && !/^[0-9a-f]{7,40}$/i.test(sha)) {
    json(res, 400, fail('bad-request', 'invalid commit'))
    return
  }
  try {
    const files = await loadChangeFiles(ctx, cwd, sha === '' ? undefined : sha)
    const value: GitGraphFilesResponse = { ok: true, cwd, files }
    json(res, 200, value)
  } catch (error) {
    writeGitError(res, error)
  }
}

async function handleTree(ctx: Context, req: IncomingMessage, res: ServerResponse) {
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
  const path = url.searchParams.get('path') ?? ''
  const query = url.searchParams.get('q') ?? ''
  // Default true (VS Code Explorer). Client passes `ignored=0` when the
  // Codex setting hides gitignored paths.
  const showIgnored = url.searchParams.get('ignored') !== '0'
  try {
    const options = { showIgnored }
    const entries = query.trim().length > 0
      ? await searchTree(ctx, cwd, query, options)
      : await loadTree(ctx, cwd, path, options)
    const value: GitGraphTreeResponse = { ok: true, cwd, path, entries }
    json(res, 200, value)
  } catch (error) {
    writeGitError(res, error)
  }
}

async function handleFile(ctx: Context, req: IncomingMessage, res: ServerResponse) {
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
  const path = url.searchParams.get('path') ?? ''
  const sha = url.searchParams.get('sha') ?? ''
  if (path.length === 0) {
    json(res, 400, fail('bad-request', 'invalid file path'))
    return
  }
  if (sha !== '' && !/^[0-9a-f]{7,40}$/i.test(sha)) {
    json(res, 400, fail('bad-request', 'invalid commit'))
    return
  }
  try {
    const loaded = await loadFile(ctx, cwd, path, sha === '' ? undefined : sha)
    const value: GitGraphFileResponse = { ok: true, cwd, path, ...loaded }
    json(res, 200, value)
  } catch (error) {
    writeGitError(res, error)
  }
}

async function handleDiff(ctx: Context, req: IncomingMessage, res: ServerResponse) {
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
  const path = url.searchParams.get('path') ?? ''
  const sha = url.searchParams.get('sha') ?? ''
  if (path.length === 0) {
    json(res, 400, fail('bad-request', 'invalid file path'))
    return
  }
  if (sha !== '' && !/^[0-9a-f]{7,40}$/i.test(sha)) {
    json(res, 400, fail('bad-request', 'invalid commit'))
    return
  }
  try {
    const diff = await loadFileDiff(ctx, cwd, path, sha === '' ? undefined : sha)
    const value: GitGraphDiffResponse = {
      ok: true,
      cwd,
      path,
      sha: sha === '' ? undefined : sha,
      diff,
    }
    json(res, 200, value)
  } catch (error) {
    writeGitError(res, error)
  }
}

async function handleMessage(ctx: Context, req: IncomingMessage, res: ServerResponse) {
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
  const candidate = body as { cwd?: unknown }
  const cwd = readCwd(typeof candidate.cwd === 'string' ? candidate.cwd : null)
  if (cwd === undefined) {
    json(res, 400, fail('no-cwd', 'workspace directory is missing'))
    return
  }
  // Drop the model stream as soon as the browser aborts (panel switch,
  // navigation, or a superseded generate). Otherwise a 60s LLM call keeps
  // running and makes follow-up git actions feel frozen.
  const abort = new AbortController()
  const onClose = (): void => abort.abort()
  req.on('close', onClose)
  try {
    const message = await generateCommitMessage(ctx, cwd, abort.signal)
    if (abort.signal.aborted || res.writableEnded) return
    const value: GitGraphMessageResponse = { ok: true, message }
    json(res, 200, value)
  } catch (error) {
    if (abort.signal.aborted || res.writableEnded) return
    const text = errorMessage(error)
    if (/aborted|abort/i.test(text)) {
      json(res, 499, fail('git', 'generation cancelled'))
      return
    }
    writeGitError(res, error)
  } finally {
    req.off('close', onClose)
  }
}

function parseAction(value: unknown): GitGraphActionRequest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<GitGraphActionRequest>
  const cwd = readCwd(typeof candidate.cwd === 'string' ? candidate.cwd : null)
  const action = parseActionName(candidate.action)
  if (cwd === undefined || action === undefined) return undefined
  const request: GitGraphActionRequest = { cwd, action }
  if (typeof candidate.sha === 'string') request.sha = candidate.sha
  if (typeof candidate.branch === 'string') request.branch = candidate.branch
  if (typeof candidate.message === 'string') request.message = candidate.message
  if (typeof candidate.path === 'string') request.path = candidate.path
  if (candidate.all === true) request.all = true
  if (candidate.mode === 'soft' || candidate.mode === 'mixed' || candidate.mode === 'hard') {
    request.mode = candidate.mode as GitResetMode
  }
  return request
}

function parseActionName(value: unknown): GitGraphActionName | undefined {
  switch (value) {
    case 'checkout':
    case 'create-branch':
    case 'cherry-pick':
    case 'revert':
    case 'reset':
    case 'commit':
    case 'commit-push':
    case 'commit-amend':
    case 'commit-push-amend':
    case 'stage':
    case 'unstage':
    case 'stage-all':
    case 'unstage-all':
    case 'discard':
    case 'discard-all':
    case 'pull':
    case 'push':
    case 'fetch':
    case 'stash':
    case 'stash-pop':
      return value
    default:
      return undefined
  }
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
