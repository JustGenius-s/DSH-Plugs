import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { apply } from '../src/index.ts'
import { PINS_PATH } from '../src/shared.ts'

const workspace = { kind: 'workspace', id: 'workspace-a' }
const session = { kind: 'session', id: 'session-a', workspaceId: workspace.id }
let home
let previousHome
let cleanups

function host(connection = { requestRejection: () => undefined }) {
  const routes = new Map()
  const disposers = []
  const context = {
    connection,
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
  }
  apply(context)
  cleanups.push(() => { for (const dispose of disposers) dispose() })
  return {
    request(method, body) {
      const request = Readable.from(body === undefined ? [] : [Buffer.from(body)])
      request.method = method
      request.headers = {}
      return new Promise((resolve) => {
        let status
        let headers
        routes.get(PINS_PATH)(request, {
          writeHead: (code, values) => { status = code; headers = values },
          end: (raw) => { resolve({ status, headers, body: JSON.parse(raw) }) },
        })
      })
    },
  }
}

beforeEach(() => {
  previousHome = process.env.DSH_HOME
  home = mkdtempSync(join(tmpdir(), 'workspace-plus-pin-routes-'))
  process.env.DSH_HOME = home
  cleanups = []
})

afterEach(() => {
  for (const cleanup of cleanups) cleanup()
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  rmSync(home, { recursive: true, force: true })
})

test('authenticated pin routes preserve mixed pins across host recreation', async () => {
  const first = host()
  const empty = await first.request('GET')
  assert.equal(empty.status, 200)
  assert.equal(empty.headers['cache-control'], 'no-store')
  assert.deepEqual(empty.body.value, { initialized: false, pins: [] })
  for (const pin of [workspace, session]) {
    const saved = await first.request('POST', JSON.stringify({ action: 'set', pin, pinned: true }))
    assert.equal(saved.status, 200)
    assert.equal(saved.body.ok, true)
  }
  const restarted = host()
  const restored = await restarted.request('GET')
  assert.deepEqual(restored.body.value, { initialized: true, pins: [session, workspace] })
  await restarted.request('POST', JSON.stringify({ action: 'set', pin: session, pinned: false }))
  assert.deepEqual((await restarted.request('GET')).body.value.pins, [workspace])
})

test('pin reads and writes enforce the host authentication decision', async () => {
  for (const status of [401, 403]) {
    const denied = host({ requestRejection: () => status })
    assert.equal((await denied.request('GET')).status, status)
    assert.equal((await denied.request('POST', JSON.stringify({ action: 'set', pin: workspace, pinned: true }))).status, status)
  }
  assert.equal((await host({}).request('GET')).status, 401)
  assert.deepEqual((await host().request('GET')).body.value, { initialized: false, pins: [] })
})

test('invalid requests cannot clear durable pins', async () => {
  const server = host()
  await server.request('POST', JSON.stringify({ action: 'set', pin: workspace, pinned: true }))
  assert.equal((await server.request('DELETE')).status, 405)
  assert.equal((await server.request('POST', '{broken')).status, 400)
  assert.equal((await server.request('POST', '{"pins":[]}')).status, 400)
  assert.equal((await server.request('POST', '{"action":"import","pins":[null]}')).status, 400)
  assert.deepEqual((await server.request('GET')).body.value.pins, [workspace])
})

test('storage errors return failure instead of a successful empty list', async () => {
  const server = host()
  const file = join(home, 'workspace-plus', 'pins.json')
  mkdirSync(join(home, 'workspace-plus'))
  writeFileSync(file, '{broken')
  assert.equal((await server.request('GET')).status, 500)
  assert.equal((await server.request('POST', JSON.stringify({ action: 'set', pin: workspace, pinned: true }))).status, 500)
  assert.equal(readFileSync(file, 'utf8'), '{broken')
})
