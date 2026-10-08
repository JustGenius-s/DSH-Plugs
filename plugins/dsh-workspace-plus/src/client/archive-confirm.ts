/**
 * Why an archive needs confirming, and what to say when it does.
 *
 * DSH refuses to archive a session that still has work running — its turn,
 * subagent descendants, owned background jobs, or active schedules — and answers
 * with `workspace/session-active` plus a description of that work. The official
 * sidebar turns that refusal into a confirmation ("stop and archive?"), then
 * re-issues the call with `stopActivity: true`.
 *
 * This module is the decision half of that, kept pure so it can be tested in
 * Node. The important property is that it keeps three outcomes apart, because
 * collapsing them is both tempting and wrong:
 *
 *   - ARCHIVED — it went through; say nothing more.
 *   - ACTIVE — refused because work is running. ASK before stopping it, since
 *     `stopActivity: true` permanently kills a running turn and its subagents.
 *   - FAILED — refused for any other reason (a lost race, an unknown id). Asking
 *     "stop and archive?" would be the wrong question and would hide the error.
 *
 * The activity shape is the Host's, mirrored from the official
 * `ArchiveConfirmForm`/`activityLine`: a list of families, each with a `kind` and
 * the `items` being stopped. `kind` is deliberately open (`string`) because a
 * provider may contribute its own family, which the official dialog renders with
 * a generic line rather than dropping.
 */

/** One item being stopped: a label when it has one, else its id. */
export interface ActivityItem {
  id: string
  label?: string
}

/** One family of work that an archive would stop. */
export interface ActivityEntry {
  /** `turn`, `subagent`, `job`, `schedule`, or a provider-defined kind. */
  kind: string
  items: readonly ActivityItem[]
}

export type ArchiveOutcome =
  /** It was archived; nothing more to ask. */
  | { kind: 'archived' }
  /** Refused because work is running. Ask before stopping it. */
  | { kind: 'active'; activity: readonly ActivityEntry[] }
  /** Refused for any other reason. Not a confirmation case. */
  | { kind: 'failed'; error: unknown }

/**
 * Classify the outcome of an archive attempt.
 *
 * `reason === undefined` means the call RESOLVED. Anything else is a rejection,
 * which is either the confirmable refusal or a genuine failure — see
 * {@link activeWorkFrom}, which mirrors the official `activeSessionRefusal` so
 * the two surfaces agree on when to ask.
 */
export function classifyArchiveOutcome(reason: unknown): ArchiveOutcome {
  if (reason === undefined || reason === null) return { kind: 'archived' }
  const activity = activeWorkFrom(reason)
  if (activity === undefined) return { kind: 'failed', error: reason }
  return { kind: 'active', activity }
}

/**
 * The activity behind a confirmable refusal, or undefined for any other error.
 *
 * Duck-typed rather than `instanceof`: the error crosses a remote boundary, so a
 * class identity is not guaranteed on the way back, while the `name` and the RPC
 * code are part of the documented contract.
 */
export function activeWorkFrom(reason: unknown): ActivityEntry[] | undefined {
  if (!(reason instanceof Error)) return undefined
  if (reason.name !== 'WorkspaceArchiveError') return undefined
  const rpcError = (reason as { rpcError?: { code?: unknown; details?: unknown } }).rpcError
  if (rpcError?.code !== 'workspace/session-active') return undefined
  return normalizeActivity((rpcError as { details?: unknown }).details)
}

/**
 * Read the Host's activity list, tolerating a partial or unexpected shape.
 *
 * A malformed entry is DROPPED rather than turned into an empty family: the
 * dialog lists what will be stopped, and an empty row would read as "nothing".
 * A refusal with no readable detail at all still classifies as ACTIVE (the RPC
 * code is the authority), so the user is asked before work is killed.
 */
function normalizeActivity(details: unknown): ActivityEntry[] {
  // The details arrive either as the list itself or wrapped; accept both rather
  // than guessing which the transport used.
  const source = Array.isArray(details)
    ? details
    : (details !== null && typeof details === 'object' ? (details as { activity?: unknown }).activity : undefined)
  if (!Array.isArray(source)) return []
  const out: ActivityEntry[] = []
  for (const entry of source) {
    if (entry === null || typeof entry !== 'object') continue
    const { kind, items } = entry as { kind?: unknown; items?: unknown }
    if (typeof kind !== 'string' || kind === '') continue
    out.push({ kind, items: itemsOf(items) })
  }
  return out
}

/** Collect `{ id, label? }` items, ignoring anything that is not one. */
function itemsOf(value: unknown): ActivityItem[] {
  if (!Array.isArray(value)) return []
  const out: ActivityItem[] = []
  for (const entry of value) {
    if (typeof entry === 'string') { out.push({ id: entry }); continue }
    if (entry === null || typeof entry !== 'object') continue
    const { id, label } = entry as { id?: unknown; label?: unknown }
    if (typeof id !== 'string' || id === '') continue
    out.push(typeof label === 'string' && label !== '' ? { id, label } : { id })
  }
  return out
}

/** Whether the activity describes any work at all. */
export function hasActiveWork(activity: readonly ActivityEntry[]): boolean {
  return activity.some((entry) => entry.items.length > 0 || entry.kind === 'turn')
}
