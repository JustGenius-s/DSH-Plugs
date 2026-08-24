/** HTTP paths for the sync plugin. */
export const STATUS_PATH = '/dsh-sync/status'
export const CONFIG_PATH = '/dsh-sync/config'
export const AUTH_START_PATH = '/dsh-sync/auth/start'
export const AUTH_POLL_PATH = '/dsh-sync/auth/poll'
export const AUTH_LOGOUT_PATH = '/dsh-sync/auth/logout'
export const PUSH_PATH = '/dsh-sync/push'
export const PULL_PATH = '/dsh-sync/pull'

/** Filename inside the secret Gist. */
export const GIST_FILE = 'dsh-config.json'

/** Gist description used when creating / looking up the sync gist. */
export const GIST_DESCRIPTION = 'DSH config sync (dsh-sync)'

export interface SyncHttpOk<T> {
  ok: true
  value: T
}

export interface SyncHttpErr {
  ok: false
  message: string
}

export type SyncHttpResult<T> = SyncHttpOk<T> | SyncHttpErr

export interface SyncStatus {
  clientId: string
  loggedIn: boolean
  login: string | null
  avatarUrl: string | null
  gistId: string | null
  gistUrl: string | null
  lastSyncedAt: string | null
  localUpdatedAt: string | null
  /** Portable plugin deps that will be included on next push. */
  pluginCount: number
}

export interface SyncConfigPatch {
  clientId?: string
  gistId?: string | null
}

export interface DeviceStart {
  userCode: string
  verificationUri: string
  verificationUriComplete: string | null
  deviceCode: string
  interval: number
  expiresIn: number
}

export type DevicePollResult =
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'success'; login: string; avatarUrl?: string }
  | { status: 'denied' | 'expired' | 'error'; message: string }

/** Portable web-profile plugin list + user cordis patch. */
export interface SyncPluginsSnapshot {
  /** package name → portable pnpm spec (github: / version / npm: …) */
  dependencies: Record<string, string>
  cordisPatchYml: string
}

export interface SyncPayloadV2 {
  version: 2
  updatedAt: string
  /** Raw user layers, keyed by registered settings namespace. */
  settings: Record<string, Record<string, unknown>>
  /** Reserved; always null while memory sync is disabled. */
  memory: null
  /** Plugin manifest + cord. Absent on legacy gists. */
  plugins?: SyncPluginsSnapshot | null
}

export interface PushResult {
  gistId: string
  gistUrl: string
  updatedAt: string
  pluginCount: number
  pluginsSkipped: Array<{ name: string; reason: string }>
}

export interface PullResult {
  applied: boolean
  conflict: boolean
  cloudUpdatedAt: string | null
  localUpdatedAt: string | null
  message: string
  needsRestart?: boolean
  pluginsAdded?: string[]
  pluginsRemoved?: string[]
  pluginsFailed?: Array<{ name: string; error: string }>
}

export interface PullRequest {
  force?: boolean
}
