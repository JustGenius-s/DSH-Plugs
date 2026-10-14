/**
 * Drag-ordering for the pinned area.
 *
 * ## Two scopes, and why they are separate
 *
 * The pinned area has two kinds of row, and they live in different lists:
 *
 *   - TOP level: project rows and stand-alone pinned sessions, in one list, so
 *     a project can be dragged above or below a session;
 *   - a project's CHILDREN: the sessions inside one group.
 *
 * A drag may only land in the scope it started in. That is the whole of the
 * "sessions inside a project can only be ordered inside it" rule, expressed as
 * one equality test rather than as a special case per drag direction: a child
 * carries its project's scope, every other row carries `top`, and scopes never
 * match across the two. So a child cannot be dropped outside its project, and a
 * top-level row cannot be dropped into a project, without either being
 * individually forbidden.
 *
 * ## Where each scope's order is stored
 *
 * The two scopes persist differently, because the host's API covers exactly one
 * of them:
 *
 *   - CHILDREN are written through DSH's `workspaces.insertSessionBefore`, the
 *     same durable call the official sidebar's own manual ordering uses.
 *     `WorkspaceView.sessionIds` is documented as "Sessions accounted to this
 *     Workspace in manual order", and the panel's member list reads that array,
 *     so a child drag edits the SAME order the official surface shows.
 *
 *     Writing it is necessary but NOT sufficient, which is easy to miss: the
 *     panel then re-sorts those members (pinned first, then by recency), so a
 *     fresh write is otherwise thrown away. Dragging the one pinned session to
 *     the bottom of its project writes the right `sessionIds` and the row still
 *     snaps back to the top. A stored override is what makes the write visible,
 *     so children carry one too.
 *
 *   - TOP rows are stored by this plugin, alongside the rest of the panel's own
 *     arrangement (which projects are folded). Neither host call fits:
 *     `insertBefore` orders the whole workspace REGISTRY, so dragging a row here
 *     would reshuffle the user's entire sidebar, and the panel renders pinned
 *     items rather than registry order; and a top-level pinned session's order
 *     comes from `pinnedSessionIds`, which the controller can only pin/unpin —
 *     it exposes no way to reorder that set.
 *
 * A consequence worth stating plainly: dragging a CHILD changes the official
 * sidebar's session order too, because it is the same data. Dragging a TOP row
 * changes only this panel.
 *
 * ## The override semantics
 *
 * A stored list names the rows the user arranged, in their order. Rows it does
 * not name keep the default ordering and are merged AFTER the named ones; this
 * is what makes the stored order survive a pin appearing or disappearing
 * elsewhere (another window, the official row menu, a reload).
 */

/** Which half of a row the pointer is over. */
export type DropPosition = 'before' | 'after'

/** The scope every top-level row belongs to. */
export const TOP_SCOPE = 'top'

/** The scope a project's children belong to. One per project, never `top`. */
export function projectScope(workspaceId: string): string {
  return `project:${workspaceId}`
}

/** The key a top-level row is stored under. Mirrors the row's React key. */
export function rowOrderKey(row: { kind: 'workspace' | 'session'; id: string }): string {
  return `${row.kind}:${row.id}`
}

/**
 * The id a row is dragged, listed, and stored under — within its scope.
 *
 * Both the drag handle and the scope's id list MUST come from this one function.
 * They are compared for equality (`moveBeside` looks the dragged id up in the
 * list), so a disagreement does not fail loudly: the lookup misses, and the drop
 * inserts a SECOND copy of the row while leaving the original in place. That is
 * exactly how this shipped the first time — top-level session rows were dragged
 * under a bare id while the list held `session:<id>`.
 *
 * The two scopes key differently on purpose:
 *
 *   - TOP rows use `kind:id`, because a project and a session are different
 *     things that could carry the same raw id;
 *   - a project's children use the bare session id, because that scope's order
 *     is handed straight to the host's `insertSessionBefore`, which speaks
 *     session ids.
 */
export function dragIdInScope(scope: string, entry: { kind: 'workspace' | 'session'; id: string }): string {
  return scope === TOP_SCOPE ? rowOrderKey(entry) : entry.id
}

/** A drag in progress: which list it started in, and which row it holds. */
export interface DragSource {
  scope: string
  id: string
}

/** Where the pointer currently is: which list, which row, which half. */
export interface DropTarget {
  scope: string
  id: string
  position: DropPosition
}

/**
 * Whether the drag may land here.
 *
 * Same scope excludes dropping a project's child anywhere but inside that same
 * project, and `id` inequality stops a row from being dropped on itself (which
 * would be a no-op that still had to write storage).
 */
export function canDrop(source: DragSource, target: DropTarget): boolean {
  return source.scope === target.scope && source.id !== target.id
}

/**
 * Move `dragged` to sit immediately beside `target`.
 *
 * Returns a NEW array. An id the list does not contain is treated as absent
 * rather than throwing: the visible list can lag a click by a frame, and a drag
 * that started against a stale row must not break the surface.
 */
export function moveBeside(
  list: readonly string[],
  dragged: string,
  target: string,
  position: DropPosition,
): string[] {
  if (dragged === target) return [...list]
  const without = list.filter((id) => id !== dragged)
  const at = without.indexOf(target)
  if (at < 0) return [...list]
  const insertAt = position === 'before' ? at : at + 1
  return [...without.slice(0, insertAt), dragged, ...without.slice(insertAt)]
}

