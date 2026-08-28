import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { HttpInputError, errorMessage, readJsonBody, sendJson } from '@just-genius/dsh-plugin-runtime/host'
import { fetchGithubUser, pollDeviceFlow, startDeviceFlow } from './github-auth.ts'
import { createSecretGist, getGist, resolveGistId, updateGist } from './github-gist.ts'
import { applySettings, collectPayload, contentHash, localContentUpdatedAt, parsePayload, serializePayload } from './payload.ts'
import { applyPlugins, collectPlugins } from './profile-sync.ts'
import type { PullRequest, PullResult, PushResult, SyncConfigPatch, SyncStatus } from './shared.ts'
import { SyncStore, type SyncMetadata } from './sync-store.ts'

export class SyncRuntime {
  private settingsChangedAt: number | null = null
  private readonly store: SyncStore

  constructor(private readonly ctx: Context) {
    this.store = new SyncStore(ctx)
    ctx.on('settings/document-updated', () => {
      this.settingsChangedAt = Date.now()
    })
  }

  /** Close the storage-domain unit (idempotent). */
  close(): Promise<void> {
    return this.store.close()
  }

  status = (req: IncomingMessage, res: ServerResponse): void => {
    this.run(req, res, 'GET', async () => this.buildStatus())
  }

  config = (req: IncomingMessage, res: ServerResponse): void => {
    this.run(req, res, 'POST', async () => {
      const body = await readJsonBody(req)
      if (!isRecord(body)) throw new HttpInputError('invalid body')
      const patch = body as SyncConfigPatch
      await this.store.patchMetadata({
        clientId: typeof patch.clientId === 'string' ? patch.clientId.trim() : undefined,
        gistId: patch.gistId === null
          ? null
          : typeof patch.gistId === 'string' ? patch.gistId.trim() || null : undefined,
      })
      return this.buildStatus()
    })
  }

  authStart = (req: IncomingMessage, res: ServerResponse): void => {
    this.run(req, res, 'POST', async () => {
      const metadata = await this.store.metadata()
      return startDeviceFlow(metadata.clientId)
    })
  }

  authPoll = (req: IncomingMessage, res: ServerResponse): void => {
    this.run(req, res, 'POST', async () => {
      const body = await readJsonBody(req)
      const deviceCode = isRecord(body) && typeof body.deviceCode === 'string' ? body.deviceCode : ''
      if (deviceCode.trim() === '') throw new HttpInputError('deviceCode is required')
      const metadata = await this.store.metadata()
      const result = await pollDeviceFlow(metadata.clientId, deviceCode)
      if (result.status !== 'success' || !result.accessToken) return result
      const user = await fetchGithubUser(result.accessToken)
      await this.store.setToken(result.accessToken)
      await this.store.patchMetadata({ login: user.login, avatarUrl: user.avatarUrl })
      return { status: 'success', login: user.login, avatarUrl: user.avatarUrl }
    })
  }

  authLogout = (req: IncomingMessage, res: ServerResponse): void => {
    this.run(req, res, 'POST', async () => {
      await this.store.clearToken()
      await this.store.patchMetadata({ login: null, avatarUrl: null })
      return this.buildStatus()
    })
  }

  push = (req: IncomingMessage, res: ServerResponse): void => {
    this.run(req, res, 'POST', async () => {
      const { token, metadata } = await this.requireAuth()
      const payload = collectPayload(this.ctx.settings, this.ctx.pluginProfile)
      const { skipped } = collectPlugins(this.ctx.pluginProfile)
      const serialized = serializePayload(payload)
      let gistId = await resolveGistId(token, metadata.gistId)
      const gist = gistId === null
        ? await createSecretGist(token, serialized)
        : await updateGist(token, gistId, serialized)
      gistId = gist.id
      await this.store.patchMetadata({ gistId, lastSyncedAt: payload.updatedAt, lastSyncedHash: contentHash(payload) })
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
      const { token, metadata } = await this.requireAuth()
      const gistId = await resolveGistId(token, metadata.gistId)
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

      const gist = await getGist(token, gistId)
      const payload = parsePayload(gist.content)
      const cloudHash = contentHash(payload)
      const localHash = contentHash(collectPayload(this.ctx.settings, this.ctx.pluginProfile))
      const cloudNewer = cloudHash !== metadata.lastSyncedHash
      const localDirty = metadata.lastSyncedHash !== null && localHash !== metadata.lastSyncedHash
      if (cloudNewer && localDirty && body.force !== true) {
        await this.store.patchMetadata({ gistId })
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
      await this.store.patchMetadata({ gistId, lastSyncedAt: payload.updatedAt, lastSyncedHash: cloudHash })

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

  private async buildStatus(): Promise<SyncStatus> {
    const metadata = await this.store.metadata()
    const token = await this.store.getToken()
    const gistId = metadata.gistId
    const { snapshot } = collectPlugins(this.ctx.pluginProfile)
    return {
      clientId: metadata.clientId,
      loggedIn: token !== null,
      login: metadata.login,
      avatarUrl: metadata.avatarUrl ?? (metadata.login ? `https://github.com/${encodeURIComponent(metadata.login)}.png?size=64` : null),
      gistId,
      gistUrl: gistId ? `https://gist.github.com/${gistId}` : null,
      lastSyncedAt: metadata.lastSyncedAt,
      localUpdatedAt: localContentUpdatedAt(this.ctx.pluginProfile, this.settingsChangedAt),
      pluginCount: Object.keys(snapshot.dependencies).length,
    }
  }

  private async requireAuth(): Promise<{ token: string; metadata: SyncMetadata }> {
    const metadata = await this.store.metadata()
    const token = await this.store.getToken()
    if (metadata.clientId.trim() === '') throw new HttpInputError('Set a GitHub OAuth Client ID first')
    if (token === null) throw new HttpInputError('Not logged in to GitHub')
    return { token, metadata }
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
