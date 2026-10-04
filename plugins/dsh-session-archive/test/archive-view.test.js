import assert from 'node:assert/strict'
import test from 'node:test'

import {
  blockingError,
  failureMessage,
  groupSessions,
  initialArchiveView,
  pendingActionOf,
  reduceArchiveView,
  refreshNotice,
  rowErrorOf,
  runRowMutation,
} from '../src/client/view-state.ts'

function row(id, overrides = {}) {
  return {
    id,
    title: id,
    updatedAt: 1,
    workspaceId: 'ws',
    workspaceTitle: '工作区',
    workspacePath: '/ws',
    ...overrides,
  }
}

function applied(events) {
  return events.reduce(reduceArchiveView, initialArchiveView())
}

test('a refresh never blanks the rendered rows', () => {
  let state = applied([
    { type: 'list-start', seq: 1 },
    { type: 'list-ok', seq: 1, rows: [row('a'), row('b')] },
  ])
  assert.equal(state.loaded, true)

  // The read that a delete triggers starts while the old rows are still shown.
  state = reduceArchiveView(state, { type: 'list-start', seq: 2 })
  assert.deepEqual(state.rows.map((item) => item.id), ['a', 'b'])
  assert.equal(state.loaded, true)
  assert.equal(blockingError(state), null)

  state = reduceArchiveView(state, { type: 'list-ok', seq: 2, rows: [row('a')] })
  assert.deepEqual(state.rows.map((item) => item.id), ['a'])
})

test('a refresh failure keeps the rows and reads as a notice, not a blank failure', () => {
  const loaded = applied([
    { type: 'list-start', seq: 1 },
    { type: 'list-ok', seq: 1, rows: [row('a')] },
  ])
  const failed = applied([
    { type: 'list-ok', seq: 1, rows: [row('a')] },
    { type: 'list-start', seq: 2 },
    { type: 'list-failed', seq: 2, message: 'offline' },
  ])

  assert.deepEqual(failed.rows.map((item) => item.id), ['a'])
  assert.equal(blockingError(failed), null, 'rows are rendered, so nothing is blocking')
  assert.equal(refreshNotice(failed), 'offline')
  assert.equal(blockingError(loaded), null)
  assert.equal(refreshNotice(loaded), null)
})

test('a first-load failure is blocking because no rows can be rendered', () => {
  const state = applied([
    { type: 'list-start', seq: 1 },
    { type: 'list-failed', seq: 1, message: 'offline' },
  ])
  assert.equal(blockingError(state), 'offline')
  assert.equal(refreshNotice(state), null)
  assert.equal(state.loaded, false)
})

test('a superseded read cannot overwrite newer rows or older failures', () => {
  const state = applied([
    { type: 'list-ok', seq: 1, rows: [row('a')] },
    { type: 'list-start', seq: 2 },
    { type: 'list-ok', seq: 2, rows: [row('b')] },
    // The reply of the abandoned read #1 lands late.
    { type: 'list-ok', seq: 1, rows: [row('a')] },
  ])
  assert.deepEqual(state.rows.map((item) => item.id), ['b'])
})

test('loading is tracked per row so one mutation never disables the others', () => {
  let state = applied([
    { type: 'list-ok', seq: 1, rows: [row('a'), row('b')] },
    { type: 'mutation-start', id: 'a', action: 'delete' },
  ])
  assert.equal(pendingActionOf(state, 'a'), 'delete')
  assert.equal(pendingActionOf(state, 'b'), undefined)

  state = reduceArchiveView(state, { type: 'mutation-failed', id: 'a', message: 'locked' })
  assert.equal(pendingActionOf(state, 'a'), undefined)
  assert.equal(rowErrorOf(state, 'a'), 'locked')
  assert.equal(rowErrorOf(state, 'b'), undefined)
})

test('another row\'s refresh does not settle a row that is still working', () => {
  const state = applied([
    { type: 'list-ok', seq: 1, rows: [row('a'), row('b')] },
    { type: 'mutation-start', id: 'a', action: 'unarchive' },
    { type: 'mutation-start', id: 'b', action: 'delete' },
    { type: 'list-ok', seq: 2, rows: [row('b')] },
  ])
  assert.equal(rowErrorOf(state, 'a'), undefined)
})