/**
 * Apply a stored order to a list of items.
 *
 * Items the stored order names come first, in that order; everything else keeps
 * its incoming (default) relative order and follows. A stable sort is used, so
 * two items that are both unnamed never swap places between renders.
 */
export function orderByStored<T>(
  items: readonly T[],
  stored: readonly string[],
  keyOf: (item: T) => string,
): T[] {
  if (stored.length === 0) return [...items]
  const rank = new Map(stored.map((key, index) => [key, index]))
  return items
    .map((item, index) => ({ item, index, rank: rank.get(keyOf(item)) }))
    .sort((a, b) => {
      if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank
      // Named before unnamed, so an unknown row never displaces an arranged one.
      if (a.rank !== undefined) return -1
      if (b.rank !== undefined) return 1
      return a.index - b.index
    })
    .map((entry) => entry.item)
}

/**
 * The full order to store after a drop in a flat list.
 *
 * Storing the COMPLETE list (rather than only the moved id) is what makes the
 * override exact: the stored order then names every row the user could see, so
 * the next render reproduces it without depending on the default ordering.
 * Unnamed rows would otherwise be free to land somewhere else.
 */
export function orderAfterDrop(
  list: readonly string[],
  dragged: string,
  target: string,
  position: DropPosition,
): string[] {
  return moveBeside(list, dragged, target, position)
}

/**
 * Which half of a row the pointer is in, from a rect and a client Y.
 *
 * Split out from the DOM handler so the threshold is testable without a browser:
 * it is the one number that decides whether a drop lands above or below, and an
 * off-by-one here reads as "the row landed one slot off" rather than as a crash.
 * Matches the host's own `rowHalf` (top half => before).
 */
export function dropPositionAt(rect: { top: number; height: number }, clientY: number): DropPosition {
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

/** The dataTransfer payload type for a row drag. */
export const DRAG_MIME = 'application/x-dsh-workspace-plus-row'

/**
 * Build the drag payload for a row.
 *
 * JSON rather than the host's bare-id `text/plain`, because a payload has to
 * carry the SCOPE too: the top level and a project's children are different
 * lists, and the drop handler must be able to reject a cross-scope drop from the
 * payload alone. A plain string would make "top" and "project:x" indistinguishable
 * from a session id.
 */
export function encodeDragPayload(source: DragSource): string {
  return JSON.stringify(source)
}

/**
 * Read a drag payload back, or `undefined` when it is not ours.
 *
 * Hostile input is expected: any drag from anywhere on the page can reach the
 * handler, including a file drag, so an unparseable or wrongly-shaped payload
 * must read as "not a row" instead of throwing inside a DOM event handler.
 */
export function decodeDragPayload(raw: string): DragSource | undefined {
  try {
    const value = JSON.parse(raw) as unknown
    if (value === null || typeof value !== 'object') return undefined
    const { scope, id } = value as { scope?: unknown; id?: unknown }
    if (typeof scope !== 'string' || scope === '' || typeof id !== 'string' || id === '') return undefined
    return { scope, id }
  } catch {
    return undefined
  }
}

/**
 * A completed drop, in the form the host callback needs.
 *
 * A structured payload rather than `(scope, order)`: the scope is an opaque key
 * and turning `project:<id>` back into an id would mean splitting on a separator
 * the id is not guaranteed to avoid. Building the request where the scope's
 * MEANING is known keeps that coupling in one place.
 */
export type ReorderRequest =
  | { kind: 'top'; order: readonly string[] }
  | { kind: 'children'; workspaceId: string; order: readonly string[]; movedId: string }

/**
 * Build the request for a drop in some scope.
 *
 * `top` is the panel's own arrangement. A project's children are ALSO written
 * through to the host (see the header), so they arrive as `children`, carrying
 * the workspace whose membership they change and the row that moved — the host
 * call is `insertBefore`-shaped, so it needs the moved id as well as the target.
 */
export function reorderRequestFor(
  scope: string,
  order: readonly string[],
  movedId: string,
): ReorderRequest {
  const workspaceId = workspaceIdOfScope(scope)
  return workspaceId === undefined
    ? { kind: 'top', order }
    : { kind: 'children', workspaceId, order, movedId }
}

/** The workspace a project scope belongs to, or undefined for `top`. */
export function workspaceIdOfScope(scope: string): string | undefined {
  return scope.startsWith('project:') ? scope.slice('project:'.length) : undefined
}

/**
 * The row a moved row must be inserted BEFORE, given the final order.
 *
 * The host call is `insertBefore`-shaped (move X before Y), while a drop computes
 * a whole resulting list, so this is the translation between them. Returning
 * `undefined` at the tail is meaningful, not a failure: the host reads it as
 * "move to the end".
 *
 * Pure and separate because this mapping is where an off-by-one hides: taking
 * the PREDECESSOR instead of the successor produces an order that is wrong only
 * for adjacent moves, which is exactly the drag a user performs most often.
 */
export function successorAfter(
  orderedIds: readonly string[],
  movedId: string,
): string | undefined {
  const at = orderedIds.indexOf(movedId)
  if (at < 0) return undefined
  return orderedIds[at + 1]
}
