import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const start = source.indexOf('    const SESSION_SYNC_MAX_BYTES =')
const end = source.indexOf('    // DSH 0.1.6 removed `sessions.open`', start)
assert.ok(start >= 0 && end > start)
const { sessionSyncBatches, createSessionSync } = vm.runInNewContext(
  `${source.slice(start, end)}\n({ sessionSyncBatches, createSessionSync })`,
  { TextEncoder, AbortController, console },
)
const plain = value => JSON.parse(JSON.stringify(value))
const tick = () => new Promise(resolve => setImmediate(resolve))
const row = (id, extra = {}) => ({
  id: `session-${id}`,
  title: `Session ${id}`,
  cwd: '/fixture/workspace',
  parentId: null,
  blank: false,
  ...extra,
})
const response = (status = 200) => ({ ok: status === 200, status, text: async () => '{}' })

function harness(initial, send = async () => response()) {
  let snapshot = initial
  let nextId = 0
  const timers = new Map()
  const calls = []
  const errors = []
  const sync = createSessionSync(() => snapshot, {
    setTimeout: (callback, delay) => {
      const id = ++nextId
      timers.set(id, { callback, delay })
      return id
    },
    clearTimeout: id => timers.delete(id),
    onError: error => errors.push(error),
    send: async (path, init) => {
      calls.push({ path, ...init, payload: JSON.parse(init.body) })
      return send(path, init)
    },
  })
  return {
    sync, calls, errors, timers,
    update(value) { snapshot = value; sync.schedule() },
    async flush() {
      const [id, timer] = timers.entries().next().value ?? []
      assert.ok(timer, 'expected one scheduled synchronization')
      timers.delete(id)
      timer.callback()
      await tick()
      return timer.delay
    },
  }
}

test('hundreds of multilingual sessions are batched by UTF-8 bytes below the 32 KiB API limit', () => {
  const sessions = Array.from({ length: 573 }, (_, id) => row(id, {
    title: '\u4f1a\u8bdd\u540c\u6b65'.repeat(25),
    cwd: '/fixture/\u9879\u76ee'.repeat(8),
  }))
  const removed = Array.from({ length: 600 }, (_, id) => `removed-${id}`)
  assert.ok(Buffer.byteLength(JSON.stringify({ sessions, removedSessionIds: removed })) > 32 * 1024)
  const batches = sessionSyncBatches(sessions, removed)
  assert.ok(batches.length > 1)
  for (const batch of batches) assert.ok(Buffer.byteLength(JSON.stringify(batch)) <= 24 * 1024)
  assert.deepEqual(plain(batches.flatMap(batch => batch.sessions)), sessions)
  assert.deepEqual(plain(batches.flatMap(batch => batch.removedSessionIds)), removed)
  assert.deepEqual(plain(sessionSyncBatches([], [])), [])
  assert.throws(() => sessionSyncBatches([row('large', { title: 'x'.repeat(32 * 1024) })], []), /limit/)
})

test('coalesces notifications and sends only changed persistent metadata', async t => {
  const h = harness([row(1), row(2)])
  t.after(() => h.sync.dispose())
  for (let i = 0; i < 20; i++) h.sync.schedule()
  assert.equal(h.timers.size, 1)
  await h.flush()
  assert.equal(h.calls.length, 1)
  h.update([row(1, { running: true, completed: true, pendingInteraction: 'approval' }), row(2)])
  await h.flush()
  assert.equal(h.calls.length, 1, 'status ticks must not upload the whole session list')
  h.update([row(1, { title: 'Renamed', blank: true })])
  await h.flush()
  assert.deepEqual(h.calls[1].payload, {
    sessions: [row(1, { title: 'Renamed', blank: true })],
    removedSessionIds: ['session-2'],
  })
  assert.deepEqual(h.errors, [])
})

test('keeps one request in flight and merges later snapshots after its acknowledgement', async t => {
  let acknowledge
  const h = harness([row(1)], async () => {
    if (h.calls.length === 1) return new Promise(resolve => { acknowledge = resolve })
    return response()
  })
  t.after(() => h.sync.dispose())
  h.sync.schedule()
  await h.flush()
  h.update([row(1, { title: 'intermediate' })])
  h.update([row(1, { title: 'latest' }), row(2)])
  assert.equal(h.timers.size, 0)
  assert.equal(h.calls.length, 1)
  acknowledge(response())
  await tick()
  assert.equal(h.timers.size, 1)
  await h.flush()
  assert.deepEqual(h.calls[1].payload.sessions, [row(1, { title: 'latest' }), row(2)])
  assert.equal(h.timers.size, 0)
})

test('retains unacknowledged batches and retries with backoff instead of a request storm', async t => {
  let fail = true
  const initial = Array.from({ length: 573 }, (_, id) => row(id))
  const h = harness(initial, async () => response(h.calls.length > 1 && fail ? 400 : 200))
  t.after(() => h.sync.dispose())
  h.sync.schedule()
  await h.flush()
  assert.equal(h.calls.length, 2)
  assert.equal(h.errors.length, 1)
  for (let i = 0; i < 20; i++) h.sync.schedule()
  assert.equal(h.timers.size, 1)
  assert.equal(await h.flush(), 2000)
  assert.deepEqual(h.calls[2].payload, h.calls[1].payload)
  fail = false
  assert.equal(await h.flush(), 4000)
  const accepted = [h.calls[0], ...h.calls.slice(3)].flatMap(call => call.payload.sessions)
  assert.deepEqual(accepted, initial)
  assert.equal(h.timers.size, 0)
})

test('a failed deletion is retried and a reappearing session is not later removed by stale work', async t => {
  let fail = false
  const h = harness([row(1), row(2)], async () => response(fail ? 500 : 200))
  t.after(() => h.sync.dispose())
  h.sync.schedule()
  await h.flush()
  fail = true
  h.update([row(1)])
  await h.flush()
  assert.deepEqual(h.calls[1].payload.removedSessionIds, ['session-2'])
  fail = false
  h.update([row(1), row(2)])
  await h.flush()
  assert.equal(h.calls.length, 2, 'the latest snapshot cancels the unacknowledged removal')
  h.update([row(1)])
  await h.flush()
  assert.deepEqual(h.calls[2].payload.removedSessionIds, ['session-2'])
})

test('consumes responses and treats a failed response body as an unacknowledged sync', async t => {
  let fail = true
  let reads = 0
  const h = harness([row(1)], async () => ({
    ok: true,
    status: 200,
    text: async () => {
      reads++
      if (fail) throw new Error('connection reset while reading response')
      return '{}'
    },
  }))
  t.after(() => h.sync.dispose())
  h.sync.schedule()
  await h.flush()
  fail = false
  await h.flush()
  assert.equal(reads, 2)
  assert.deepEqual(h.calls[1].payload, h.calls[0].payload)
})

test('disposal cancels queued work and aborts in-flight work without retrying', async () => {
  const queued = harness([row(1)])
  queued.sync.schedule()
  queued.sync.dispose()
  assert.equal(queued.timers.size, 0)
  assert.equal(queued.calls.length, 0)
  let acknowledge
  const active = harness([row(1)], () => new Promise(resolve => { acknowledge = resolve }))
  active.sync.schedule()
  await active.flush()
  active.update([row(2)])
  active.sync.dispose()
  assert.equal(active.calls[0].signal.aborted, true)
  acknowledge(response())
  await tick()
  active.sync.schedule()
  assert.equal(active.timers.size, 0)
  assert.deepEqual(active.errors, [])
})
