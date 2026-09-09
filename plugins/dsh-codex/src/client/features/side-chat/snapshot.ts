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

/**
 * The chat-content snapshot (`uiConversation.target('chat').getSnapshot()`).
 * Since DSH 0.1.2 this is where conversation rows live: `order` plus a `nodes`
 * keyed reader. Read loosely because the view may not be composed yet.
 */
export interface ChatLike {
  order?: readonly string[]
  nodes?: { get(key: string): SnapshotNodeLike | undefined }
}

/**
 * The control-face snapshot (`session.getSnapshot()`): queue / running /
 * pending. Since 0.1.2 this carries NO conversation rows — see the panel.
 */
export interface ControlLike {
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
  chat: ChatLike | undefined,
): T[] {
  return (chat?.order ?? [])
    .map(key => chat?.nodes?.get(key))
    .filter((node): node is T =>
      node !== undefined && node.kind === 'context' && node.visibility !== 'hidden')
}

/**
 * Whether the transcript has anything to show besides its empty-state hero.
 *
 * Context rows are model-facing injections, not conversation: they render
 * inside the flow once it exists, but they must not displace the empty hero.
 *
 * A QUEUED row counts as content. The hero was previously shown whenever the
 * only thing in flight was a `queued` prompt, so the message the user had just
 * sent was replaced by "start a conversation" — it looked like the send failed.
 */
/**
 * POST one probe payload to the host's side-chat debug sink.
 *
 * The browser console is unreachable from this GUI, so console.debug is
 * useless as a transport — this posts the observation to
 * `/dsh-codex/side-chat/debug`, which the host appends to a local trace file
 * that can be read after a single send. Best-effort and silent on failure.
 */
function postProbe(payload: Record<string, unknown>): void {
  try {
    void fetch('/dsh-codex/side-chat/debug', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // a probe must never break the panel it observes
  }
}

/**
 * Probe a snapshot's render-relevant slices and send them to the host sink.
 *
 * The side chat was "消息不渲染 / 对话流断掉" and the cause could not be
 * determined by reading types alone: the snapshot's `chat.order`, `queue`,
 * `partial` and `running` are all correct shapes on paper, yet nothing showed.
 * This records exactly what a live side-chat snapshot carries on each update,
 * so the failing slice is read from the trace instead of inferred.
 */
export function debugSnapshot(
  sessionId: string | undefined,
  control: ControlLike | undefined,
  chat: ChatLike | undefined,
): void {
  try {
    const order = chat?.order ?? []
    const nodes = chat?.nodes
    const queue = (control?.queue ?? []).map(item => ({
      placement: (item as { placement?: unknown }).placement,
    }))
    postProbe({
      kind: 'snapshot',
      sessionId,
      chatPresent: chat !== undefined,
      order: order.length,
      kinds: order.map(key => nodes?.get(key)?.kind),
      queue: queue.length,
      queuePlacements: queue,
      running: control?.running,
      pending: control?.pending?.length ?? 0,
    })
  } catch {
    // a probe must never break the panel it observes
  }
}

/**
 * Probe the result of one `session.prompt` send to the host sink.
 *
 * Whether the RPC accepted the message is the first thing to rule in or out
 * when a send looks like it did nothing: `{ok:true}` means the host took it,
 * so any missing render is downstream; `{ok:false}` or a throw is the send.
 */
export function debugPrompt(sessionId: string, result: unknown): void {
  try {
    const r = result as { ok?: unknown; error?: { message?: unknown } } | null | undefined
    postProbe({
      kind: 'prompt',
      sessionId,
      ok: r !== null && typeof r === 'object' ? r.ok : undefined,
      error: r !== null && typeof r === 'object' ? r.error?.message : undefined,
    })
  } catch {
    // a probe must never break the send it observes
  }
}

/**
 * Probe one tool block's real shape to the host sink.
 *
 * A bash call that does not render as a terminal card means the field names the
 * transcript reads (`name` / `argsRaw` / `content` / `call`) do not match what
 * this runtime's tool node actually carries. The top-level keys of the block —
 * and of its nested `call` — say which shape it is, without a browser console.
 *
 * Deduped by a per-block signature so a streaming tool does not flood the trace
 * on every chunk.
 */
const tracedToolBlocks = new Set<string>()
export function debugToolBlock(
  block: unknown,
  derived: { name: string; settled: boolean; terminal: boolean; hasCommand: boolean; outputLen: number },
): void {
  try {
    const b = block as Record<string, unknown> | null
    const call = b?.call as Record<string, unknown> | undefined
    const sig = `${derived.name}|${derived.settled}|${derived.terminal}`
    if (tracedToolBlocks.has(sig)) return
    tracedToolBlocks.add(sig)
    postProbe({
      kind: 'tool',
      ...derived,
      blockKeys: b === null || typeof b !== 'object' ? null : Object.keys(b),
      callKeys: call === undefined ? null : Object.keys(call),
      contentType: Array.isArray(b?.content) ? 'array' : typeof b?.content,
      argsRawType: typeof (b?.argsRaw ?? call?.argsRaw),
      callView: b?.callView !== undefined,
      resultView: b?.resultView !== undefined,
    })
  } catch {
    // a probe must never break the render it observes
  }
}

export function hasVisibleContent(chat: ChatLike): boolean {
  const order = chat.order ?? []
  const nodes = chat.nodes
  for (const key of order) {
    const node = nodes?.get(key)
    if (node === undefined || node.visibility === 'hidden') continue
    if (node.kind === 'turn-tail' || node.kind === 'context') continue
    return true
  }
  return false
}

/**
 * The queued rows that have not entered the log yet, as transcript bubbles.
 *
 * Three placements exist: `queued` (appended after the current turn),
 * `steering` (interrupts it), and `context` (an injected digest — model-facing,
 * never conversation). Rendering only `steering` is why a sent message looked
 * like it vanished: the composer sends with mode `'queue'`, so the item sits in
 * the queue as `queued` and stayed invisible until its turn began.
 *
 * `context` is excluded deliberately: it is the injected digest, and showing it
 * as a user bubble would claim the user said something they did not.
 *
 * `T` is the caller's own queue-item type — this only filters, never reshapes.
 */
export function queuedRowsOf<T = { placement?: string }>(
  snapshot: ControlLike | undefined,
): T[] {
  return (snapshot?.queue ?? []).filter(
    item => item?.placement === 'queued' || item?.placement === 'steering',
  ) as T[]
}

/**
 * Whether anything is waiting in the queue at all, including an injected
 * digest — the test for "a turn is already on its way".
 */
export function hasQueuedWork(snapshot: ControlLike | undefined): boolean {
  return (snapshot?.queue ?? []).length > 0
}

/**
 * The transcript's render rows: ordered nodes that actually resolved.
 *
 * `T` is the caller's own node type; a snapshot can list a key whose node has
 * not been built yet, and those are dropped rather than rendered as blank.
 */
export function chatRowsOf<T>(chat: ChatLike | undefined): T[] {
  const nodes = chat?.nodes
  return (chat?.order ?? [])
    .map(key => nodes?.get(key))
    .filter(node => node !== undefined) as T[]
}
