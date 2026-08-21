import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { fetchGithubUser, pollDeviceFlow, startDeviceFlow } from './github-auth.ts'
import { createSecretGist, getGist, resolveGistId, updateGist } from './github-gist.ts'
import { applySettings, collectPayload, localContentUpdatedAt, parsePayload, serializePayload } from './payload.ts'
import { applyPlugins, collectPlugins } from './profile-sync.ts'
import {
  AUTH_LOGOUT_PATH,
  AUTH_POLL_PATH,
  AUTH_START_PATH,
  CONFIG_PATH,
  PULL_PATH,
  PUSH_PATH,
  STATUS_PATH,
  type PullRequest,
  type PullResult,
  type PushResult,
  type SyncConfigPatch,
  type SyncHttpResult,
  type SyncStatus,
} from './shared.ts'
import { clearAuth, loadState, patchState } from './sync-store.ts'

export const name = 'dsh-sync'
export const inject = ['webServer'] as const

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATUS_PATH,
    handler: (req, res) => handleStatus(req, res),
  }), 'dsh-sync: status')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CONFIG_PATH,
    handler: (req, res) => void handleConfig(req, res),
  }), 'dsh-sync: config')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: AUTH_START_PATH,
    handler: (req, res) => void handleAuthStart(req, res),
  }), 'dsh-sync: auth start')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: AUTH_POLL_PATH,
    handler: (req, res) => void handleAuthPoll(req, res),
  }), 'dsh-sync: auth poll')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: AUTH_LOGOUT_PATH,
    handler: (req, res) => void handleAuthLogout(req, res),
  }), 'dsh-sync: auth logout')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PUSH_PATH,
    handler: (req, res) => void handlePush(req, res),
  }), 'dsh-sync: push')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PULL_PATH,
    handler: (req, res) => void handlePull(req, res),
  }), 'dsh-sync: pull')
}

function handleStatus(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET') {
    json(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  json(res, 200, { ok: true, value: buildStatus() })
}

async function handleConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
  const patch = body as SyncConfigPatch
  patchState({
    clientId: typeof patch.clientId === 'string' ? patch.clientId.trim() : undefined,
    gistId: patch.gistId === null
      ? null
      : typeof patch.gistId === 'string'
        ? (patch.gistId.trim() || null)
        : undefined,
  })
  json(res, 200, { ok: true, value: buildStatus() })
}

async function handleAuthStart(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  try {
    const state = loadState()
    const started = await startDeviceFlow(state.clientId)
    json(res, 200, { ok: true, value: started })
  } catch (error) {
    json(res, 400, { ok: false, message: errorMessage(error) })
  }
}

async function handleAuthPoll(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
  const deviceCode = body !== null && typeof body === 'object' && typeof (body as { deviceCode?: unknown }).deviceCode === 'string'
    ? (body as { deviceCode: string }).deviceCode
    : ''
  if (deviceCode.trim() === '') {
    json(res, 400, { ok: false, message: 'deviceCode is required' })
    return
  }

  try {
    const state = loadState()
    const result = await pollDeviceFlow(state.clientId, deviceCode)
    if (result.status === 'success' && result.accessToken) {
      const user = await fetchGithubUser(result.accessToken)
      patchState({
        accessToken: result.accessToken,
        login: user.login,
        avatarUrl: user.avatarUrl,
      })
      json(res, 200, {
        ok: true,
        value: { status: 'success', login: user.login, avatarUrl: user.avatarUrl },
      })
      return
    }
    json(res, 200, { ok: true, value: result })
  } catch (error) {
    json(res, 400, { ok: false, message: errorMessage(error) })
  }
}

async function handleAuthLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  clearAuth()
  json(res, 200, { ok: true, value: buildStatus() })
}

async function handlePush(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  try {
    const state = requireAuth()
    const { skipped } = collectPlugins()
    const payload = collectPayload()
    const content = serializePayload(payload)
    let gistId = await resolveGistId(state.accessToken!, state.gistId)
    let gist
    if (gistId === null) {
      gist = await createSecretGist(state.accessToken!, content)
      gistId = gist.id
    } else {
      gist = await updateGist(state.accessToken!, gistId, content)
    }
    patchState({
      gistId: gist.id,
      lastSyncedAt: payload.updatedAt,
    })
    const value: PushResult = {
      gistId: gist.id,
      gistUrl: gist.htmlUrl,
      updatedAt: payload.updatedAt,
      pluginCount: Object.keys(payload.plugins?.dependencies ?? {}).length,
      pluginsSkipped: skipped,
    }
    json(res, 200, { ok: true, value })
  } catch (error) {
    json(res, 400, { ok: false, message: errorMessage(error) })
  }
}

