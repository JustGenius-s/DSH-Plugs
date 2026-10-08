/**
 * When an archive needs confirming, and what it reports.
 *
 * DSH refuses to archive a session that still has work running, answering with
 * `workspace/session-active` and a description of that work. Stopping it is not
 * undoable, so the refusal must become a question — and the three outcomes
 * (archived / active / failed) must stay apart. Collapsing "active" and "failed"
 * is the tempting shortcut: it would offer to kill work that was never going to
 * block the archive, and hide the real error behind an unusable confirmation.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { activeWorkFrom, classifyArchiveOutcome, hasActiveWork } =
  await import('../src/client/archive-confirm.ts')

/** Build the error the Host sends for a refused archive. */
function activeError(details, code = 'workspace/session-active') {
  const error = new Error('session is active')
  error.name = 'WorkspaceArchiveError'
  error.rpcError = { code, details }
  return error
}

test('a resolved archive needs no confirmation', () => {
  assert.deepEqual(classifyArchiveOutcome(undefined), { kind: 'archived' })
  assert.deepEqual(classifyArchiveOutcome(null), { kind: 'archived' })
})

test('the running-work refusal is the confirmable case', () => {
  const activity = [{ kind: 'turn', items: [] }]
  const outcome = classifyArchiveOutcome(activeError(activity))
  assert.equal(outcome.kind, 'active')
  assert.deepEqual(outcome.activity, activity)
})

test('any other failure is NOT turned into a confirmation', () => {
  // The regression this guards: offering "stop and archive?" for an error that
  // has nothing to do with running work hides the real reason and cannot help.
  const other = new Error('not found')
  assert.equal(classifyArchiveOutcome(other).kind, 'failed')
  assert.equal(classifyArchiveOutcome(other).error, other)

  // Correct error class, different code.
  assert.equal(classifyArchiveOutcome(activeError([], 'workspace/not-found')).kind, 'failed')
  // Correct code, different error class.
  const wrongClass = new Error('x')
  wrongClass.rpcError = { code: 'workspace/session-active', details: [] }
  assert.equal(classifyArchiveOutcome(wrongClass).kind, 'failed')
})

test('the error is recognised by name and code, not by class identity', () => {
  // It crosses a remote boundary, so `instanceof` is not reliable; the contract
  // is the name plus the RPC code.
  const error = activeError([{ kind: 'job', items: [{ id: 'j1' }] }])
  assert.equal(activeWorkFrom(error)?.length, 1)
  assert.equal(activeWorkFrom(new Error('plain')), undefined)
})

test('an unreadable activity payload still counts as active', () => {
  // The RPC code is the authority. Reporting "failed" here would skip the
  // question and kill nothing — or worse, archive without asking.
  for (const details of [undefined, null, 'nonsense', 42, {}]) {
    assert.equal(classifyArchiveOutcome(activeError(details)).kind, 'active')
  }
})

test('activity families are read with their labels, falling back to ids', () => {
  const activity = activeWorkFrom(activeError([
    { kind: 'subagent', items: [{ id: 'a1', label: '研究员' }, { id: 'a2' }] },
    { kind: 'job', items: ['bare-string'] },
  ]))
  assert.deepEqual(activity, [
    { kind: 'subagent', items: [{ id: 'a1', label: '研究员' }, { id: 'a2' }] },
    { kind: 'job', items: [{ id: 'bare-string' }] },
  ])
})

test('a malformed family is dropped rather than shown as empty', () => {
  // An empty line would read as "nothing will be stopped", which understates
  // what the confirmation is about to kill.
  const activity = activeWorkFrom(activeError([
    { kind: 'turn', items: [] },
    null,
    { items: [{ id: 'x' }] },        // no kind
    { kind: '', items: [] },          // empty kind
    { kind: 'job', items: [null, {}, { id: '' }, { id: 'ok' }] },
  ]))
  assert.deepEqual(activity, [
    { kind: 'turn', items: [] },
    { kind: 'job', items: [{ id: 'ok' }] },
  ])
})

test('a provider-defined family survives, so the dialog can still name it', () => {
  // The official dialog renders an unknown kind with a generic line instead of
  // dropping it; dropping it here would hide work from the user.
  const activity = activeWorkFrom(activeError([{ kind: 'custom-thing', items: [{ id: 'c1' }] }]))
  assert.deepEqual(activity, [{ kind: 'custom-thing', items: [{ id: 'c1' }] }])
})

test('hasActiveWork sees a bare turn as work', () => {
  // A turn has no named items, so counting items alone would call it idle.
  assert.equal(hasActiveWork([{ kind: 'turn', items: [] }]), true)
  assert.equal(hasActiveWork([{ kind: 'job', items: [{ id: 'j' }] }]), true)
  assert.equal(hasActiveWork([{ kind: 'job', items: [] }]), false)
  assert.equal(hasActiveWork([]), false)
})
