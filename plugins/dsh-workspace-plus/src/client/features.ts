/**
 * Local preferences for the plugin's additive surfaces.
 *
 * Every row this plugin contributes can be switched off, so the official menus
 * never grow past what the user wants. Only additions live here: the official
 * pin, rename, fork, and archive rows are DSH's own and are not ours to toggle.
 *
 * The pinned panel reads its project pins from the Host (`pins.json`); session
 * pins are the official `pinnedSessionIds` and are not duplicated here.
 */

export type FeatureKey =
  /** Right-clicking a row opens that row's official menu (and our rows with it). */
  | 'contextmenu'
  /** Show the pinned area above the sidebar list. */
  | 'pinnedPanel'
  | 'workspacePin'
  | 'workspaceEditBinding'
  | 'workspaceOpenExplorer'
  | 'workspaceCopyPath'
  | 'workspaceNewSession'
  | 'sessionCopyReference'
  | 'sessionExport'
  | 'sessionOpenFolder'

export const FEATURE_KEYS: readonly FeatureKey[] = [
  'contextmenu',
  'pinnedPanel',
  'workspacePin',
  'workspaceEditBinding',
  'workspaceOpenExplorer',
  'workspaceCopyPath',
  'workspaceNewSession',
  'sessionCopyReference',
  'sessionExport',
  'sessionOpenFolder',
]

/** Rows contributed to the official Project (workspace) menu. */
export const WORKSPACE_KEYS: readonly FeatureKey[] = [
  'contextmenu',
  'workspacePin',
  'workspaceEditBinding',
  'workspaceOpenExplorer',
  'workspaceCopyPath',
  'workspaceNewSession',
]

/** Rows contributed to the official Session menu. */
export const SESSION_KEYS: readonly FeatureKey[] = [
  'sessionCopyReference',
  'sessionExport',
  'sessionOpenFolder',
]

/** Switches for the plugin's own surfaces rather than a menu row. */
export const SURFACE_KEYS: readonly FeatureKey[] = ['pinnedPanel']

export type FeatureMap = Record<FeatureKey, boolean>

const DEFAULT_FEATURES: FeatureMap = {
  contextmenu: true,
  pinnedPanel: true,
  workspacePin: true,
  workspaceEditBinding: true,
  workspaceOpenExplorer: true,
  workspaceCopyPath: true,
  workspaceNewSession: true,
  sessionCopyReference: true,
  sessionExport: true,
  sessionOpenFolder: true,
}

export interface PluginState {
  /** Pinned workspace ids, newest first. Session pins are DSH's own. */
  workspacePins: string[]
  /**
   * Drag-arranged row order, keyed by scope (`top`, `project:<id>`).
   *
   * Children are also written through to the host, but this is kept for both
   * scopes: the panel re-sorts its rows for display, so a host write alone is
   * invisible until a stored order overrides that sort (see `pinned-order.ts`).
   */
  pinnedOrder: Record<string, string[]>
  features: FeatureMap
  /** Whether the pinned area's rows are folded away. Per browser, like the rest. */
  pinsCollapsed: boolean
  /**
   * Project ids whose nested sessions are folded, newest first.
   *
   * Per browser like the rest of this state: which projects the operator is
   * currently working inside is a view preference, not shared data.
   */
  collapsedProjects: string[]
}

/**
 * Storage key. v2 kept the menu-only shape; this rebuild stores workspace pins
 * only, because session pins moved to the official registry.
 */
export const STORAGE_KEY = 'dsh-workspace-plus:v3'

