/**
 * Add rows to the official Project (workspace) row menu.
 *
 * DSH has no slot for the workspace row menu: `ProjectRowItem` hardcodes its
 * rows (rename, delete) into a portaled `Menu`. So this module does the one
 * thing the official extension points leave open — it notices that menu opening
 * and hands its item container to React, which portals OUR rows into it.
 *
 * Portal rather than hand-built DOM: the rows then render with the official
 * `MenuItemButton`, so they inherit the list's layout, hover fill, separator
 * rhythm, keyboard walk, and post-selection focus return without copying a
 * single hashed class name.
 *
 * Ordering is what makes the association possible:
 *
 *   pointerdown on the row   (capture, 0ms)   ← we record WHICH row was asked
 *   React opens the menu     (~3ms, mutation) ← we publish that row + its host
 *
 * The open menu carries no back-reference to its row, so the pointerdown
 * capture is the only way to know whose menu it is. Nothing recorded means
 * nothing published: a menu we cannot attribute is left exactly as the
 * official code rendered it.
 *
 * Pure detection lives here; the React half is `WorkspaceMenuRows.tsx`.
 */

import { useSyncExternalStore } from 'react'

import { createMenuPointerGuard } from './menu-pointer-guard.ts'

/** Prefix of the official workspace row key. */
const WORKSPACE_PREFIX = 'workspace:'

export interface WorkspaceMenuTarget {
  workspaceId: string
  /** The official item container our rows portal into. */
  host: HTMLElement
}

/**
 * The workspace id inside one `data-row-key`, or `undefined` for anything else.
 *
 * Pure, so the recognition rules can be tested without a DOM: a session row, the
 * `overflow:` control, and an empty id all resolve to nothing rather than to a
 * guessed workspace that would put the plugin's rows on the wrong menu.
 */
export function workspaceIdOfKey(key: string | null | undefined): string | undefined {
  if (typeof key !== 'string' || !key.startsWith(WORKSPACE_PREFIX)) return undefined
  const id = key.slice(WORKSPACE_PREFIX.length)
  return id === '' ? undefined : id
}

/**
 * The workspace id a pointer event targets, or `undefined` for anything else.
 *
 * `data-row-key` is the official row contract, so this reads the declared
 * identity instead of guessing from classes. The menu trigger is the row's
 * trailing button, but a right-click anywhere on the row is also a request, so
 * any pointer inside the row counts.
 */
export function workspaceIdFromEvent(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element)) return undefined
  const row = target.closest<HTMLElement>(`[data-row-key^="${WORKSPACE_PREFIX}"]`)
  return workspaceIdOfKey(row?.getAttribute('data-row-key'))
}

/**
 * The official top-level menu currently open, or `undefined`.
 *
 * The list is portaled to `document.body` with `role="menu"` — the
 * accessibility contract, which outlives the hashed class names. A nested
 * submenu is also a `role="menu"`, so a menu inside another menu is skipped.
 */
export function findOpenMenu(root: ParentNode = document): HTMLElement | undefined {
  for (const menu of root.querySelectorAll<HTMLElement>('div[role="menu"]')) {
    if (menu.parentElement?.closest('[role="menu"]') == null) return menu
  }
  return undefined
}

/**
 * The container holding the official menu's row wrappers.
 *
 * Rows live under the list's `role="presentation"` viewport, which also
 * scrolls; appending there keeps our rows inside the scroll area and above the
 * footer, matching where a shipped row would sit.
 */
export function menuItemsHost(menu: HTMLElement): HTMLElement | undefined {
  return menu.querySelector<HTMLElement>(':scope > [role="presentation"]') ?? undefined
}

/**
 * Watch the official workspace row menu.
 *
 * Publishes `{ workspaceId, host }` while such a menu is open and `null`
 * otherwise. One instance per plugin apply; the disposer removes every listener.
 */
export function createWorkspaceMenuWatcher(): {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => WorkspaceMenuTarget | null
  /** Whether the next menu should be decorated at all (the feature switch). */
  setEnabled: (enabled: boolean) => void
  dispose: () => void
} {
  const listeners = new Set<() => void>()
  let snapshot: WorkspaceMenuTarget | null = null
  let requested: string | undefined
  let enabled = true

  const emit = (): void => {
    for (const listener of listeners) listener()
  }

  /**
   * Publish a target only when it actually differs from the current one.
   *
   * This is what keeps the watcher idempotent: the panel's rows are portaled
   * INTO the menu, so rendering them mutates the observed subtree. Comparing
   * fields rather than object identity is what stops that from re-publishing
   * and looping.
   */
  const publish = (workspaceId: string | undefined, host: HTMLElement | undefined): void => {
    if (workspaceId === undefined || host === undefined) {
      guard.release()
      if (snapshot === null) return
      snapshot = null
      emit()
      return
    }
    if (snapshot !== null && snapshot.workspaceId === workspaceId && snapshot.host === host) return
    snapshot = { workspaceId, host }
    guard.arm()
    emit()
  }

  const sync = (): void => {
    const menu = findOpenMenu()
    if (menu === undefined) {
      requested = undefined
      publish(undefined, undefined)
      return
    }
    if (!enabled || requested === undefined) return
    publish(requested, menuItemsHost(menu))
  }

  const onPointerDown = (event: Event): void => {
    if (!enabled) return
    requested = workspaceIdFromEvent(event.target)
    // The menu is not in the DOM yet; the observer below publishes it.
  }

  /**
   * Hold the open menu across the rows we inject.
   *
   * The host's Menu decides "the pointer left me" from React's enter/leave
   * simulation, which only spans ONE React tree — our injected rows are DOM
   * children of the list but React children of another root, so crossing onto
   * them reads as leaving and the menu closes 200ms later while the pointer is
   * still inside it. The guard swallows exactly that false signal; see
   * `menu-pointer-guard.ts` for the full measurement.
   *
   * Armed only while a menu we actually decorate is open, so the host's own
   * menus keep their default behaviour.
   */
  const guard = createMenuPointerGuard(() => {
    if (snapshot === null) return { menu: null, row: null }
    // The owning row is resolved by workspace id: the row carries the official
    // `data-row-key`, which is the contract this module already reads identity
    // from. Including it means the transit between trigger and list (the row's
    // own 4px of padding) counts as "still here".
    const row = document.querySelector(`[data-row-key="workspace:${snapshot.workspaceId}"]`)
    return { menu: findOpenMenu() ?? null, row }
  })

  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true })
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('contextmenu', onPointerDown, true)
  // Close any menu already open when the plugin loads with rows undecorated.
  sync()

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot: () => snapshot,
    setEnabled: (value) => { enabled = value },
    dispose: () => {
      guard.release()
      observer.disconnect()
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('contextmenu', onPointerDown, true)
      requested = undefined
      publish(undefined, undefined)
      listeners.clear()
    },
  }
}

/**
 * Close the official menu the way its own keyboard path does.
 *
 * The menu's owner holds the open state, and a shipped row reports selection
 * through its own `onSelect`. An appended row has no such channel, and its click
 * lands inside the list — which the official outside-pointerdown handler
 * deliberately ignores — so Escape is used: the same signal the official code
 * closes on, leaving focus handling to it.
 */
export function closeWorkspaceMenu(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

/** React binding for one watcher instance. */
export function useWorkspaceMenuTarget(
  watcher: ReturnType<typeof createWorkspaceMenuWatcher>,
): WorkspaceMenuTarget | null {
  return useSyncExternalStore(watcher.subscribe, watcher.getSnapshot, watcher.getSnapshot)
}
