/**
 * Reading a side chat's pending host interaction.
 *
 * DSH 0.1.5 replaced the old `snapshot.pending` array with a session-keyed
 * interaction store (`uiSession.pendingInteractions`), and the carriers it
 * holds changed shape with it — `PendingApproval` / `PendingQuestion` are
 * answerable objects carrying their own `answer` / `cancel` verbs, not
 * `PendingWait`-style `respond(result)` envelopes. Side Chat was still reading
 * the old array, so every approval and every ask_user_question in a side chat
 * rendered nothing: the takeover never saw a wait.
 *
 * Pure and injectable per AGENTS.md (UI logic in a plain function) so the
 * recognition rules are testable without React, CSS, or a live client context.
 */

/** The bare observable the shared runtime boundary declares. */
export interface PendingObservable<T> {
  getSnapshot(): T
  subscribe(fn: () => void): () => void
}

/** The session-keyed pending-interaction store (`ctx.uiSession.pendingInteractions`). */
export type PendingInteractionsFace = PendingObservable<ReadonlyMap<string, SideChatWaitLike>>

/**
 * One pending interaction, structurally.
 *
 * Deliberately loose: the official carriers are exact classes without index
 * signatures, so a tighter intersection would reject them, and a plugin must
 * not import the official packages directly (see
 * scripts/check-dependency-contracts.mjs).
 */
export interface SideChatWaitLike {
  kind?: unknown
  key?: unknown
  sessionId?: unknown
  toolName?: unknown
  callId?: unknown
  reason?: unknown
  questions?: unknown
  answer?: unknown
  cancel?: unknown
}

/** Question material of a `question` / `plan-review` wait, structurally. */
export interface WaitQuestionItem {
  id?: unknown
  question?: unknown
  detail?: unknown
  header?: unknown
  multiSelect?: unknown
  options?: readonly { label?: unknown; description?: unknown }[] | unknown
  intent?: { kind?: unknown; approve?: unknown } | unknown
}

/**
 * The wait kinds a side chat can present.
 *
 * `plan-review` is distinct from `question` because the host derives it from
 * one: a plan IS a `question` batch carrying a `plan-review` intent, and the
 * shared store already holds the more specific kind for that request.
 * Distinguishing them is what keeps a plan from being answered with the
 * generic option flow.
 */
export type SideChatWaitKind = 'approval' | 'plan-review' | 'question'

/** One wait after recognition: the parts the cards actually render and answer. */
export interface SideChatWait {
  kind: SideChatWaitKind
  key: string
  sessionId: string
  wait: SideChatWaitLike
  /** Approval: the tool asking for a decision. */
  toolName?: string
  /** Approval: the correlated tool call, when the asker named one. */
  callId?: string
  /** Approval: the asker's human-readable explanation. */
  reason?: string
  /** Question: the batch to answer. */
  questions: WaitQuestionItem[]
}

/**
 * Whether an unknown value is one of the carriers the cards can answer.
 *
 * `answer` and `cancel` are the discriminant because they are the verbs the
 * cards call — a value that carries both is answerable, and one that does not
 * would fail at click time rather than at render time, which is exactly the
 * failure this module exists to prevent.
 */
export function isAnswerableWait(value: unknown): value is SideChatWaitLike {
  if (value === null || typeof value !== 'object') return false
  const record = value as { answer?: unknown; cancel?: unknown }
  return typeof record.answer === 'function' && typeof record.cancel === 'function'
}

/** Normalize one carrier's kind into the three a side chat presents. */
export function waitKindOf(wait: SideChatWaitLike): SideChatWaitKind | undefined {
  const kind = wait.kind
  if (kind === 'approval' || kind === 'plan-review' || kind === 'question') return kind
  return undefined
}

/**
 * Read the RAW carrier pending for one session, without normalizing it.
 *
 * This is the value a `useSyncExternalStore` snapshot must return: the store's
 * own object, so the snapshot is referentially equal between updates. Building
 * a view here instead would return a fresh object on every read and spin the
 * subscriber forever — recognition runs in a memo at the call site.
 *
 * @param store - the session-keyed interaction store, absent before it composes.
 * @param sessionId - the side chat's own session.
 * @returns the carrier, or undefined when nothing is pending for this session.
 */
