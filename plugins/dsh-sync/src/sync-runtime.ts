import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { HttpInputError, errorMessage, readJsonBody, sendJson } from '@just-genius/dsh-plugin-runtime/host'
import { fetchGithubUser, pollDeviceFlow, startDeviceFlow } from './github-auth.ts'
import { createSecretGist, getGist, resolveGistId, updateGist } from './github-gist.ts'
import { applySettings, collectPayload, contentHash, localContentUpdatedAt, parsePayload, serializePayload } from './payload.ts'
import { applyPlugins, collectPlugins } from './profile-sync.ts'
import type { PullRequest, PullResult, PushResult, SyncConfigPatch, SyncStatus } from './shared.ts'
import { clearAuth, loadState, patchState } from './sync-store.ts'

export class SyncRuntime {
  private settingsChangedAt: number | null = null

  constructor(private readonly ctx: Context) {
    ctx.on('settings/document-updated', () => {
      this.settingsChangedAt = Date.now()
    })
  }

  status = (req: IncomingMessage, res: ServerResponse): void => {
    this.run(req, res, 'GET', async () => this.buildStatus())
  }

  config = (req: IncomingMessage, res: ServerResponse): void => {
    this.run(req, res, 'POST', async () => {
      const body = await readJsonBody(req)
      if (!isRecord(body)) throw new HttpInputError('invalid body')
      const patch = body as SyncConfigPatch
      patchState({
        clientId: typeof patch.clientId === 'string' ? patch.clientId.trim() : undefined,
        gistId: patch.gistId === null
          ? null
          : typeof patch.gistId === 'string' ? patch.gistId.trim() || null : undefined,
      })
      return this.buildStatus()
    })
  }

  authStart = (req: IncomingMessage, res: ServerResponse): void => {
    this.run(req, res, 'POST', async () => startDeviceFlow(loadState().clientId))
  }

  authPoll = (req: IncomingMessage, res: ServerResponse): void => {
    this.run(req, res, 'POST', async () => {
      const body = await readJsonBody(req)
      const deviceCode = isRecord(body) && typeof body.deviceCode === 'string' ? body.deviceCode : ''
      if (deviceCode.trim() === '') throw new HttpInputError('deviceCode is required')
      const state = loadState()
      const result = await pollDeviceFlow(state.clientId, deviceCode)
      if (result.status !== 'success' || !result.accessToken) return result
      const user = await fetchGithubUser(result.accessToken)
      patchState({ accessToken: result.accessToken, login: user.login, avatarUrl: user.avatarUrl })
      return { status: 'success', login: user.login, avatarUrl: user.avatarUrl }
    })
  }

  authLogout = (req: IncomingMessage, res: ServerResponse): void => {
    this.run(req, res, 'POST', async () => {
      clearAuth()
      return this.buildStatus()
    })
  }

  push = (req: IncomingMessage, res: ServerResponse): void => {
    this.run(req, res, 'POST', async () => {
      const state = this.requireAuth()
      const payload = collectPayload(this.ctx.settings, this.ctx.pluginProfile)
      const { skipped } = collectPlugins(this.ctx.pluginProfile)
      const serialized = serializePayload(payload)
      let gistId = await resolveGistId(state.accessToken!, state.gistId)
      const gist = gistId === null
        ? await createSecretGist(state.accessToken!, serialized)
        : await updateGist(state.accessToken!, gistId, serialized)
      gistId = gist.id
      patchState({ gistId, lastSyncedAt: payload.updatedAt, lastSyncedHash: contentHash(payload) })
      const result: PushResult = {
        gistId,
        gistUrl: gist.htmlUrl,
        updatedAt: payload.updatedAt,
        pluginCount: Object.keys(payload.plugins?.dependencies ?? {}).length,
        pluginsSkipped: skipped,
      }
      return result
    })
  }

