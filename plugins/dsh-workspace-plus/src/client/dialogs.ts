/**
 * The two dialogs the pinned area's own menus open: rename, and delete-workspace
 * confirmation.
 *
 * Both are SINGLE-REQUEST stores like `flow.ts`: a surface asks for a dialog and
 * awaits the outcome, and exactly one dialog can be pending at a time. That is
 * what lets the row menus (rendered far down inside the sidebar) drive dialogs
 * rendered once in the plugin's overlay layer.
 *
 * The snapshot identity contract is the whole trick here, and BOTH ways of getting
 * it wrong are silent failures:
 *
 *   - returning one mutated object makes `useSyncExternalStore` see no change, so
 *     React never re-renders and the dialog never appears;
 *   - returning a FRESH object on every read makes React see a change on every
 *     render, which it reports as "Maximum update depth exceeded" (React #185).
 *
 * So the snapshot is cached and replaced only when the pending dialogs actually
 * change, inside `emit()`. `getDialogs` itself stays pure and returns that same
 * cached object for as long as nothing has moved.
 */

import type { ActivityEntry } from './archive-confirm.ts'
import type { RenameTarget } from './row-actions.ts'

export interface RenameRequest {
  target: RenameTarget
  resolve: (title: string | undefined) => void
}

export interface RemoveRequest {
  workspaceId: string
  title: string
  resolve: (confirmed: boolean) => void
}

/**
 * Confirmation before archiving a session that still has work running.
 *
 * The Host refuses that archive until it is told to stop the work, and stopping
 * it is not undoable (a killed turn does not resume), so this is a real question
 * rather than a courtesy — see `archive-confirm.ts`.
 */
export interface ArchiveRequest {
  sessionId: string
  title: string
  /** The work that will be stopped, exactly as the Host described it. */
  activity: readonly ActivityEntry[]
  resolve: (confirmed: boolean) => void
}

/** What the overlay layer needs to render. A fresh object per read. */
export interface DialogState {
  readonly rename: RenameRequest | null
  readonly remove: RemoveRequest | null
  readonly archive: ArchiveRequest | null
}

let rename: RenameRequest | null = null
let remove: RemoveRequest | null = null
let archive: ArchiveRequest | null = null
const listeners = new Set<() => void>()

/** The cached snapshot. Replaced ONLY when the pending dialogs change. */
let snapshot: DialogState = { rename: null, remove: null, archive: null }

function emit(): void {
  snapshot = { rename, remove, archive }
  for (const listener of listeners) listener()
}

export function subscribeDialogs(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * The pending dialogs.
 *
 * Identity changes exactly when the content does — the contract
 * `useSyncExternalStore` requires. Calling this repeatedly without a change
 * returns the same object, which is what keeps React from looping.
 */
export function getDialogs(): DialogState {
  return snapshot
}

/**
 * Ask for a new title. Resolves the typed title, or `undefined` when dismissed —
 * so the caller can tell "cancelled" from "submitted the same name".
 */
export function askRename(target: RenameTarget): Promise<string | undefined> {
  // A second request settles the first rather than queueing: two rename dialogs
  // for one row would leave the earlier promise pending forever. Settling also
  // clears it, so the assignment below is the only live request.
  rename?.resolve(undefined)
  return new Promise((resolve) => {
    rename = {
      target,
      resolve: (title) => {
        rename = null
        emit()
        resolve(title)
      },
    }
    emit()
  })
}

/**
 * Ask before archiving a session whose work is still running.
 *
 * Resolves true when the user accepts stopping that work. A second request
 * settles the first as "no": answering a confirmation the user can no longer see
 * would be worse than declining it.
 */
export function askArchive(sessionId: string, title: string, activity: readonly ActivityEntry[]): Promise<boolean> {
  archive?.resolve(false)
  return new Promise((resolve) => {
    archive = {
      sessionId,
      title,
      activity,
      resolve: (confirmed) => {
        archive = null
        emit()
        resolve(confirmed)
      },
    }
    emit()
  })
}

/** Ask to delete a workspace from the DSH list. Resolves true when confirmed. */
export function askRemove(workspaceId: string, title: string): Promise<boolean> {
  remove?.resolve(false)
  return new Promise((resolve) => {
    remove = {
      workspaceId,
      title,
      resolve: (confirmed) => {
        remove = null
        emit()
        resolve(confirmed)
      },
    }
    emit()
  })
}
