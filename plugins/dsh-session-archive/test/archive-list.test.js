import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, persistenceHeaders, titleFromEvents } from '../lib/index.js'

const LIST_PATH = '/dsh-session-archive/list'

function header(id, createdAt) {
  return { id, cwd: '/workspace/archive-test', createdAt }
}

function archiveContext({ listed, live, persistence } = {}) {
  const ids = ['live-bad', 'cold-bad', 'live-iterable']
  const headers = ids.map((id, index) => header(id, 100 + index))
  const liveSessions = live ?? new Map([
    ['live-bad', { header: headers[0], events: { length: 1 } }],
    ['live-iterable', {
      header: headers[2],
      events: new Set([{ type: 'session/title', time: 999, data: { title: '恢复的归档标题' } }]),
    }],
  ])
  const routes = new Map()
  const ctx = {
    effect(setup) { setup() },
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => {}
      },
    },
    workspaceRegistry: {
      archivedSessionIds: ids,
      list() {
        return [{
          id: 'archive-workspace',
          title: '归档测试',
          path: '/workspace/archive-test',
          sessionIds: ids,
        }]
      },
    },
    sessionPersistence: persistence ?? {
      async list() { return listed ?? headers },
      async inspect(id) {
        assert.equal(String(id), 'cold-bad')
        return { events: { length: 2 }, meta: { createdAt: 222 } }
      },
    },
    get(service) {
      if (service !== 'sessions') return undefined
      return { get: (id) => liveSessions.get(String(id)) }
    },
  }
  apply(ctx)
  return routes
}

function request(handler) {
  return new Promise((resolve, reject) => {
    let status = 0
    const response = {
      writeHead(nextStatus) { status = nextStatus },
      end(body) {
        try {
          resolve({ status, body: JSON.parse(String(body)) })
        } catch (error) {
          reject(error)
        }
      },
    }
    try {
      handler({ method: 'GET' }, response)
    } catch (error) {
      reject(error)
    }
  })
}

test('persistence.list snapshots unwrap to headers', () => {
  const stored = header('fork-1', 10)
  assert.deepEqual(persistenceHeaders([{ header: stored, revision: 'r1', sizeBytes: 12 }]).map((item) => item.id), ['fork-1'])
  assert.deepEqual(persistenceHeaders([stored]).map((item) => item.id), ['fork-1'])
  assert.deepEqual(persistenceHeaders(undefined), [])
  assert.deepEqual(persistenceHeaders([{ revision: 'r' }]), [])
})

test('titleFromEvents prefers a session title, then the first user preview', () => {
  assert.equal(titleFromEvents({ length: 1 }, 'fallback').title, 'fallback')
  assert.equal(titleFromEvents([
    { type: 'user/message', time: 1, data: { content: [{ type: 'text', text: '帮我看一下登录' }] } },
    { type: 'session/title', time: 2, data: { title: '登录排查' } },
  ], 'id').title, '登录排查')
  assert.equal(titleFromEvents([
    { type: 'user/message', time: 1, data: { content: [{ type: 'text', text: '帮我看一下登录' }] } },
  ], 'id').title, '帮我看一下登录')
})

test('archive list tolerates missing and non-iterable session event logs', async () => {
  const handler = archiveContext().get(LIST_PATH)
  assert.equal(typeof handler, 'function')

  const result = await request(handler)
  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)

  const rows = new Map(result.body.value.sessions.map((row) => [row.id, row]))
  assert.equal(rows.get('live-bad').title, 'live-bad')
  assert.equal(rows.get('live-bad').updatedAt, 100)
  assert.equal(rows.get('cold-bad').title, 'cold-bad')
  assert.equal(rows.get('cold-bad').updatedAt, 222)
  assert.equal(rows.get('live-iterable').title, '恢复的归档标题')
  assert.equal(rows.get('live-iterable').updatedAt, 999)
})

test('archive list reads cold titles through persistence.open on 0.1.5 snapshots', async () => {
  const headers = [
    header('live-bad', 100),
    header('cold-bad', 101),
    header('live-iterable', 102),
  ]
  const closed = []
  const handler = archiveContext({
    live: new Map([
      ['live-bad', { header: headers[0], events: { length: 1 } }],
      ['live-iterable', {
        header: headers[2],
        snapshotEvents: () => [{ type: 'session/title', time: 999, data: { title: '恢复的归档标题' } }],
      }],
    ]),
    persistence: {
      async list() {
        return headers.map((item) => ({ header: item, revision: 'r', sizeBytes: 8 }))
      },
      async open(id, access) {
        assert.equal(access, 'read')
        assert.equal(String(id), 'cold-bad')
        return {
          header: headers[1],
          async read() {
            return {
              events: [
                { type: 'user/message', time: 310, data: { content: [{ type: 'text', text: '整理周报' }] } },
                { type: 'session/title', time: 320, data: { title: '周报整理' } },
              ],
            }
          },
          async close() { closed.push(String(id)) },
        }
      },
    },
  }).get(LIST_PATH)

  const result = await request(handler)
  assert.equal(result.status, 200)
  const rows = new Map(result.body.value.sessions.map((row) => [row.id, row]))
  assert.equal(rows.get('cold-bad').title, '周报整理')
  assert.equal(rows.get('cold-bad').updatedAt, 320)
  assert.equal(rows.get('live-iterable').title, '恢复的归档标题')
  assert.deepEqual(closed, ['cold-bad'])
})
