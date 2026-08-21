/** Same-origin routes registered by the host half. */
export const INVENTORY_PATH = '/dsh-plugin-config/inventory'
export const ACTION_PATH = '/dsh-plugin-config/action'
export const OUTDATED_PATH = '/dsh-plugin-config/outdated'
export const UPDATE_PATH = '/dsh-plugin-config/update'

export const SELF_ID = 'dsh-plugin-config'
export const SELF_PACKAGE = '@just-genius/dsh-plugin-config'

export type PluginPlane = 'global' | 'session'
export type PluginOrigin = 'builtin' | 'marketplace' | 'external'
export type FiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null
export type PluginAction = 'disable' | 'enable' | 'uninstall'

export interface ManagedPlugin {
  entryId: string
  localId: string
  moduleName: string
  shortName: string
  enabled: boolean
  fiberPhase: FiberPhase
  plane: PluginPlane
  origin: PluginOrigin
  packageName: string | null
  installSpec: string | null
  catalogLabel: string | null
  nameConflict: boolean
  conflictWith: string | null
  canDisable: boolean
  canEnable: boolean
  canUninstall: boolean
  protectedReason: 'core' | 'session-owned' | 'builtin' | null
  isolate: boolean
  parentId: string | null
  userDisabled: boolean
}

export interface InventorySnapshot {
  plugins: ManagedPlugin[]
}

/** One npm-registry profile dependency that can be bumped. */
export interface PluginUpdate {
  packageName: string
  shortName: string
  current: string
  wanted: string
  latest: string
}

export interface OutdatedSnapshot {
  updates: PluginUpdate[]
  checkedAt: string
}

export interface UpdateOutcome {
  ok: boolean
  packageName?: string
  needsRestart?: boolean
  error?: string
  detail?: string
}

export interface ActionRequest {
  action: PluginAction
  entryId?: string
  packageName?: string
}

export interface ActionResult {
  ok: boolean
  action?: PluginAction
  entryId?: string
  packageName?: string
  needsRestart?: boolean
  error?: string
  detail?: string
}