export function rawPendingOf(
  store: PendingInteractionsFace | undefined,
  sessionId: string | undefined,
): SideChatWaitLike | undefined {
  if (store === undefined) return undefined
  if (sessionId === undefined || sessionId === '') return undefined
  try {
    return store.getSnapshot().get(sessionId as never)
  } catch {
    // A store read must never take down the panel it feeds.
    return undefined
  }
}

/**
 * Read the wait currently pending for one session, fully normalized.
 *
 * Convenience for non-reactive callers (tests, one-shot reads). React
 * consumers subscribe with {@link rawPendingOf} and memoize recognition.
 *
 * @param store - the session-keyed interaction store, absent before it composes.
 * @param sessionId - the side chat's own session; a wait belonging to another
 *   session is never shown, so several side chats can each hold their own.
 * @returns the recognized wait, or undefined when nothing is pending.
 */
export function pendingWaitOf(
  store: PendingInteractionsFace | undefined,
  sessionId: string | undefined,
): SideChatWait | undefined {
  if (store === undefined) return undefined
  if (sessionId === undefined || sessionId === '') return undefined
  let value: unknown
  try {
    value = store.getSnapshot().get(sessionId as never)
  } catch {
    // A store read must never take down the panel it feeds.
    return undefined
  }
  return recognizeWait(value)
}

/**
 * Recognize one carrier and normalize what the cards read off it.
 *
 * A carrier whose kind this feature cannot present — an intent the host adds
 * later, for instance — is dropped rather than rendered: an unrecognized wait
 * would either render an empty card or answer with the wrong verb, and the
 * main conversation stays the place to resolve it.
 */
export function recognizeWait(value: unknown): SideChatWait | undefined {
  if (!isAnswerableWait(value)) return undefined
  const kind = waitKindOf(value)
  if (kind === undefined) return undefined
  const key = typeof value.key === 'string' && value.key !== ''
    ? value.key
    : kind + ':' + String(value.sessionId ?? '')
  const base: SideChatWait = {
    kind,
    key,
    sessionId: String(value.sessionId ?? ''),
    wait: value,
    questions: [],
  }
  if (kind === 'approval') {
    return {
      ...base,
      ...(typeof value.toolName === 'string' ? { toolName: value.toolName } : {}),
      ...(typeof value.callId === 'string' ? { callId: value.callId } : {}),
      ...(typeof value.reason === 'string' && value.reason !== ''
        ? { reason: value.reason }
        : {}),
    }
  }
  return { ...base, questions: questionItemsOf(value.questions) }
}

function questionItemsOf(value: unknown): WaitQuestionItem[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is WaitQuestionItem => item !== null && typeof item === 'object',
  )
}

/**
 * Resolve the pending-interaction store off a client context.
 *
 * Read through `ctx.get` — the accessor that never throws for an undeclared
 * service — because a side chat must render even when this service has not
 * composed yet; it simply has no wait to take over the composer with.
 */
export function pendingInteractionsOf(ctx: object): PendingInteractionsFace | undefined {
  let service: unknown
  try {
    const getter = (ctx as { get?: unknown }).get
    service = typeof getter === 'function'
      ? (getter as (name: string) => unknown).call(ctx, 'uiSession')
      : (ctx as { uiSession?: unknown }).uiSession
  } catch {
    return undefined
  }
  if (service === null || typeof service !== 'object') return undefined
  const store = (service as { pendingInteractions?: unknown }).pendingInteractions
  if (store === null || typeof store !== 'object') return undefined
  const face = store as { getSnapshot?: unknown; subscribe?: unknown }
  if (typeof face.getSnapshot !== 'function' || typeof face.subscribe !== 'function') {
    return undefined
  }
  return store as PendingInteractionsFace
}
