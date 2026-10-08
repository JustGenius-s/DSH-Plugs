import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { Agent, createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../index.js'

async function harness(t) {
  const directory = await mkdtemp(join(tmpdir(), 'synapse-http-body-'))
  const routes = new Map()
  const errors = []
  apply({
    sessions: { list: () => [], get: () => undefined },
    get: () => undefined,
    webServer: { register: route => { routes.set(route.path, route.handler); return () => {} } },
    effect: callback => callback(),
    on: () => {},
    logger: { warn: error => errors.push(error), error: error => errors.push(error) },
  }, { dataFile: join(directory, 'workspaces.json'), autoProjection: false })
  const sockets = new Set()
  const server = createServer((req, res) => {
    sockets.add(req.socket)
    if (req.url === '/health') {
      res.end('ok')
      return
    }
    void routes.get('/synapse/api')(req, res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const agent = new Agent({ keepAlive: true, maxSockets: 1 })
  t.after(async () => {
    agent.destroy()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    // The store's startup backfill can still be finishing its deferred save.
    await new Promise(resolve => setTimeout(resolve, 850))
    await rm(directory, { recursive: true, force: true })
  })
  const send = (path, chunks) => new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port: server.address().port,
      path,
      method: chunks === undefined ? 'GET' : 'POST',
      agent,
      headers: { 'content-type': 'application/json' },
    }, res => {
      const body = []
      res.on('data', chunk => body.push(chunk))
      res.on('error', reject)
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(body).toString() }))
    })
    req.on('error', reject)
    req.setTimeout(1000, () => req.destroy(new Error('request stalled after rejected body')))
    for (const chunk of chunks ?? []) req.write(chunk)
    req.end()
  })
  return { send, sockets, errors }
}

test('an oversized sync drains its body and leaves the shared keep-alive socket usable', async t => {
  const h = await harness(t)
  assert.equal((await h.send('/health')).body, 'ok')
  const rejected = await h.send('/synapse/api/sessions/sync', [
    '{"sessions":[],"padding":"',
    'x'.repeat(134_000),
    '"}',
  ])
  assert.equal(rejected.status, 400)
  assert.ok(JSON.parse(rejected.body).error)
  assert.deepEqual(await h.send('/health'), { status: 200, body: 'ok' })
  assert.equal(h.sockets.size, 1, 'a rejected plugin request must not poison other API connections')
  assert.deepEqual(h.errors, [])
})

test('malformed JSON returns a validation error without closing a reusable socket', async t => {
  const h = await harness(t)
  assert.equal((await h.send('/synapse/api/sessions/sync', ['{"sessions":'])).status, 400)
  assert.equal((await h.send('/health')).body, 'ok')
  assert.equal(h.sockets.size, 1)
  assert.deepEqual(h.errors, [])
})