const listeners = new Set<() => void>()
let state: PluginState = load()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribePluginState(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getPluginState(): PluginState {
  return state
}

function defaultState(): PluginState {
  return {
    workspacePins: [],
    pinnedOrder: {},
    features: { ...DEFAULT_FEATURES },
    pinsCollapsed: false,
    collapsedProjects: [],
  }
}

/**
 * Read the stored row order, dropping anything malformed.
 *
 * Shape-checked rather than trusted: this is user-writable localStorage, and a
 * corrupted entry must degrade to "no arrangement" (the default ordering) rather
 * than crash the panel or, worse, drop rows.
 */
function parseOrder(value: unknown): Record<string, string[]> {
  if (value === null || typeof value !== 'object') return {}
  const out: Record<string, string[]> = {}
  for (const [scope, list] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue
    const ids = list.filter((id): id is string => typeof id === 'string' && id !== '')
    if (ids.length > 0) out[scope] = ids
  }
  return out
}

function parse(raw: string | null): PluginState {
  if (raw === null) return defaultState()
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (value === null || typeof value !== 'object') return defaultState()
    const features = { ...DEFAULT_FEATURES }
    if (value.features !== null && typeof value.features === 'object') {
      const flags = value.features as Record<string, unknown>
      for (const key of FEATURE_KEYS) {
        if (typeof flags[key] === 'boolean') features[key] = flags[key]
      }
    }
    return {
      workspacePins: Array.isArray(value.workspacePins)
        ? value.workspacePins.filter((id): id is string => typeof id === 'string' && id !== '')
        : [],
      pinnedOrder: parseOrder(value.pinnedOrder),
      features,
      pinsCollapsed: value.pinsCollapsed === true,
      collapsedProjects: Array.isArray(value.collapsedProjects)
        ? value.collapsedProjects.filter((id): id is string => typeof id === 'string' && id !== '')
        : [],
    }
  } catch {
    return defaultState()
  }
}

function load(): PluginState {
  try {
    return parse(localStorage.getItem(STORAGE_KEY))
  } catch {
    // Private mode / disabled storage: keep behavior for this session only.
    return defaultState()
  }
}

function commit(next: PluginState): void {
  state = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, ...next }))
  } catch {
    // Storage unavailable; the in-memory state still drives this session.
  }
  emit()
}

export function isEnabled(key: FeatureKey, at: PluginState = state): boolean {
  return at.features[key] !== false
}

export function setFeature(key: FeatureKey, value: boolean): void {
  commit({ ...state, features: { ...state.features, [key]: value } })
}

/** Newest first, so the most recently pinned project leads the panel. */
export function setWorkspacePin(workspaceId: string, pinned: boolean): WorkspacePinChange {
  const rest = state.workspacePins.filter((id) => id !== workspaceId)
  const workspacePins = pinned ? [workspaceId, ...rest] : rest
  commit({ ...state, workspacePins })
  return { workspacePins }
}

/** What a pin write changed, so the Host store can persist exactly that. */
export interface WorkspacePinChange {
  workspacePins: string[]
}

/** Fold or unfold the pinned area. Remembered per browser, like the switches. */
export function setPinsCollapsed(pinsCollapsed: boolean): void {
  commit({ ...state, pinsCollapsed })
}

/**
 * Replace one scope's row order.
 *
 * An empty list removes the scope entirely rather than storing `[]`, so
 * "no arrangement" has exactly one representation.
 */
export function setPinnedOrder(scope: string, order: readonly string[]): void {
  const next = { ...state.pinnedOrder }
  if (order.length === 0) delete next[scope]
  else next[scope] = [...order]
  commit({ ...state, pinnedOrder: next })
}

/** Fold or unfold one pinned project's sessions. */
export function setProjectCollapsed(workspaceId: string, collapsed: boolean): void {
  const rest = state.collapsedProjects.filter((id) => id !== workspaceId)
  commit({ ...state, collapsedProjects: collapsed ? [...rest, workspaceId] : rest })
}

/** Adopt the Host's project pins without emitting a write back. */
export function adoptWorkspacePins(workspacePins: string[]): void {
  if (sameIds(workspacePins, state.workspacePins)) return
  commit({ ...state, workspacePins })
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

export function listenForPluginStateChanges(): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.storageArea !== localStorage || (event.key !== STORAGE_KEY && event.key !== null)) return
    state = load()
    emit()
  }
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener('storage', onStorage) }
}
