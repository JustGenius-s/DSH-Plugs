/**
 * Assemble the pinned area's rows from the two authoritative sources.
 *
 * The panel has two kinds of entry, and neither owns its own ordering:
 *
 * - **Projects (workspaces)** are pinned by THIS plugin, because DSH has no
 *   workspace pin at all. The Host half persists them under
 *   `~/.dsh/workspace-plus/pins.json`.
 * - **Sessions** are pinned by DSH itself (`UiWorkspace.pinSession`), persisted
 *   in the Workspace registry and delivered to every client through
 *   `WorkspaceSnapshot.pinnedSessionIds`. The panel only PROJECTS that list, so
 *   pinning from a session row and pinning from this panel are the same write.
 *
 * A pinned project is a GROUP, not a single row: it carries every session of that
 * workspace, whether or not the session is itself pinned. That is what makes the
 * project openable in place — the alternative (listing only the pinned sessions,
 * flattened next to the projects) both loses the membership and duplicates
 * sessions that belong to a project that is already pinned.
 *
 * A pinned session therefore appears in exactly ONE place: under its own project
 * when that project is pinned, and as a stand-alone row otherwise. Sessions of
 * projects that are not pinned have nowhere to nest, so they stand alone.
 *
 * Pure functions over plain snapshots: no DOM, no React, no services.
 */

import { TOP_SCOPE, orderByStored, projectScope, rowOrderKey } from './pinned-order.ts'

/** Minimal shape of one official workspace row, as the panel reads it. */
export interface PinnedWorkspaceView {
  id: string
  title: string
  path: string
  /** Authoritative membership from the official workspace row. */
  sessionIds: readonly string[]
}

/** Minimal shape of one session summary, as the panel reads it. */
export interface PinnedSessionView {
  id: string
  /** Human-facing label (durable title, else project basename, else id). */
  title: string
  /** Drives the fallback order of a project's sessions. */
  updatedAt: number
  /** A provisional New Session row: never listed, matching the sidebar. */
  blank?: boolean
  /** A subagent's own session: hidden by the official browser, so hidden here. */
  subagent?: boolean
}

/** One session nested under a pinned project. */
export interface PinnedChildSession {
  id: string
  title: string
  /** Epoch ms, for the row's trailing relative time (the official row has one). */
  updatedAt: number
  /** Whether it is also in the Host's pin set; those lead the group. */
  pinned: boolean
  /** The session the user is currently in. */
  current?: boolean
}

export interface PinnedProjectRow {
  kind: 'workspace'
  id: string
  title: string
  path: string
  /** Every visible session of this workspace, pinned ones first. */
  sessions: readonly PinnedChildSession[]
}

export interface PinnedSessionRow {
  kind: 'session'
  id: string
  title: string
  /** Epoch ms, for the row's trailing relative time. */
  updatedAt: number
  /** Owning workspace title, or absent for a session outside every workspace. */
  workspaceTitle?: string
  /** The session the user is currently in. */
  current?: boolean
}

export type PinnedRow = PinnedProjectRow | PinnedSessionRow

export interface PinnedRowsInput {
  /** Project pins in display order (newest first); ids with no live workspace are dropped. */
  projectPins: readonly string[]
  workspaces: readonly PinnedWorkspaceView[]
  /** Official `pinnedSessionIds`, most recently pinned first. */
  pinnedSessionIds: readonly string[]
  sessions: Readonly<Record<string, PinnedSessionView | undefined>>
  archivedSessionIds: readonly string[]
  currentSessionId?: string
  /**
   * Drag-arranged order, per scope (see `pinned-order.ts`).
   *
   * Applied ON TOP of the default ordering calculated below, because the default
   * is a live sort (pinned-first, then recency) that would otherwise discard a
   * drag the moment anything re-rendered.
   */
  order?: PinnedOrder
}

/** Stored row order per scope: `top`, plus one `project:<id>` per project. */
export type PinnedOrder = Readonly<Record<string, readonly string[]>>

