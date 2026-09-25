/**
 * Reading "this session is waiting for you" off DSH's pending-interaction store.
 *
 * A session blocked on an approval, an answer, or a plan review is not simply
 * "running": the host stops it and hands the decision to the user. DSH publishes
 * exactly that fact as a session-keyed store on `uiSession`, and the official
 * sidebar renders it as an amber dot that outranks live activity.
 *
 * The pinned area shows those same rows out of their workspace group, so it must
 * agree with the row the user would otherwise be looking at. Waiting is derived
 * here, from the same store the host uses, rather than guessed from `running`.
 *
 * Recognition is deliberately structural rather than an import of the official
 * carriers: a plugin reaches the official packages only through the shared
 * boundary, and the carriers are exact classes without index signatures, so a
 * tighter shape would reject them. An interaction kind this module does not
 * present is dropped rather than rendered — the main transcript stays the place
 * to resolve it.
 */

import { useMemo, useSyncExternalStore } from 'react'
import { CLIENT_SERVICES, type ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import type { StateDotState } from '@just-genius/dsh-plugin-ui'

/** The waits a sidebar row can present. `plan-review` is its own kind. */
export type WaitKind = 'approval' | 'plan-review' | 'question'

/** Session id → the wait holding it, for every session with a presentable one. */
export type WaitingWaits = ReadonlyMap<string, WaitKind>

/** The bare observable the host publishes `pendingInteractions` as. */
export interface PendingInteractionsFace {
  getSnapshot(): ReadonlyMap<string, unknown>
  subscribe(listener: () => void): () => void
}

/** The `subscribe` / `snapshot` pair `useSyncExternalStore` needs. */
export interface PendingSource {
  subscribe: (listener: () => void) => () => void
  snapshot: () => ReadonlyMap<string, unknown>
}

const NO_PENDING: ReadonlyMap<string, unknown> = new Map()
const NO_WAITS: WaitingWaits = new Map()

/** A store that is absent simply never reports a wait. */
const NO_SOURCE: PendingSource = {
  subscribe: () => () => undefined,
  snapshot: () => NO_PENDING,
}

/**
 * Resolve the pending-interaction store off a client context.
 *
 * Read through `ctx.get` — the accessor that never throws for an undeclared
 * service — so a host without the store still renders the panel, just without
 * waiting state. A store missing either verb is not usable as one and is
 * treated as absent, and a service that throws on read does not take the rows
 * down with it.
 */
export function pendingInteractionsOf(ctx: ClientContext | undefined): PendingInteractionsFace | undefined {
  if (ctx === undefined || typeof ctx.get !== 'function') return undefined
  try {
    const service = ctx.get(CLIENT_SERVICES.uiSession) as { pendingInteractions?: unknown } | undefined
    const store = service?.pendingInteractions
    if (store === null || typeof store !== 'object') return undefined
    const candidate = store as Partial<PendingInteractionsFace>
    if (typeof candidate.getSnapshot !== 'function' || typeof candidate.subscribe !== 'function') return undefined
    return store as PendingInteractionsFace
  } catch {
    return undefined
  }
}

/** Map one raw store value to the wait it represents, or nothing. */
export function waitKindOf(value: unknown): WaitKind | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const kind = (value as { kind?: unknown }).kind
  if (kind === 'approval' || kind === 'plan-review' || kind === 'question') return kind
  return undefined
}

/** Collect every presentable wait from a store snapshot. */
export function waitingWaitsOf(snapshot: ReadonlyMap<string, unknown> | undefined): WaitingWaits {
  if (snapshot === undefined || snapshot.size === 0) return NO_WAITS
  const waits = new Map<string, WaitKind>()
  for (const [sessionId, value] of snapshot) {
    const kind = waitKindOf(value)
    if (kind !== undefined) waits.set(sessionId, kind)
  }
  return waits.size === 0 ? NO_WAITS : waits
}

/**
 * Bind a store (or its absence) to the pair `useSyncExternalStore` needs.
 *
 * The store's own snapshot is passed through BY IDENTITY: a rebuilt map would
 * differ on every read and spin the hook forever.
 */
export function pendingSource(store: PendingInteractionsFace | undefined): PendingSource {
  if (store === undefined) return NO_SOURCE
  return {
    subscribe: (listener) => store.subscribe(listener),
    snapshot: () => store.getSnapshot(),
  }
}

/** React binding over a resolved store. */
export function useWaitingWaits(store: PendingInteractionsFace | undefined): WaitingWaits {
  const source = useMemo(() => pendingSource(store), [store])
  const snapshot = useSyncExternalStore(source.subscribe, source.snapshot, source.snapshot)
  return useMemo(() => waitingWaitsOf(snapshot), [snapshot])
}

/** The wait holding any of these sessions, if one does. */
export function anyWaitOf(sessionIds: readonly string[], waits: WaitingWaits): WaitKind | undefined {
  for (const id of sessionIds) {
    const wait = waits.get(id)
    if (wait !== undefined) return wait
  }
  return undefined
}

/** The dot one session row shows: a pending decision outranks live activity. */
export function sessionDotState(
  session: { running?: boolean; completed?: boolean },
  wait: WaitKind | undefined,
): StateDotState | undefined {
  if (wait !== undefined) return 'warning'
  if (session.running === true) return 'ongoing'
  if (session.completed === true) return 'done'
  return undefined
}
