/**
 * Waiting-status recognition.
 *
 * A session blocked on an approval, an answer, or a plan review is not simply
 * "running" — the host stops it and hands the decision to the user, and the
 * official sidebar renders that as an amber dot that outranks live activity.
 * These rows used to read only `running` / `completed`, so a blocked pinned
 * session kept its blue "working" chase and looked identical to one that was
 * actually working.
 *
 * These pin the recognition rules (which store values become a wait) and the
 * precedence the dot follows, so a pinned row cannot disagree with the sidebar
 * row inside the workspace group.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  anyWaitOf,
  pendingInteractionsOf,
  pendingSource,
  sessionDotState,
  waitKindOf,
  waitingWaitsOf,
} = await import('../src/client/pending.ts')

/** A store stub shaped like `ctx.uiSession.pendingInteractions`. */
function storeOf(entries = []) {
  const listeners = new Set()
  let map = new Map(entries)
  return {
    getSnapshot: () => map,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    replace(next) {
      map = next
      for (const listener of [...listeners]) listener()
    },
  }
}

test('the three wait kinds a sidebar presents are recognized', () => {
  assert.equal(waitKindOf({ kind: 'approval' }), 'approval')
  assert.equal(waitKindOf({ kind: 'plan-review' }), 'plan-review')
  assert.equal(waitKindOf({ kind: 'question' }), 'question')
})

test('a kind this plugin cannot present is not a wait', () => {
  // An intent the host adds later must not turn into an amber dot that claims
  // the user owes a decision the main transcript is actually waiting on.
  assert.equal(waitKindOf({ kind: 'something-else' }), undefined)
  assert.equal(waitKindOf({}), undefined)
  assert.equal(waitKindOf(null), undefined)
  assert.equal(waitKindOf(undefined), undefined)
  assert.equal(waitKindOf('approval'), undefined)
})

test('waiting sessions are collected with their kind', () => {
  const waits = waitingWaitsOf(new Map([
    ['s1', { kind: 'approval' }],
    ['s2', { kind: 'question' }],
    ['s3', { kind: 'plan-review' }],
    ['s4', { kind: 'ignored' }],
  ]))
  assert.deepEqual([...waits], [['s1', 'approval'], ['s2', 'question'], ['s3', 'plan-review']])
})

test('an empty or absent store yields no waits', () => {
  assert.equal(waitingWaitsOf(undefined).size, 0)
  assert.equal(waitingWaitsOf(new Map()).size, 0)
  // A store holding only unrecognized kinds is as good as empty.
  assert.equal(waitingWaitsOf(new Map([['s1', { kind: 'nope' }]])).size, 0)
})

test('waiting outranks running, which outranks the done reminder', () => {
  // The regression: a blocked session kept the blue chase because only
  // `running` was consulted.
  assert.equal(sessionDotState({ running: true }, 'approval'), 'warning')
  assert.equal(sessionDotState({ running: false, completed: true }, 'question'), 'warning')
  assert.equal(sessionDotState({ running: true }, undefined), 'ongoing')
  assert.equal(sessionDotState({ running: false, completed: true }, undefined), 'done')
})

test('a session with nothing to report shows no dot', () => {
  assert.equal(sessionDotState({ running: false }, undefined), undefined)
  assert.equal(sessionDotState({}, undefined), undefined)
  assert.equal(sessionDotState({ running: false, completed: false }, undefined), undefined)
})

test('a workspace group reports the wait of any member session', () => {
  const waits = new Map([['s2', 'plan-review']])
  assert.equal(anyWaitOf(['s1', 's2'], waits), 'plan-review')
  assert.equal(anyWaitOf(['s1'], waits), undefined)
  assert.equal(anyWaitOf([], waits), undefined)
})

test('a missing uiSession service degrades to no store', () => {
  assert.equal(pendingInteractionsOf(undefined), undefined)
  // `ctx.get` on an undeclared service returns undefined rather than throwing.
  assert.equal(pendingInteractionsOf({ get: () => undefined }), undefined)
  assert.equal(pendingInteractionsOf({ get: () => ({}) }), undefined)
  assert.equal(pendingInteractionsOf({ get: () => ({ pendingInteractions: null }) }), undefined)
  // A store missing a verb is not usable as one.
  assert.equal(pendingInteractionsOf({ get: () => ({ pendingInteractions: { getSnapshot: () => new Map() } }) }), undefined)
})

test('a service that throws on read does not take down the rows', () => {
  assert.equal(pendingInteractionsOf({
    get: () => { throw new Error('service unavailable') },
  }), undefined)
})

test('the real store shape resolves', () => {
  const store = storeOf([['s1', { kind: 'approval' }]])
  const resolved = pendingInteractionsOf({ get: () => ({ pendingInteractions: store }) })
  assert.equal(resolved, store)
})

test('an absent store still yields a usable source', () => {
  // Rows must render on a host without the store; the fallback never notifies.
  const source = pendingSource(undefined)
  assert.equal(source.snapshot().size, 0)
  assert.equal(typeof source.subscribe(() => {}), 'function')
})

test('the source passes the store snapshot through by identity', () => {
  // Identity matters: a rebuilt view would differ on every read and spin
  // `useSyncExternalStore` forever.
  const store = storeOf([['s1', { kind: 'approval' }]])
  const source = pendingSource(store)
  assert.equal(source.snapshot(), store.getSnapshot())
})

test('the source forwards subscription and teardown to the store', () => {
  const store = storeOf()
  const source = pendingSource(store)
  let notified = 0
  const unsubscribe = source.subscribe(() => { notified += 1 })
  store.replace(new Map([['s1', { kind: 'approval' }]]))
  assert.equal(notified, 1)
  unsubscribe()
  store.replace(new Map())
  assert.equal(notified, 1)
})
