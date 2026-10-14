/**
 * The row action INVENTORY: which rows exist, and in what order.
 *
 * Kept apart from `row-actions.ts` (the executors) on purpose. The inventory is
 * pure data plus two ordering functions, so it can be reasoned about and tested
 * without a browser; the executors reach services and the UI layer, which pulls
 * in stylesheets Node cannot load.
 *
 * Two surfaces render these lists:
 *
 *   - the pinned area draws its own menus and therefore needs BOTH halves;
 *   - the official menus get only this plugin's rows APPENDED, so they need
 *     `PLUGIN_*` alone. Re-declaring a host row there would show it twice.
 *
 * `PLUGIN_*` and `OFFICIAL_*` are disjoint, and a test asserts that.
 */

import type { WorkspacePlusKey } from './locales.ts'

/**
 * Which glyph a row shows.
 *
 * A NAME, not a component: this module is pure data so it can be tested in Node,
 * and importing the icon set would pull in stylesheets Node cannot load. The UI
 * layer maps the name to a component (`menuIcons.tsx`), which also keeps the
 * "which icon" decision in one place instead of scattered across two menus.
 *
 * The names mirror the OFFICIAL rows wherever an equivalent action exists, so a
 * plugin row beside a host row reads as the same kind of thing.
 */
export type RowIcon =
  | 'pin'
  | 'unpin'
  | 'edit'
  | 'trash'
  | 'workspaceTree'
  | 'folderOpen'
  | 'copy'
  | 'newChat'
  | 'archive'
  | 'branch'
  | 'download'
  | 'folder'

/** One menu row. */
export interface RowAction {
  id: string
  labelKey: WorkspacePlusKey
  icon: RowIcon
  /** Destructive row: red text/icon and a danger hover fill, as the host's delete row. */
  danger?: boolean
  /**
   * The row is shown but cannot run right now.
   *
   * This is for CAPABILITY, not for a Settings switch: a switch removes the row
   * entirely (`pluginProjectRows` filters on those), whereas a capability keeps
   * the menu's shape stable and just greys the one row — exporting a session that
   * is mid-export, or revealing a directory a session does not have.
   */
  disabled?: boolean
}

/** What this plugin ADDS to the official Project menu. */
export const PLUGIN_PROJECT_ACTIONS: readonly RowAction[] = [
  { id: 'pin', labelKey: 'menu.pin', icon: 'pin' },
  { id: 'editBinding', labelKey: 'menu.editBinding', icon: 'workspaceTree' },
  { id: 'openExplorer', labelKey: 'menu.openExplorer', icon: 'folderOpen' },
  { id: 'copyPath', labelKey: 'menu.copyPath', icon: 'copy' },
  { id: 'newSession', labelKey: 'menu.newSession', icon: 'newChat' },
]

/** The host's own Project rows. The panel renders them; the append does not. */
export const OFFICIAL_PROJECT_ACTIONS: readonly RowAction[] = [
  { id: 'rename', labelKey: 'menu.rename', icon: 'edit' },
  { id: 'delete', labelKey: 'menu.removeFromList', icon: 'trash', danger: true },
]

/** What this plugin ADDS to the official Session menu. */
export const PLUGIN_SESSION_ACTIONS: readonly RowAction[] = [
  { id: 'copyReference', labelKey: 'menu.copyReference', icon: 'copy' },
  { id: 'export', labelKey: 'menu.export', icon: 'download' },
  { id: 'openFolder', labelKey: 'menu.openFolder', icon: 'folder' },
]

/** The host's own Session rows, in the order DSH registers them. */
export const OFFICIAL_SESSION_ACTIONS: readonly RowAction[] = [
  { id: 'renameSession', labelKey: 'menu.renameSession', icon: 'edit' },
  { id: 'forkSession', labelKey: 'menu.forkSession', icon: 'branch' },
  { id: 'archive', labelKey: 'menu.archive', icon: 'archive' },
]

