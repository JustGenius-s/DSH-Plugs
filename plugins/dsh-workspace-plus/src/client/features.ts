/**
 * Local menu preferences and a cache of host-persisted pins.
 *
 * Every action can be turned off from the Plugins settings page so the menu
 * never grows past what the user actually wants. Merged from
 * dsh-workspace-menu v1.2.0, minus the destructive delete actions.
 */

import { readPins, updatePin, type Pin } from './pins.ts'
import { createPinPersistence } from './pin-persistence.ts'

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
  sessionOpenFolder: true,
}

export interface MenuState {
  pins: Pin[]
  unreadSessions: string[]
  features: FeatureMap
}

export const STORAGE_KEY = 'dsh-workspace-plus:v1'

const listeners = new Set<() => void>()
let state: MenuState = load()
let pinPersistence: ReturnType<typeof createPinPersistence> | undefined
let persistenceOwners = 0

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
    pins: [],
    unreadSessions: [],
    features: { ...DEFAULT_FEATURES },
  }
}

function parse(raw: string | null): MenuState {
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
      pins: readPins(value),
      unreadSessions: Array.isArray(value.unreadSessions)
        ? value.unreadSessions.filter((id): id is string => typeof id === 'string')
        : [],
      features,
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, ...next }))
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

export function setPin(pin: Pin, pinned: boolean): Promise<void> | undefined {
  commit({ ...state, pins: updatePin(state.pins, pin, pinned) })
  return pinPersistence?.set(pin, pinned)
}

export function installPinPersistence(): () => void {
  if (pinPersistence === undefined) {
    pinPersistence = createPinPersistence({
      initial: state.pins,
      apply: (pins) => { commit({ ...state, pins }) },
      onError: (error) => { console.warn('[dsh-workspace-plus] retrying pin persistence', error) },
    })
    void pinPersistence.flush().catch((error) => {
      console.warn('[dsh-workspace-plus] pin persistence unavailable; will retry', error)
    })
  }
  persistenceOwners += 1
  return () => {
    persistenceOwners -= 1
    if (persistenceOwners !== 0) return
    pinPersistence?.dispose()
    pinPersistence = undefined
  }
}

export function setUnreadSessions(ids: string[]): void {
  commit({ ...state, unreadSessions: ids })
}

export function listenForMenuStateChanges(): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.storageArea !== localStorage || (event.key !== STORAGE_KEY && event.key !== null)) return
    state = load()
    emit()
  }
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener('storage', onStorage) }
}