test('a row drops only when its own mutation settles or its data is gone', () => {
  const rows = [row('a'), row('b')]
  const settled = applied([
    { type: 'list-ok', seq: 1, rows },
    { type: 'mutation-start', id: 'a', action: 'delete' },
    { type: 'list-ok', seq: 2, rows: [row('b')] },
    { type: 'mutation-settled', id: 'a' },
  ])
  assert.deepEqual(settled.rows.map((item) => item.id), ['b'])
  assert.equal(pendingActionOf(settled, 'a'), undefined)

  const dropped = applied([
    { type: 'list-ok', seq: 1, rows },
    { type: 'mutation-start', id: 'a', action: 'unarchive' },
    { type: 'row-dropped', id: 'a' },
  ])
  assert.deepEqual(dropped.rows.map((item) => item.id), ['b'])
})

test('a failed row error clears when that row is retried', () => {
  const state = applied([
    { type: 'list-ok', seq: 1, rows: [row('a')] },
    { type: 'mutation-start', id: 'a', action: 'delete' },
    { type: 'mutation-failed', id: 'a', message: 'locked' },
    { type: 'mutation-start', id: 'a', action: 'delete' },
  ])
  assert.equal(rowErrorOf(state, 'a'), undefined)
  assert.equal(pendingActionOf(state, 'a'), 'delete')
})

test('a successful mutation holds the row busy until the refreshed list arrives', async () => {
  const events = []
  let release
  const refreshed = new Promise((resolve) => { release = resolve })
  const pending = runRowMutation({
    id: 'a',
    action: 'delete',
    dispatch: (event) => events.push(event),
    perform: async () => {},
    refresh: async () => { await refreshed; return true },
    failureMessage: '删除失败',
  })

  await Promise.resolve()
  assert.equal(events.at(-1).type, 'mutation-start')

  release()
  assert.equal(await pending, 'done')
  assert.deepEqual(events.map((event) => event.type), ['mutation-start', 'mutation-settled'])
})

test('a rejected mutation reports on its row and leaves the list alone', async () => {
  const events = []
  const outcome = await runRowMutation({
    id: 'a',
    action: 'unarchive',
    dispatch: (event) => events.push(event),
    perform: async () => { throw new Error('not archived') },
    refresh: async () => assert.fail('a rejected mutation must not re-read the list'),
    failureMessage: '取消归档失败',
  })
  assert.equal(outcome, 'failed')
  assert.deepEqual(events.map((event) => event.type), ['mutation-start', 'mutation-failed'])
  assert.equal(events.at(-1).message, 'not archived')
})

test('a mutation that cannot be reconciled still settles instead of reporting failure', async () => {
  const events = []
  const outcome = await runRowMutation({
    id: 'a',
    action: 'delete',
    dispatch: (event) => events.push(event),
    perform: async () => {},
    refresh: async () => false,
    failureMessage: '删除失败',
  })
  assert.equal(outcome, 'done', 'the host confirmed the mutation, so it did happen')
  assert.deepEqual(events.map((event) => event.type), ['mutation-start', 'row-dropped'])
})

test('failure messages fall back to localized text only when the error has none', () => {
  assert.equal(failureMessage(new Error('locked'), '删除失败'), 'locked')
  assert.equal(failureMessage(new Error('  '), '删除失败'), '删除失败')
  assert.equal(failureMessage('offline', '删除失败'), '删除失败')
})

test('sessions group by workspace in first-seen order', () => {
  const groups = groupSessions([
    row('a', { workspaceId: 'w2', workspaceTitle: '二' }),
    row('b', { workspaceId: 'w1', workspaceTitle: '一' }),
    row('c', { workspaceId: 'w2', workspaceTitle: '二' }),
    row('d', { workspaceId: null, workspaceTitle: '未分组' }),
  ], '未分组')
  assert.deepEqual(groups.map((group) => group.key), ['w2', 'w1', 'ungrouped'])
  assert.deepEqual(groups[0].sessions.map((item) => item.id), ['a', 'c'])
  assert.equal(groups[2].title, '未分组')
})
