import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { apply } from '../src/index.ts'
import { SESSION_EXPORT_PATH } from '../src/shared.ts'

function host(t, services = {}) {
  const routes = new Map()
  const disposers = []
  const context = {
    connection: { requestRejection: () => undefined },
    systemPrompt: { variable() {}, context() {} },
    settings: { register() {} },
    effect: (effect) => { disposers.push(effect()) },
    webServer: {
      register: (route) => {
        assert.equal(routes.has(route.path), false)
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    ...services,
  }
  apply(context)
  t.after(() => { for (const dispose of disposers) dispose() })
  return {
    context,
    routes,
    request(method, body) {
      const request = Readable.from(body === undefined ? [] : [Buffer.from(body)])
      request.method = method
      request.headers = {}
      return new Promise((resolve) => {
        let status
        let headers
        routes.get(SESSION_EXPORT_PATH)(request, {
          writeHead: (code, values) => { status = code; headers = values },
          end: (raw) => { resolve({ status, headers, body: JSON.parse(raw) }) },
        })
      })
    },
  }
}

test('authenticated export reads the requested complete log and returns a Markdown download', async (t) => {
  const requested = []
  const server = host(t, {
    sessionQuery: {
      async readSession(id) {
        requested.push(id)
        return {
          session: { id, createdAt: 1000 },
          events: [
            { type: 'session/title', data: { title: '导出/完整会话' } },
            { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '最早的用户消息' }] } },
            { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '完整答复' }] } } },
          ],
        }
      },
      readSurface() { assert.fail('Must not read a compacted surface') },
    },
  })
  const response = await server.request('POST', JSON.stringify({ sessionId: 's-1' }))
  assert.deepEqual(requested, ['s-1'])
  assert.equal(response.status, 200)
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(response.body.value.filename, '导出-完整会话.md')
  assert.ok(response.body.value.markdown.includes('最早的用户消息'))
  assert.ok(response.body.value.markdown.includes('完整答复'))
})

test('export rejects unauthorized requests before reading any session data', async (t) => {
  for (const status of [401, 403]) {
    const server = host(t, {
      connection: { requestRejection: () => status },
      sessionQuery: { readSession() { assert.fail('Must authenticate before reading') } },
    })
    assert.equal((await server.request('POST', '{"sessionId":"s-1"}')).status, status)
  }
  assert.equal((await host(t, { connection: {} }).request('POST', '{"sessionId":"s-1"}')).status, 401)
})

test('unsupported methods and invalid ids cannot reach the session service', async (t) => {
  const server = host(t, {
    sessionQuery: { readSession() { assert.fail('Invalid requests cannot read history') } },
  })
  assert.equal((await server.request('GET')).status, 405)
  assert.equal((await server.request('POST', '{broken')).status, 400)
  for (const body of [{}, null, [], { sessionId: 42 }, ...['', ' ', '.', '..', '../x', 'a\\b', 'a\0b', ' s-1', 'a'.repeat(257)].map((sessionId) => ({ sessionId }))]) {
    assert.equal((await server.request('POST', JSON.stringify(body))).status, 400)
  }
})

test('missing, corrupt and unsupported sources return failures instead of an empty export', async (t) => {
  for (const [failure, expected] of [
    [Object.assign(new Error('gone'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' }), 404],
    [new Error('corrupt log'), 500],
  ]) {
    const server = host(t, { sessionQuery: { async readSession() { throw failure } } })
    const response = await server.request('POST', '{"sessionId":"s-1"}')
    assert.equal(response.status, expected)
    assert.equal(response.body.ok, false)
    assert.equal(response.body.value, undefined)
  }
  assert.equal((await host(t).request('POST', '{"sessionId":"s-1"}')).status, 501)
})

test('duplicate plugin applies share the export route and release it on the final teardown', (t) => {
  const server = host(t)
  let secondDispose
  apply({ ...server.context, effect: (effect) => { secondDispose = effect() } })
  assert.ok(server.routes.has(SESSION_EXPORT_PATH))
  secondDispose()
  assert.ok(server.routes.has(SESSION_EXPORT_PATH))
})
