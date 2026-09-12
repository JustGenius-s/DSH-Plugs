/**
 * A side chat's approval and ask_user_question takeovers read DSH 0.1.5's
 * session-keyed pending-interaction store — not the old `snapshot.pending`
 * array, which 0.1.5 removed. Reading the removed field is why every approval
 * and question in a side chat rendered nothing: the composer never saw a wait.
 *
 * These tests pin the recognition rules that decide whether a wait is shown at
 * all, and the answer verbs the cards call — a wait that renders but answers
 * with the wrong verb fails at click time instead of render time.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  isAnswerableWait,
  pendingInteractionsOf,
  pendingWaitOf,
  rawPendingOf,
  recognizeWait,
  waitKindOf,
  type PendingInteractionsFace,
  type SideChatWaitLike,
} from '../src/client/features/side-chat/pending'

/** A carrier stub carrying both answer verbs, as the official classes do. */
function carrier(extra: Record<string, unknown> = {}): SideChatWaitLike {
  return {
    answer: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    ...extra,
  } as unknown as SideChatWaitLike
}

function storeOf(entries: [string, SideChatWaitLike][] = []): PendingInteractionsFace {
  const listeners = new Set<() => void>()
  let map: ReadonlyMap<string, SideChatWaitLike> = new Map(entries)
  return {
    getSnapshot: () => map,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    replace(next: ReadonlyMap<string, SideChatWaitLike>) {
      map = next
      for (const listener of [...listeners]) listener()
    },
  } as PendingInteractionsFace & { replace(next: ReadonlyMap<string, SideChatWaitLike>): void }
}

describe('waitKindOf', () => {
  it('accepts the three kinds a side chat presents', () => {
    expect(waitKindOf({ kind: 'approval' })).toBe('approval')
    expect(waitKindOf({ kind: 'plan-review' })).toBe('plan-review')
    expect(waitKindOf({ kind: 'question' })).toBe('question')
  })

  it('rejects a kind the cards cannot present', () => {
    // An intent the host adds later must not render a card that answers it wrong.
    expect(waitKindOf({ kind: 'something-else' })).toBeUndefined()
    expect(waitKindOf({})).toBeUndefined()
  })
})

describe('isAnswerableWait', () => {
  it('recognizes a carrier carrying both answer verbs', () => {
    expect(isAnswerableWait(carrier())).toBe(true)
  })

  it('rejects a value that would fail at click time', () => {
    expect(isAnswerableWait(null)).toBe(false)
    expect(isAnswerableWait(undefined)).toBe(false)
    expect(isAnswerableWait('approval')).toBe(false)
    expect(isAnswerableWait({ kind: 'approval' })).toBe(false)
    expect(isAnswerableWait({ answer: () => {} })).toBe(false)
    expect(isAnswerableWait({ cancel: () => {} })).toBe(false)
  })
})

describe('recognizeWait', () => {
  it('normalizes an approval into what the card renders', () => {
    const wait = recognizeWait(carrier({
      kind: 'approval',
      key: 'a:1',
      sessionId: 'session-1',
      toolName: 'bash',
      callId: 'call-7',
      reason: 'needs privilege',
    }))
    expect(wait).toMatchObject({
      kind: 'approval',
      key: 'a:1',
      sessionId: 'session-1',
      toolName: 'bash',
      callId: 'call-7',
      reason: 'needs privilege',
    })
  })

  it('keeps the carrier so the card can answer it', () => {
    const raw = carrier({ kind: 'approval', key: 'a:1', sessionId: 's' })
    expect(recognizeWait(raw)?.wait).toBe(raw)
  })

  it('drops an empty approval reason instead of rendering an empty headline', () => {
    const wait = recognizeWait(carrier({
      kind: 'approval',
      key: 'a:1',
      sessionId: 's',
      reason: '',
    }))
    expect(wait?.reason).toBeUndefined()
  })

  it('carries the question batch through for a question wait', () => {
    const questions = [{ id: 'q1', question: 'Which one?' }]
    const wait = recognizeWait(carrier({ kind: 'question', key: 'q:1', questions }))
    expect(wait?.questions).toEqual(questions)
    expect(wait?.kind).toBe('question')
  })

  it('keeps plan-review distinct from a generic question', () => {
    // The host derives a plan review from a question batch; collapsing them
    // would answer a plan with the generic option flow.
    const wait = recognizeWait(carrier({
      kind: 'plan-review',
      key: 'q:2',
      questions: [{ id: 'p', question: 'Approve?', detail: '# plan' }],
    }))
    expect(wait?.kind).toBe('plan-review')
    expect(wait?.questions).toHaveLength(1)
  })

  it('falls back to a synthetic key so a wait without one still mounts once', () => {
    const wait = recognizeWait(carrier({ kind: 'approval', sessionId: 'session-9' }))
    expect(wait?.key).toBe('approval:session-9')
  })

  it('returns undefined for a value it cannot answer', () => {
    expect(recognizeWait(undefined)).toBeUndefined()
    expect(recognizeWait({ kind: 'approval' })).toBeUndefined()
    expect(recognizeWait(carrier({ kind: 'unknown-intent' }))).toBeUndefined()
  })
})

