// Row-level state for the 会话归档 settings page.
//
// Two rules shape this module:
//
// 1. A list refresh never blanks the page. `rows` is replaced only when a
//    payload arrives, so the reading status belongs to the FIRST load; every
//    later read keeps the rendered list and reports failure as a notice.
// 2. Loading belongs to the row being mutated, not to the section. A pending
//    action is tracked per session id, so deleting one row never disables or
//    hides the others.
//
// Kept free of React so the transitions are testable as plain functions.

import type { ArchivedSessionRow } from '../shared'

/** The two per-row mutations the page owns. */
export type ArchiveRowAction = 'delete' | 'unarchive'

export interface ArchiveViewState {
  /** Rows adopted from the newest list payload; untouched while a read is in flight. */
  rows: readonly ArchivedSessionRow[]
  /** True once one list payload has been adopted. */
  loaded: boolean
  /** Status of the list read; a refresh keeps `loaded` true so rows stay rendered. */
  status: 'loading' | 'ready' | 'error'
  /** Failure of the newest list read, kept as a notice once rows are loaded. */
  error: string | null
  /** In-flight mutation per session id. */
  pending: Readonly<Record<string, ArchiveRowAction>>
  /** Failure of the last mutation per session id. */
  rowErrors: Readonly<Record<string, string>>
  /** Newest issued list read; older replies are discarded. */
  readSeq: number
}

export type ArchiveViewEvent =
  | { type: 'list-start'; seq: number }
  | { type: 'list-ok'; seq: number; rows: readonly ArchivedSessionRow[] }
  | { type: 'list-failed'; seq: number; message: string }
  | { type: 'mutation-start'; id: string; action: ArchiveRowAction }
  | { type: 'mutation-settled'; id: string }
  | { type: 'mutation-failed'; id: string; message: string }
  | { type: 'row-dropped'; id: string }

export function initialArchiveView(): ArchiveViewState {
  return {
    rows: [],
    loaded: false,
    status: 'loading',
    error: null,
    pending: {},
    rowErrors: {},
    readSeq: 0,
  }
}

export function reduceArchiveView(state: ArchiveViewState, event: ArchiveViewEvent): ArchiveViewState {
  switch (event.type) {
    case 'list-start':
      // A read that a newer read already superseded changes nothing.
      if (event.seq < state.readSeq) return state
      return { ...state, readSeq: event.seq, status: 'loading', error: null }

    case 'list-ok':
      if (event.seq < state.readSeq) return state
      return {
        ...state,
        rows: [...event.rows],
        loaded: true,
        status: 'ready',
        error: null,
        // Failures belong to rows that still exist. Pending state is NOT reset
        // here: a refresh triggered by one row must not make a row that is
        // still working look finished.
        rowErrors: pruneKeys(state.rowErrors, event.rows),
      }

    case 'list-failed':
      if (event.seq < state.readSeq) return state
      // Rows stay exactly as they are; whether this reads as a blocking failure
      // or a notice is a rendering decision (`blockingError` / `refreshNotice`).
      return { ...state, status: 'error', error: event.message }

    case 'mutation-start':
      return {
        ...state,
        pending: { ...state.pending, [event.id]: event.action },
        rowErrors: withoutKey(state.rowErrors, event.id),
      }

    case 'mutation-settled':
      return { ...state, pending: withoutKey(state.pending, event.id) }

    case 'mutation-failed':
      return {
        ...state,
        pending: withoutKey(state.pending, event.id),
        rowErrors: { ...state.rowErrors, [event.id]: event.message },
      }

    case 'row-dropped':
      return {
        ...state,
        rows: state.rows.filter((row) => row.id !== event.id),
        pending: withoutKey(state.pending, event.id),
        rowErrors: withoutKey(state.rowErrors, event.id),
      }
  }
}

/** A read failure before the first payload: nothing can be rendered instead. */
export function blockingError(state: ArchiveViewState): string | null {
  return state.loaded ? null : state.error
}

/** A read failure after rows were rendered: report it without dropping them. */
export function refreshNotice(state: ArchiveViewState): string | null {
  return state.loaded ? state.error : null
}

/** The action in flight for one row, if any. */
export function pendingActionOf(state: ArchiveViewState, id: string): ArchiveRowAction | undefined {
  return state.pending[id]
}

/** The last mutation failure for one row, if any. */
export function rowErrorOf(state: ArchiveViewState, id: string): string | undefined {
  return state.rowErrors[id]
}

/** Message of a thrown value, falling back to the caller's localized text. */
export function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : fallback
}

export interface RowMutationOptions {
  id: string
  action: ArchiveRowAction
  dispatch: (event: ArchiveViewEvent) => void
  /** Commit the mutation on the host. Rejection means it did NOT happen. */
  perform: () => Promise<void>
  /** Re-read the list; resolves true once fresh rows were adopted. */
  refresh: () => Promise<boolean>
  /** Localized text for a rejection with no message of its own. */
  failureMessage: string
}

/**
 * Run one row mutation and reconcile the list.
 *
 * The row keeps its pending state until `refresh` adopts fresh rows, so a
 * mutation reads as finished only when the refreshed data arrives — not when
 * the request returns. A mutation that succeeded but could not be reconciled
 * still drops the row (the host confirmed it) and leaves the refresh failure
 * to the list notice, so a stale list is never reported as a failed mutation.
 *
 * @returns 'done' when the mutation happened, 'failed' when it did not.
 */
export async function runRowMutation(options: RowMutationOptions): Promise<'done' | 'failed'> {
  const { id, action, dispatch, perform, refresh } = options
  dispatch({ type: 'mutation-start', id, action })
  try {
    await perform()
  } catch (error) {
    dispatch({ type: 'mutation-failed', id, message: failureMessage(error, options.failureMessage) })
    return 'failed'
  }
  if (await refresh()) dispatch({ type: 'mutation-settled', id })
  else dispatch({ type: 'row-dropped', id })
  return 'done'
}

/** One Workspace's archived sessions, in first-seen workspace order. */
export interface ArchiveGroup {
  key: string
  title: string
  path: string | null
  sessions: ArchivedSessionRow[]
}

export function groupSessions(sessions: readonly ArchivedSessionRow[], ungrouped: string): ArchiveGroup[] {
  const order: string[] = []
  const map = new Map<string, ArchiveGroup>()
  for (const session of sessions) {
    const key = session.workspaceId ?? 'ungrouped'
    let group = map.get(key)
    if (group === undefined) {
      group = {
        key,
        title: session.workspaceTitle || ungrouped,
        path: session.workspacePath,
        sessions: [],
      }
      map.set(key, group)
      order.push(key)
    }
    group.sessions.push(session)
  }
  return order.map((key) => map.get(key)!).filter((group) => group.sessions.length > 0)
}

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  if (!(key in record)) return record as Record<string, T>
  const next = { ...record }
  delete next[key]
  return next
}

/** Drop entries whose row no longer exists in the freshly adopted rows. */
function pruneKeys<T>(record: Readonly<Record<string, T>>, rows: readonly ArchivedSessionRow[]): Record<string, T> {
  const alive = new Set(rows.map((row) => row.id))
  let changed = false
  const next: Record<string, T> = {}
  for (const [key, value] of Object.entries(record)) {
    if (alive.has(key)) next[key] = value
    else changed = true
  }
  return changed ? next : (record as Record<string, T>)
}
