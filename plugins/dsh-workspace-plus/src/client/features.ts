/**
 * Per-feature switches for the row menus, persisted in localStorage.
 *
 * Every action can be turned off from the General settings page so the menu
 * never grows past what the user actually wants. Merged from
 * dsh-workspace-menu v1.2.0, minus the destructive delete actions.
 */

export type FeatureKey =
  | 'dblclick'
  | 'contextmenu'
  | 'workspacePin'
  | 'workspaceRename'
  | 'workspaceOpenExplorer'
  | 'workspaceCopyPath'
  | 'workspaceNewSession'
  | 'workspaceDelete'
  | 'sessionPin'
  | 'sessionRename'
  | 'sessionUnread'
  | 'sessionArchive'
  | 'sessionFork'
  | 'sessionCopyLink'
  | 'sessionCopyTitle'
  | 'sessionOpenWindow'
  | 'sessionOpenFolder'

export const FEATURE_KEYS: readonly FeatureKey[] = [
  'dblclick',
  'contextmenu',
  'workspacePin',
  'workspaceRename',
  'workspaceOpenExplorer',
  'workspaceCopyPath',
  'workspaceNewSession',
  'workspaceDelete',
  'sessionPin',
  'sessionRename',
  'sessionUnread',
  'sessionArchive',
  'sessionFork',
  'sessionCopyLink',
  'sessionCopyTitle',
  'sessionOpenWindow',
  'sessionOpenFolder',
]

/** Triggers are not menu rows: they decide how the menu opens at all. */
export const TRIGGER_KEYS: readonly FeatureKey[] = ['dblclick', 'contextmenu']

export const WORKSPACE_KEYS: readonly FeatureKey[] = [
  'workspacePin',
  'workspaceRename',
  'workspaceOpenExplorer',
  'workspaceCopyPath',
  'workspaceNewSession',
  'workspaceDelete',
]

export const SESSION_KEYS: readonly FeatureKey[] = [
  'sessionPin',
  'sessionRename',
  'sessionUnread',
  'sessionArchive',
  'sessionFork',
  'sessionCopyLink',
  'sessionCopyTitle',
  'sessionOpenWindow',
  'sessionOpenFolder',
]

export type FeatureMap = Record<FeatureKey, boolean>

const DEFAULT_FEATURES: FeatureMap = {
  dblclick: true,
  contextmenu: true,
  workspacePin: true,
  workspaceRename: true,
  workspaceOpenExplorer: true,
  workspaceCopyPath: true,
  workspaceNewSession: true,
  workspaceDelete: true,
  sessionPin: true,
  sessionRename: true,
  sessionUnread: true,
  sessionArchive: true,
  sessionFork: true,
  sessionCopyLink: true,
  sessionCopyTitle: true,
  sessionOpenWindow: true,
  sessionOpenFolder: true,
}

export interface MenuState {
  pinnedWorkspaces: string[]
  pinnedSessions: string[]
  unreadSessions: string[]
  features: FeatureMap
}

export const STORAGE_KEY = 'dsh-workspace-plus:v1'

const listeners = new Set<() => void>()
let state: MenuState = load()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribeMenuState(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getMenuState(): MenuState {
  return state
}

function defaultState(): MenuState {
  return {
    pinnedWorkspaces: [],
    pinnedSessions: [],
    unreadSessions: [],
    features: { ...DEFAULT_FEATURES },
  }
}

function parse(raw: string | null): MenuState {
  if (raw === null) return defaultState()
  try {
    const value = JSON.parse(raw) as Partial<MenuState>
    return {
      pinnedWorkspaces: Array.isArray(value.pinnedWorkspaces) ? value.pinnedWorkspaces : [],
      pinnedSessions: Array.isArray(value.pinnedSessions) ? value.pinnedSessions : [],
      unreadSessions: Array.isArray(value.unreadSessions) ? value.unreadSessions : [],
      features: { ...DEFAULT_FEATURES, ...(value.features ?? {}) },
    }
  } catch {
    return defaultState()
  }
}

function load(): MenuState {
  try {
    return parse(localStorage.getItem(STORAGE_KEY))
  } catch {
    // Private mode / disabled storage: keep behavior for this session only.
    return defaultState()
  }
}

function commit(next: MenuState): void {
  state = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable; the in-memory state still drives this session.
  }
  emit()
}

export function isEnabled(key: FeatureKey, at?: MenuState): boolean {
  return (at ?? state).features[key] !== false
}

export function setFeature(key: FeatureKey, value: boolean): void {
  commit({ ...state, features: { ...state.features, [key]: value } })
}

export function toggleId(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id]
}

export function setPinnedWorkspaces(ids: string[]): void {
  commit({ ...state, pinnedWorkspaces: ids })
}

export function setPinnedSessions(ids: string[]): void {
  commit({ ...state, pinnedSessions: ids })
}

export function setUnreadSessions(ids: string[]): void {
  commit({ ...state, unreadSessions: ids })
}
