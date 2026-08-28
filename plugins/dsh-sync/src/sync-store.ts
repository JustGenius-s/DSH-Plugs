import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { credentialRef } from '@just-genius/dsh-plugin-runtime/host'
import { defineDomain, type Domain } from '@just-genius/dsh-plugin-runtime/host'
import { z } from 'zod'

/** Non-secret sync metadata. The GitHub token lives in ctx.credentials. */
export interface SyncMetadata {
  clientId: string
  login: string | null
  avatarUrl: string | null
  gistId: string | null
  lastSyncedAt: string | null
  lastSyncedHash: string | null
}

const metadataSchema = z.object({
  clientId: z.string(),
  login: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  gistId: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  lastSyncedHash: z.string().nullable(),
})

const EMPTY_METADATA: SyncMetadata = {
  clientId: '',
  login: null,
  avatarUrl: null,
  gistId: null,
  lastSyncedAt: null,
  lastSyncedHash: null,
}

/** One singleton domain holding the non-secret sync state on ctx.storageDomain. */
const syncDomainSpec = defineDomain({
  name: 'sync',
  version: 1,
  global: {
    schema: metadataSchema,
    initial: EMPTY_METADATA,
  },
  tables: {},
})

type SyncDomain = Domain<typeof syncDomainSpec>

/**
 * Credential reference under which the GitHub OAuth token is stored. The
 * provider-managed writable source keeps the secret out of state.json; the
 * `DSH_SYNC_` prefix keeps it from colliding with a real ambient
 * `GITHUB_TOKEN`.
 */
const githubTokenRef = credentialRef('DSH_SYNC_GITHUB_TOKEN')

/**
 * One sync store spanning the two official seams:
 *
 * - ctx.credentials holds the GitHub access token as a credential reference
 *   (`DSH_SYNC_GITHUB_TOKEN`), so the secret never sits in a plaintext
 *   JSON file. `resolve` re-reads it per operation and `unset` logs out.
 * - ctx.storageDomain holds the non-secret metadata (client id, login,
 *   gist id, last-sync facts) as a validated singleton on the storage hub.
 */
export class SyncStore {
  private readonly domain: Promise<SyncDomain>

  constructor(private readonly ctx: Context) {
    this.domain = ctx.storageDomain.open(syncDomainSpec)
  }

  /** Close the open domain (idempotent); the facility also closes on unmount. */
  close(): Promise<void> {
    return this.domain.then((domain) => domain.close())
  }

  async metadata(): Promise<SyncMetadata> {
    const domain = await this.domain
    return domain.global.get()
  }

  async patchMetadata(patch: Partial<SyncMetadata>): Promise<SyncMetadata> {
    const domain = await this.domain
    const next: SyncMetadata = { ...domain.global.get(), ...patch }
    await domain.global.set(next)
    return next
  }

  async getToken(): Promise<string | null> {
    const resolved = await this.ctx.credentials.resolve(githubTokenRef)
    return resolved?.value ?? null
  }

  async setToken(accessToken: string): Promise<void> {
    await this.ctx.credentials.set(githubTokenRef, accessToken)
  }

  async clearToken(): Promise<void> {
    await this.ctx.credentials.unset(githubTokenRef)
  }
}