describe('pendingWaitOf', () => {
  it('returns the wait pending for the side chat’s own session', () => {
    const wait = carrier({ kind: 'approval', key: 'a:1', sessionId: 'side-1' })
    const store = storeOf([['side-1', wait]])
    expect(pendingWaitOf(store, 'side-1')?.key).toBe('a:1')
  })

  it('never shows another session’s wait', () => {
    // Several side chats run at once, each with its own session.
    const wait = carrier({ kind: 'approval', key: 'a:1', sessionId: 'side-1' })
    const store = storeOf([['side-1', wait]])
    expect(pendingWaitOf(store, 'side-2')).toBeUndefined()
  })

  it('survives a store that has not composed yet', () => {
    expect(pendingWaitOf(undefined, 'side-1')).toBeUndefined()
    expect(pendingWaitOf(storeOf(), undefined)).toBeUndefined()
    expect(pendingWaitOf(storeOf(), '')).toBeUndefined()
  })

  it('survives a store read that throws', () => {
    const store = {
      getSnapshot() {
        throw new Error('store not ready')
      },
      subscribe: () => () => {},
    }
    // A throwing read must not take down the panel it feeds.
    expect(pendingWaitOf(store, 'side-1')).toBeUndefined()
  })
})

describe('rawPendingOf', () => {
  it('returns the carrier itself so a uSES snapshot stays referentially stable', () => {
    const wait = carrier({ kind: 'approval', key: 'a:1', sessionId: 'side-1' })
    const store = storeOf([['side-1', wait]])
    // Identity matters: building a view here would re-render forever.
    expect(rawPendingOf(store, 'side-1')).toBe(wait)
    expect(rawPendingOf(store, 'side-1')).toBe(rawPendingOf(store, 'side-1'))
  })

  it('returns undefined when nothing is pending', () => {
    expect(rawPendingOf(storeOf(), 'side-1')).toBeUndefined()
    expect(rawPendingOf(undefined, 'side-1')).toBeUndefined()
  })
})

describe('pendingInteractionsOf', () => {
  it('resolves the store off a context carrying uiSession', () => {
    const store = storeOf()
    const ctx = { get: (name: string) => (name === 'uiSession' ? { pendingInteractions: store } : undefined) }
    expect(pendingInteractionsOf(ctx)).toBe(store)
  })

  it('returns undefined when the service is absent', () => {
    expect(pendingInteractionsOf({ get: () => undefined })).toBeUndefined()
    expect(pendingInteractionsOf({ get: () => ({}) })).toBeUndefined()
    expect(pendingInteractionsOf({ get: () => ({ pendingInteractions: {} }) })).toBeUndefined()
  })

  it('returns undefined when reading the service throws', () => {
    // Cordis throws for an undeclared service; a side chat must still render.
    const ctx = {
      get() {
        throw new Error('cannot get property "uiSession" without inject')
      },
    }
    expect(pendingInteractionsOf(ctx)).toBeUndefined()
  })
})