export function buildPinnedRows(input: PinnedRowsInput): PinnedRow[] {
  const byId = new Map(input.workspaces.map((workspace) => [workspace.id, workspace]))
  const archived = new Set(input.archivedSessionIds)
  const pinRank = new Map(input.pinnedSessionIds.map((id, index) => [id, index]))

  /**
   * A session the panel may show, or `undefined` when it must be hidden.
   *
   * A missing summary means the list has not caught up yet, so the row is
   * omitted rather than shown with a placeholder — and omitted rather than
   * UNPINNED, so a reconnect cannot silently drop the user's pin.
   */
  const visible = (id: string): PinnedSessionView | undefined => {
    if (archived.has(id)) return undefined
    const session = input.sessions[id]
    if (session === undefined || session.blank === true || session.subagent === true) return undefined
    return session
  }

  /** Pinned sessions lead, in Host pin order; the rest follow newest first. */
  const byPriority = (a: { id: string; session: PinnedSessionView }, b: { id: string; session: PinnedSessionView }): number => {
    const rankA = pinRank.get(a.id)
    const rankB = pinRank.get(b.id)
    if (rankA !== undefined && rankB !== undefined) return rankA - rankB
    if (rankA !== undefined) return -1
    if (rankB !== undefined) return 1
    if (a.session.updatedAt !== b.session.updatedAt) return b.session.updatedAt - a.session.updatedAt
    // A stable tie-break, so the order cannot flicker between two renders.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  }

  const rows: PinnedRow[] = []
  const groupedProjects = new Set<string>()

  for (const id of input.projectPins) {
    // A duplicated pin id must render one group, not two.
    if (groupedProjects.has(id)) continue
    const workspace = byId.get(id)
    if (workspace === undefined) continue
    groupedProjects.add(id)
    const members: { id: string; session: PinnedSessionView }[] = []
    for (const sessionId of workspace.sessionIds) {
      const session = visible(sessionId)
      if (session !== undefined) members.push({ id: sessionId, session })
    }
    members.sort(byPriority)
    // A stored order only names ids the user actually arranged, so this cannot
    // resurrect a session that `visible()` filtered out.
    const arranged = orderByStored(
      members,
      input.order?.[projectScope(id)] ?? [],
      (member) => member.id,
    )
    rows.push({
      kind: 'workspace',
      id,
      title: workspace.title,
      path: workspace.path,
      sessions: arranged.map(({ id: sessionId, session }) => ({
        id: sessionId,
        title: session.title,
        updatedAt: session.updatedAt,
        pinned: pinRank.has(sessionId),
        ...(input.currentSessionId === sessionId ? { current: true } : {}),
      })),
    })
  }

  // Ownership decides whether a pinned session already has a home above.
  const owner = new Map<string, PinnedWorkspaceView>()
  for (const workspace of input.workspaces) {
    for (const sessionId of workspace.sessionIds) {
      // First workspace in host order wins, matching official membership.
      if (!owner.has(sessionId)) owner.set(sessionId, workspace)
    }
  }

  const seen = new Set<string>()
  for (const id of input.pinnedSessionIds) {
    if (seen.has(id)) continue
    const session = visible(id)
    if (session === undefined) continue
    seen.add(id)
    const parent = owner.get(id)
    // Already rendered inside its own pinned project.
    if (parent !== undefined && groupedProjects.has(parent.id)) continue
    rows.push({
      kind: 'session',
      id,
      title: session.title,
      updatedAt: session.updatedAt,
      ...(parent === undefined ? {} : { workspaceTitle: parent.title }),
      ...(input.currentSessionId === id ? { current: true } : {}),
    })
  }

  // The top level is arranged LAST, over the fully-built list, so a drag can put
  // a project row above a stand-alone session row (and back).
  return orderByStored(rows, input.order?.[TOP_SCOPE] ?? [], rowOrderKey)
}

/** Whether the panel has anything to show at all. */
export function hasPinnedRows(rows: readonly PinnedRow[]): boolean {
  return rows.length > 0
}
