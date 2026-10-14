import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readSessionExportSource, SessionExportSourceError } from '../src/session-export-source.ts'

const header = { id: 'session-export', createdAt: 100, cwd: '/project', parentSession: 'parent' }
const events = [
  { seq: 0, type: 'user/message', surfaceOp: 'append', data: { content: [{ type: 'text', text: 'Original question' }] } },
  { seq: 1, type: 'user/message', surfaceOp: { op: 'replace', start: 0, end: 0 }, data: { content: [{ type: 'text', text: 'Compaction summary' }] } },
]

test('prefers the complete query log, including conversation replaced on the model surface', async () => {
  const source = await readSessionExportSource({
    get(name) {
      assert.equal(name, 'sessionQuery')
      return {
        async readSession(id) {
          assert.equal(id, header.id)
          return { session: header, events }
        },
        readSurface() { assert.fail('A model surface is not the full conversation') },
      }
    },
  }, header.id)
  assert.deepEqual(source, { header, events })
  assert.notEqual(source.events, events)
})

test('reads a modern live snapshot without accessing persistence', async () => {
  const source = await readSessionExportSource({
    sessions: {
      get(id) {
        assert.equal(id, header.id)
        return {
          header,
          snapshotEvents() {
            assert.equal(this.header.id, header.id)
            return events
          },
        }
      },
    },
    get sessionPersistence() { assert.fail('A live snapshot needs no persistence') },
  }, header.id)
  assert.deepEqual(source, { header, events })
})

test('accepts older live iterable logs and valid empty sessions', async () => {
  assert.deepEqual(await readSessionExportSource({
    sessions: { get: () => ({ header, events: new Set(events) }) },
  }, header.id), { header, events })
  assert.deepEqual(await readSessionExportSource({
    sessions: { get: () => ({ header, events: [] }) },
    sessionPersistence: { inspect() { assert.fail('An empty live log is authoritative') } },
  }, header.id), { header, events: [] })
})

test('reads legacy persistence inspection without loading or restoring a session', async () => {
  const source = await readSessionExportSource({
    sessions: { get: () => undefined },
    sessionPersistence: {
      inspect: async id => {
        assert.equal(id, header.id)
        return { meta: header, events }
      },
      load() { assert.fail('Export must not commit recovery') },
    },
  }, header.id)
  assert.deepEqual(source, { header, events })
})

test('accepts header-shaped inspections and falls back from a live object without a log', async () => {
  const source = await readSessionExportSource({
    sessions: { get: () => ({ header }) },
    sessionPersistence: { inspect: async () => ({ header, events }) },
  }, header.id)
  assert.deepEqual(source, { header, events })
})

test('reads the entire handle log in read-only mode and closes it', async () => {
  const calls = []
  const source = await readSessionExportSource({
    sessionPersistence: {
      async open(...args) {
        calls.push(['open', ...args])
        return {
          header,
          async read(...args) {
            calls.push(['read', ...args])
            return { events }
          },
          async close() { calls.push(['close']) },
        }
      },
    },
  }, header.id)
  assert.deepEqual(source, { header, events })
  assert.deepEqual(calls, [['open', header.id, 'read'], ['read'], ['close']])
})

test('closes a read handle on failure and preserves the read error', async () => {
  const failure = new Error('damaged log')
  let closes = 0
  await assert.rejects(readSessionExportSource({
    sessionPersistence: {
      open: async () => ({
        header,
        async read() { throw failure },
        async close() {
          closes += 1
          throw new Error('close failed too')
        },
      }),
    },
  }, header.id), error => error === failure)
  assert.equal(closes, 1)
})

test('does not fall back to stale persistence after a query or snapshot failure', async () => {
  const failure = new Error('query failed')
  await assert.rejects(readSessionExportSource({
    sessionQuery: { async readSession() { throw failure } },
    sessions: { get() { assert.fail('Read failure must propagate') } },
  }, header.id), error => error === failure)
  await assert.rejects(readSessionExportSource({
    sessions: { get: () => ({ header, snapshotEvents() { throw failure } }) },
    sessionPersistence: { inspect() { assert.fail('Read failure must propagate') } },
  }, header.id), error => error === failure)
})

test('rejects mismatched session identity through every supported source', async () => {
  const mismatched = { ...header, id: 'another-session' }
  let closes = 0
  const contexts = [
    { sessionQuery: { readSession: async () => ({ session: mismatched, events }) } },
    { sessions: { get: () => ({ header: mismatched, events }) } },
    { sessionPersistence: { inspect: async () => ({ meta: mismatched, events }) } },
    { sessionPersistence: { open: async () => ({
      header: mismatched,
      read: async () => ({ events }),
      close: async () => { closes += 1 },
    }) } },
  ]
  for (const ctx of contexts) {
    await assert.rejects(readSessionExportSource(ctx, header.id), error => (
      error instanceof SessionExportSourceError && error.status === 500 && /match/.test(error.message)
    ))
  }
  assert.equal(closes, 1)
})

test('rejects absent or malformed log data instead of exporting an empty history', async () => {
  for (const invalid of [undefined, null, '', 'not a log', {}]) {
    await assert.rejects(readSessionExportSource({
      sessionQuery: { readSession: async () => ({ session: header, events: invalid }) },
    }, header.id), error => error instanceof SessionExportSourceError && error.status === 500)
  }
})

test('rejects malformed creation metadata', async () => {
  await assert.rejects(readSessionExportSource({
    sessionQuery: { readSession: async () => ({ session: { ...header, createdAt: 'yesterday' }, events }) },
  }, header.id), error => error instanceof SessionExportSourceError && error.status === 500)
})

test('maps known missing-session failures to 404 while retaining the cause', async () => {
  const failures = [
    Object.assign(new Error('missing'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' }),
    Object.assign(new Error('missing'), { name: 'SessionPersistenceNotFoundError' }),
    Object.assign(new Error('missing'), { code: 'ENOENT' }),
    new Error(`session "${header.id}" not found`),
  ]
  for (const failure of failures) {
    await assert.rejects(readSessionExportSource({
      sessionPersistence: { async inspect() { throw failure } },
    }, header.id), error => (
      error instanceof SessionExportSourceError && error.status === 404 && error.cause === failure
    ))
  }
})

test('reports unsupported history access as 501', async () => {
  await assert.rejects(readSessionExportSource({
    sessions: { get: () => undefined },
    sessionPersistence: { load() { assert.fail('Read-only capability is required') } },
  }, header.id), error => error instanceof SessionExportSourceError && error.status === 501)
})