  pull = (req: IncomingMessage, res: ServerResponse): void => {
    this.run(req, res, 'POST', async () => {
      const raw = await readJsonBody(req)
      const body: PullRequest = isRecord(raw) ? raw : {}
      const state = this.requireAuth()
      const gistId = await resolveGistId(state.accessToken!, state.gistId)
      const localUpdatedAt = localContentUpdatedAt(this.ctx.pluginProfile, this.settingsChangedAt)
      if (gistId === null) {
        return {
          applied: false,
          conflict: false,
          cloudUpdatedAt: null,
          localUpdatedAt,
          message: 'No sync Gist found yet. Push once to create one.',
        } satisfies PullResult
      }

      const gist = await getGist(state.accessToken!, gistId)
      const payload = parsePayload(gist.content)
      const cloudHash = contentHash(payload)
      const localHash = contentHash(collectPayload(this.ctx.settings, this.ctx.pluginProfile))
      const cloudNewer = cloudHash !== state.lastSyncedHash
      const localDirty = state.lastSyncedHash !== null && localHash !== state.lastSyncedHash
      if (cloudNewer && localDirty && body.force !== true) {
        patchState({ gistId })
        return {
          applied: false,
          conflict: true,
          cloudUpdatedAt: payload.updatedAt,
          localUpdatedAt,
          message: 'Local and cloud both changed since last sync. Pull again with force to overwrite local.',
        } satisfies PullResult
      }

      const settingsResult = await applySettings(this.ctx.settings, payload)
      const pluginResult = payload.plugins
        ? await applyPlugins(this.ctx.pluginProfile, payload.plugins)
        : { added: [], removed: [], failed: [], needsRestart: false }
      patchState({ gistId, lastSyncedAt: payload.updatedAt, lastSyncedHash: cloudHash })

      const parts = [`settings ${settingsResult.applied.length} applied`]
      if (settingsResult.skipped.length > 0) {
        parts.push(`${settingsResult.skipped.length} unavailable until their plugins load`)
      }
      if (payload.plugins) {
        parts.push(pluginResult.added.length === 0 && pluginResult.removed.length === 0 && pluginResult.failed.length === 0
          ? 'plugins unchanged'
          : `plugins +${pluginResult.added.length}/-${pluginResult.removed.length}`
            + (pluginResult.failed.length > 0 ? ` (${pluginResult.failed.length} failed)` : ''))
      }
      if (pluginResult.needsRestart) parts.push('restart DSH web to load plugin changes')
      return {
        applied: true,
        conflict: false,
        cloudUpdatedAt: payload.updatedAt,
        localUpdatedAt,
        message: parts.join(' · '),
        needsRestart: pluginResult.needsRestart,
        pluginsAdded: pluginResult.added,
        pluginsRemoved: pluginResult.removed,
        pluginsFailed: pluginResult.failed,
      } satisfies PullResult
    })
  }

  private buildStatus(): SyncStatus {
    const state = loadState()
    const gistId = state.gistId
    const { snapshot } = collectPlugins(this.ctx.pluginProfile)
    return {
      clientId: state.clientId,
      loggedIn: state.accessToken !== null,
      login: state.login,
      avatarUrl: state.avatarUrl ?? (state.login ? `https://github.com/${encodeURIComponent(state.login)}.png?size=64` : null),
      gistId,
      gistUrl: gistId ? `https://gist.github.com/${gistId}` : null,
      lastSyncedAt: state.lastSyncedAt,
      localUpdatedAt: localContentUpdatedAt(this.ctx.pluginProfile, this.settingsChangedAt),
      pluginCount: Object.keys(snapshot.dependencies).length,
    }
  }

  private requireAuth(): ReturnType<typeof loadState> {
    const state = loadState()
    if (state.clientId.trim() === '') throw new HttpInputError('Set a GitHub OAuth Client ID first')
    if (state.accessToken === null) throw new HttpInputError('Not logged in to GitHub')
    return state
  }

  private run(
    req: IncomingMessage,
    res: ServerResponse,
    method: 'GET' | 'POST',
    operation: () => Promise<unknown>,
  ): void {
    if (req.method !== method) {
      sendJson(res, 405, { ok: false, message: 'method not allowed' })
      return
    }
    void operation().then(
      value => sendJson(res, 200, { ok: true, value }),
      error => sendJson(res, error instanceof HttpInputError ? error.status : 400, {
        ok: false,
        message: errorMessage(error),
      }),
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