/**
 * The full Project menu a panel row shows: the host's rows, then this plugin's.
 *
 * The pin row reflects the project's ACTUAL pin state rather than assuming it is
 * pinned. That assumption was wrong for the same reason it was wrong on session
 * rows: the panel's list is re-derived from live data, and the pin executor
 * TOGGLES. A hard-coded "unpin" then does the opposite of what it says the
 * second time it is used.
 */
export function projectMenuActions(state: { pinned: boolean }): RowAction[] {
  return [
    ...OFFICIAL_PROJECT_ACTIONS,
    ...PLUGIN_PROJECT_ACTIONS.map((action) => (
      action.id === 'pin'
        ? {
            ...action,
            labelKey: (state.pinned ? 'menu.unpin' : 'menu.pin') as WorkspacePlusKey,
            icon: (state.pinned ? 'unpin' : 'pin') as RowIcon,
          }
        : action
    )),
  ]
}

/**
 * The plugin's own session rows, relabelled for the row's current state and
 * filtered by the Settings switches.
 *
 * Shared by the official-menu contribution and the panel so the two cannot
 * disagree about which rows exist, what they are called, WHICH GLYPH they carry,
 * or whether they are runnable — the panel draws its own menu, so anything that
 * diverges here shows up as the two menus looking different.
 */
export function pluginSessionRows(options: {
  exporting: boolean
  /** Whether the session has a working directory to reveal. */
  hasFolder: boolean
  enabled: Partial<Record<string, boolean>>
}): RowAction[] {
  return PLUGIN_SESSION_ACTIONS
    .filter((action) => options.enabled[action.id] !== false)
    .map((action) => {
      if (action.id === 'export') {
        return {
          ...action,
          labelKey: (options.exporting ? 'menu.exporting' : 'menu.export') as WorkspacePlusKey,
          disabled: options.exporting,
        }
      }
      if (action.id === 'openFolder') {
        return { ...action, disabled: !options.hasFolder }
      }
      return action
    })
}

/**
 * The full Session menu a panel row shows.
 *
 * The pin row reflects the session's ACTUAL pin state, because a pinned project
 * lists every session in that workspace — most of them are NOT individually
 * pinned. Hard-coding "unpin" (as this did) offered to unpin rows that were
 * never pinned, which is how a session's pin gets silently dropped.
 *
 * The host's two rows (rename, fork, archive) and the plugin's additions follow
 * in their official order.
 */
export function sessionMenuActions(state: {
  /** Whether THIS session is in the Host's pin set. */
  pinned: boolean
  exporting: boolean
  hasFolder: boolean
  enabled?: Partial<Record<string, boolean>>
}): RowAction[] {
  return [
    state.pinned
      ? { id: 'unpinSession', labelKey: 'menu.unpinSession', icon: 'unpin' } as RowAction
      : { id: 'pinSession', labelKey: 'menu.pinSession', icon: 'pin' } as RowAction,
    ...OFFICIAL_SESSION_ACTIONS,
    ...pluginSessionRows({
      exporting: state.exporting,
      hasFolder: state.hasFolder,
      enabled: state.enabled ?? {},
    }),
  ]
}

/**
 * The plugin's project rows, relabelled for a row's current pin state and
 * filtered by the Settings switches.
 *
 * Shared by the official-menu append and the panel so the two never disagree
 * about which rows exist or what they are called.
 */
export function pluginProjectRows(
  options: {
    pinned: boolean
    enabled: Partial<Record<string, boolean>>
  },
): RowAction[] {
  return PLUGIN_PROJECT_ACTIONS
    .filter((action) => options.enabled[action.id] !== false)
    .map((action) => (
      action.id === 'pin'
        ? {
            ...action,
            labelKey: (options.pinned ? 'menu.unpin' : 'menu.pin') as WorkspacePlusKey,
            icon: (options.pinned ? 'unpin' : 'pin') as RowIcon,
          }
        : action
    ))
}
