/** HTTP path: adopt one folder as a workspace unit. */
export const SCAN_PATH = '/dsh-workspace-plus/scan'

/** HTTP path: bind / list / delete multi-folder workspace bindings. */
export const PROJECT_PATH = '/dsh-workspace-plus/binding'

/** HTTP path: reveal a path in the OS file manager (Explorer / Finder / xdg-open). */
export const OPEN_PATH = '/dsh-workspace-plus/open-in-explorer'

/** HTTP path: recover durable or derived titles for visible session rows. */
export const SESSION_TITLES_PATH = '/dsh-workspace-plus/session-titles'

/** HTTP path: durable pins, independent of the desktop web host's port. */
export const PINS_PATH = '/dsh-workspace-plus/pins'

/** Settings namespace the Plugins → 插件配置 tab dispatches by `settings.plugin.item` key. */
export const SETTINGS_NS = 'workspace-plus'

// Branded ids, re-exported through the shared runtime boundary so both halves
// share one source of truth for the platform's identity types.
import type { SessionId, WorkspaceId } from '@just-genius/dsh-plugin-runtime/client'

export type UnitKind = 'git' | 'folder'

export type UnitRole = 'primary' | 'secondary'

export interface RepoFolder {
  name: string
  path: string
  /** Kept for stored bindings; new units are always folders. */
  kind?: UnitKind
  /** True when this unit sits outside the official workspace (the primary). */
  external?: boolean
}

export interface AdoptResult {
  name: string
  path: string
}

export interface WorkspaceBinding {
  /** Official DSH workspace path; always the primary unit (session cwd). */
  root: string
  title: string
  primaryPath: string
  repos: RepoFolder[]
  updatedAt: number
}

export interface BindingListPayload {
  root: string
  bindings: WorkspaceBinding[]
}

export interface SessionTitleLookup {
  id: string
  cwd?: string
  updatedAt: number
  listedBlank: boolean
}

export interface SessionTitleFact extends SessionTitleLookup {
  blank: boolean
  title?: string
  source?: 'event' | 'fallback'
}

export interface SessionTitlePayload {
  sessions: SessionTitleFact[]
}

/**
 * Minimal shape of an official workspace row.
 *
 * The shared runtime boundary does not re-export the platform's workspace view
 * type, so the plugin declares only the fields it reads. Structural typing
 * keeps this assignable to whatever the official row actually is.
 */
export interface WorkspaceView {
  workspaceId: WorkspaceId
  title: string
  path: string
  sessionIds: readonly SessionId[]
}

export interface MemoryHttpOk<T> {
  ok: true
  value: T
}

export interface MemoryHttpErr {
  ok: false
  message: string
}

export type HttpResult<T> = MemoryHttpOk<T> | MemoryHttpErr

export type ProjectAction =
  | {
    action: 'bind'
    root: string
    repos: RepoFolder[]
    title?: string
    primaryPath?: string
    previousRoot?: string
  }
  | { action: 'delete'; root: string }

export function isUnder(child: string, parent: string): boolean {
  const a = normalizeCompare(child)
  const b = normalizeCompare(parent)
  if (a === b) return true
  const sep = b.endsWith('/') ? '' : '/'
  return a.startsWith(`${b}${sep}`)
}

export function samePath(a: string, b: string): boolean {
  return normalizeCompare(a) === normalizeCompare(b)
}

export function normalizeCompare(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function normalizePrimaryPath(repos: RepoFolder[], primaryPath?: string): string {
  if (primaryPath !== undefined && repos.some((repo) => samePath(repo.path, primaryPath))) {
    const match = repos.find((repo) => samePath(repo.path, primaryPath))
    return match?.path ?? repos[0]?.path ?? primaryPath
  }
  return repos[0]?.path ?? primaryPath ?? ''
}

export function roleOf(path: string, primaryPath: string): UnitRole {
  return samePath(path, primaryPath) ? 'primary' : 'secondary'
}

export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path
}

/** Repos with the primary first, then the rest in stored order. */
export function orderedRepos(binding: WorkspaceBinding): RepoFolder[] {
  const primary = normalizePrimaryPath(binding.repos, binding.primaryPath)
  const head = binding.repos.filter((repo) => samePath(repo.path, primary))
  const rest = binding.repos.filter((repo) => !samePath(repo.path, primary))
  return [...head, ...rest]
}