async function handlePull(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  let body: PullRequest = {}
  try {
    const raw = await readJsonBody(req)
    if (raw !== null && typeof raw === 'object') body = raw as PullRequest
  } catch (error) {
    json(res, 400, { ok: false, message: errorMessage(error) })
    return
  }

  try {
    const state = requireAuth()
    const gistId = await resolveGistId(state.accessToken!, state.gistId)
    if (gistId === null) {
      const empty: PullResult = {
        applied: false,
        conflict: false,
        cloudUpdatedAt: null,
        localUpdatedAt: localContentUpdatedAt(),
        message: 'No sync Gist found yet. Push once to create one.',
      }
      json(res, 200, { ok: true, value: empty })
      return
    }

    const gist = await getGist(state.accessToken!, gistId)
    const payload = parsePayload(gist.content)
    const localUpdatedAt = localContentUpdatedAt()
    const lastSyncedAt = state.lastSyncedAt

    const cloudNewer = payload.updatedAt !== lastSyncedAt
    const localDirty = localUpdatedAt !== null
      && (lastSyncedAt === null || localUpdatedAt > lastSyncedAt)

    if (cloudNewer && localDirty && body.force !== true) {
      const conflict: PullResult = {
        applied: false,
        conflict: true,
        cloudUpdatedAt: payload.updatedAt,
        localUpdatedAt,
        message: 'Local and cloud both changed since last sync. Pull again with force to overwrite local.',
      }
      patchState({ gistId })
      json(res, 200, { ok: true, value: conflict })
      return
    }

    applySettings(payload)
    let pluginsAdded: string[] = []
    let pluginsRemoved: string[] = []
    let pluginsFailed: Array<{ name: string; error: string }> = []
    let needsRestart = false
    if (payload.plugins !== null && payload.plugins !== undefined) {
      const pluginResult = await applyPlugins(payload.plugins)
      pluginsAdded = pluginResult.added
      pluginsRemoved = pluginResult.removed
      pluginsFailed = pluginResult.failed
      needsRestart = pluginResult.needsRestart
    }

    patchState({
      gistId,
      lastSyncedAt: payload.updatedAt,
    })

    const parts = ['Pulled settings.yaml']
    if (payload.plugins) {
      if (pluginsAdded.length === 0 && pluginsRemoved.length === 0 && pluginsFailed.length === 0) {
        parts.push('plugins unchanged')
      } else {
        parts.push(
          `plugins +${pluginsAdded.length}/-${pluginsRemoved.length}`
            + (pluginsFailed.length > 0 ? ` (${pluginsFailed.length} failed)` : ''),
        )
      }
    }
    if (needsRestart) parts.push('restart DSH web to load plugin changes')

    const ok: PullResult = {
      applied: true,
      conflict: false,
      cloudUpdatedAt: payload.updatedAt,
      localUpdatedAt,
      message: parts.join(' · '),
      needsRestart,
      pluginsAdded,
      pluginsRemoved,
      pluginsFailed,
    }
    json(res, 200, { ok: true, value: ok })
  } catch (error) {
    json(res, 400, { ok: false, message: errorMessage(error) })
  }
}

function buildStatus(): SyncStatus {
  const state = loadState()
  const gistId = state.gistId
  const { snapshot } = collectPlugins()
  return {
    clientId: state.clientId,
    loggedIn: state.accessToken !== null,
    login: state.login,
    avatarUrl: state.avatarUrl ?? (state.login !== null
      ? `https://github.com/${encodeURIComponent(state.login)}.png?size=64`
      : null),
    gistId,
    gistUrl: gistId !== null ? `https://gist.github.com/${gistId}` : null,
    lastSyncedAt: state.lastSyncedAt,
    localUpdatedAt: localContentUpdatedAt(),
    pluginCount: Object.keys(snapshot.dependencies).length,
  }
}

function requireAuth(): ReturnType<typeof loadState> {
  const state = loadState()
  if (state.clientId.trim() === '') {
    throw new Error('Set a GitHub OAuth Client ID first')
  }
  if (state.accessToken === null) {
    throw new Error('Not logged in to GitHub')
  }
  return state
}

function json(res: ServerResponse, status: number, value: SyncHttpResult<unknown> | { ok: false; message: string }): void {
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
