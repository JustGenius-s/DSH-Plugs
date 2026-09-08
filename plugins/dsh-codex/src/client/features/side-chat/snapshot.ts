/**
 * Pure reads over a side chat's conversation snapshot.
 *
 * A side chat is built asynchronously: the Chat target mounts after the
 * session appears, so the first renders see a snapshot whose `chat`,
 * `pending`, and `queue` slices do not exist yet. Reading
 * `snapshot.chat.order` directly crashed the panel with
 * "Cannot read properties of undefined (reading 'length')" and made the side
 * chat impossible to open — the same failure the other conversation surfaces
 * in this repo guard against with `?.` (see full-session-load and the sticky
 * bubble).
 *
 * These helpers live in their own module (per AGENTS.md: UI logic in a plain
 * function) so they can be tested without pulling in React or CSS.
 */

/** The slice of a conversation node these helpers actually read. */
export interface SnapshotNodeLike {
  kind?: string
  visibility?: string
}

/** The slice of a conversation snapshot these helpers actually read. */
export interface SnapshotLike {
  chat?: {
    order?: readonly string[]
    nodes?: { get(key: string): SnapshotNodeLike | undefined }
  }
  running?: boolean
  pending?: readonly unknown[]
  queue?: readonly { placement?: string }[]
}

/**
 * The parent-context rows a freshly opened side chat shows beneath its empty
 * hero.
 *
 * A new side chat's only node IS its inherited parent context, and hiding it
 * is what made this feature look broken — the user saw an empty chat with no
 * evidence the main conversation came along.
 */
export function contextRowsOf<T extends SnapshotNodeLike>(
  snapshot: SnapshotLike | undefined,
): T[] {
  return (snapshot?.chat?.order ?? [])
    .map(key => snapshot?.chat?.nodes?.get(key))
    .filter((node): node is T =>
      node !== undefined && node.kind === 'context' && node.visibility !== 'hidden')
}

/**
 * Whether the transcript has anything to show besides its empty-state hero.
 *
 * Context rows are model-facing injections, not conversation: they render
 * inside the flow once it exists, but they must not displace the empty hero.
 */
export function hasVisibleContent(snapshot: SnapshotLike): boolean {
  const order = snapshot.chat?.order ?? []
  const nodes = snapshot.chat?.nodes
  for (const key of order) {
    const node = nodes?.get(key)
    if (node === undefined || node.visibility === 'hidden') continue
    if (node.kind === 'turn-tail' || node.kind === 'context') continue
    return true
  }
  return snapshot.running === true
    || (snapshot.pending?.length ?? 0) > 0
    || (snapshot.queue ?? []).some(item => item.placement === 'steering')
}

/**
 * The queue items waiting to be injected before the next turn.
 *
 * `T` is the caller's own queue-item type — this only filters, never reshapes.
 */
export function pendingSteeringOf<T = { placement?: string }>(
  snapshot: SnapshotLike | undefined,
): T[] {
  return (snapshot?.queue ?? []).filter(item => item.placement === 'steering') as T[]
}

/**
 * The transcript's render rows: ordered nodes that actually resolved.
 *
 * `T` is the caller's own node type; a snapshot can list a key whose node has
 * not been built yet, and those are dropped rather than rendered as blank.
 */
export function chatRowsOf<T>(snapshot: SnapshotLike | undefined): T[] {
  const nodes = snapshot?.chat?.nodes
  return (snapshot?.chat?.order ?? [])
    .map(key => nodes?.get(key))
    .filter(node => node !== undefined) as T[]
}
