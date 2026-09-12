import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// The state machine is pure, so it is extracted from app.js the same way the
// canvas tests extract their helpers.
async function loadStateMachine() {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const start = source.indexOf('/**\n * Card states, in the order the resolver checks them.')
  const end = source.indexOf('const state = {')
  const scope = { globalThis: {}, escapeHtml: value => String(value ?? '') }
  const run = new Function(`${source.slice(start, end)}
return { cardState, cardStateLabel, statusFingerprint, CARD_STATES, CARD_STATE_LABELS, PENDING_INTERACTION_HINTS }`)
  return run()
}

const done = { answer: { text: '答' }, error: null }
const empty = { answer: null, error: null }
const failed = { answer: null, error: { text: '炸了' } }

test('a pending interaction affects the active turn, not historical cards', async () => {
  const { cardState } = await loadStateMachine()
  // Nothing progresses until the user answers, so this outranks running/done.
  assert.equal(cardState(done, { pendingInteraction: 'approval' }), 'done')
  assert.equal(cardState({ ...done, isTail: true, status: 'running' }, { pendingInteraction: 'approval' }), 'needs-input')
  assert.equal(cardState(empty, { pendingInteraction: 'question', running: true }), 'needs-input')
  assert.equal(cardState(failed, { pendingInteraction: 'plan-review' }), 'failed')
})

test('each pending interaction kind gets its own actionable label', async () => {
  const { cardStateLabel } = await loadStateMachine()
  assert.equal(cardStateLabel(empty, { pendingInteraction: 'approval' }), '需要审批')
  assert.equal(cardStateLabel(empty, { pendingInteraction: 'plan-review' }), '需要确认计划')
  assert.equal(cardStateLabel(empty, { pendingInteraction: 'question' }), '需要回答问题')
  // An unknown kind still reads as 待处理 rather than falling through.
  assert.equal(cardStateLabel(empty, { pendingInteraction: 'other' }), '待处理')
})

test('a streaming or running session reports running', async () => {
  const { cardState, cardStateLabel } = await loadStateMachine()
  assert.equal(cardState(empty, { running: true }), 'running')
  // A pending synthetic card is streaming even before the host reports it.
  assert.equal(cardState({ answer: { text: '部分', pending: true }, error: null }, null), 'running')
  assert.equal(cardStateLabel(empty, { running: true }), '进行中')
})

test('a settled card stays done while a later turn is running', async () => {
  const { cardState, cardStateLabel } = await loadStateMachine()
  // Session-level running belongs to the in-flight card only.
  assert.equal(cardState(done, { running: true }), 'done')
  assert.equal(cardState(failed, { running: true }), 'failed')
  assert.equal(cardStateLabel(done, { running: true }), '已完成')
})

test('a failed turn reports failed even when the session is idle', async () => {
  const { cardState, cardStateLabel } = await loadStateMachine()
  assert.equal(cardState(failed, null), 'failed')
  assert.equal(cardState(failed, { running: false }), 'failed')
  assert.equal(cardStateLabel(failed, null), '失败')
})

test('a settled answer reports done', async () => {
  const { cardState, cardStateLabel } = await loadStateMachine()
  assert.equal(cardState(done, null), 'done')
  assert.equal(cardState(done, { running: false, completed: true }), 'done')
  assert.equal(cardStateLabel(done, null), '已完成')
})

test('an unanswered idle card reports waiting', async () => {
  const { cardState, cardStateLabel } = await loadStateMachine()
  assert.equal(cardState(empty, null), 'waiting')
  assert.equal(cardState(empty, { running: false }), 'waiting')
  assert.equal(cardStateLabel(empty, null), '等待中')
})

test('every state has a label and every label is reachable', async () => {
  const { CARD_STATES, CARD_STATE_LABELS } = await loadStateMachine()
  assert.deepEqual(CARD_STATES, ['creating', 'queued', 'needs-input', 'running', 'failed', 'cancelled', 'done', 'waiting'])
  for (const state of CARD_STATES) assert.equal(typeof CARD_STATE_LABELS[state], 'string', state)
})

test('the fingerprint only changes when a rendered state changes', async () => {
  const { statusFingerprint } = await loadStateMachine()
  const a = new Map([['s1', { running: true }], ['s2', { pendingInteraction: 'approval' }]])
  const same = new Map([['s1', { running: true, updatedAt: 999 }], ['s2', { pendingInteraction: 'approval', updatedAt: 123 }]])
  // An unrelated field (updatedAt moves on every live turn) must not cause a redraw.
  assert.equal(statusFingerprint(a), statusFingerprint(same))
  // A real state change must.
  assert.notEqual(statusFingerprint(a), statusFingerprint(new Map([['s1', { running: false }], ['s2', { pendingInteraction: 'approval' }]])))
  assert.notEqual(statusFingerprint(a), statusFingerprint(new Map([['s1', { running: true }], ['s2', {}]])))
  assert.notEqual(statusFingerprint(a), statusFingerprint(new Map([['s1', { running: true }]])))
})

test('statusFingerprint is independent of insertion order', async () => {
  const { statusFingerprint } = await loadStateMachine()
  const a = new Map([['s1', { running: true }], ['s2', { running: false }]])
  const b = new Map([['s2', { running: false }], ['s1', { running: true }]])
  assert.equal(statusFingerprint(a), statusFingerprint(b))
})
