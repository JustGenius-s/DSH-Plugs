import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function loadHelpers() {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const start = source.indexOf('function workspacesFingerprint')
  const end = source.indexOf('async function refreshSummaries')
  assert.ok(start !== -1 && end > start, 'fingerprint helpers must sit before refreshSummaries')
  const exports = {}
  new Function('exports', `${source.slice(start, end)}\nexports.workspacesFingerprint = workspacesFingerprint\nexports.threadsLayoutFingerprint = threadsLayoutFingerprint\nexports.nextLiveCardAnswer = nextLiveCardAnswer`)(exports)
  return exports
}

test('workspacesFingerprint ignores live-turn noise and notices membership changes', async () => {
  const { workspacesFingerprint } = await loadHelpers()
  const a = [{ id: 'w1', title: 'A', path: '/x', sessionIds: ['s1', 's2'] }]
  const same = [{ id: 'w1', title: 'A', path: '/x', sessionIds: ['s1', 's2'] }]
  const extra = [{ id: 'w1', title: 'A', path: '/x', sessionIds: ['s1', 's2', 's3'] }]
  assert.equal(workspacesFingerprint(a), workspacesFingerprint(same))
  assert.notEqual(workspacesFingerprint(a), workspacesFingerprint(extra))
})

test('threadsLayoutFingerprint ignores answer text and notices new turns', async () => {
  const { threadsLayoutFingerprint } = await loadHelpers()
  const base = [{ id: 't1', parentId: null, dshSessionId: 's1', turns: [{ seq: 1, pending: false, answer: 'old' }] }]
  const rewritten = [{ id: 't1', parentId: null, dshSessionId: 's1', turns: [{ seq: 1, pending: false, answer: 'new' }] }]
  const added = [{ id: 't1', parentId: null, dshSessionId: 's1', turns: [{ seq: 1, pending: false }, { seq: 2, pending: true }] }]
  assert.equal(threadsLayoutFingerprint(base), threadsLayoutFingerprint(rewritten))
  assert.notEqual(threadsLayoutFingerprint(base), threadsLayoutFingerprint(added))
})

test('nextLiveCardAnswer keeps existing card content instead of flashing a pending placeholder', async () => {
  const { nextLiveCardAnswer } = await loadHelpers()
  assert.deepEqual(
    nextLiveCardAnswer({ hasContent: true, hasPending: false, liveText: 'hello', nextText: '' }),
    { action: 'append-pending' },
  )
  assert.deepEqual(
    nextLiveCardAnswer({ hasContent: true, hasPending: true, liveText: 'hello', nextText: '' }),
    { action: 'keep' },
  )
  assert.deepEqual(
    nextLiveCardAnswer({ hasContent: false, hasPending: false, liveText: undefined, nextText: '' }),
    { action: 'pending' },
  )
  assert.deepEqual(
    nextLiveCardAnswer({ hasContent: true, hasPending: true, liveText: 'hello', nextText: 'hello' }),
    { action: 'keep' },
  )
  assert.deepEqual(
    nextLiveCardAnswer({ hasContent: true, hasPending: true, liveText: 'hello', nextText: 'hello world' }),
    { action: 'replace', text: 'hello world' },
  )
})
