/**
 * The Host binding route's prune action.
 *
 * A workspace deleted through the OFFICIAL row menu is invisible to this
 * plugin's store, so the stale binding is reconciled from the client by sending
 * the live workspace paths. The dangerous direction is over-pruning: the live
 * set comes from a client snapshot, where an empty list means "not connected
 * yet", not "every workspace was deleted".
 */

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { apply } from '../src/index.ts'
import { PROJECT_PATH } from '../src/shared.ts'

let home
let previousHome
let cleanups
let live
let stale

function binding(path) {
  return { root: path, title: path.split('/').at(-1), primaryPath: path, repos: [{ name: 'f', path, kind: 'folder' }], updatedAt: 1 }
}

function host() {
  const routes = new Map()
  const disposers = []
  apply({
    connection: { requestRejection: () => undefined },
    systemPrompt: { variable() {}, context() {} },
    settings: { register() {} },
    effect: (fn) => { disposers.push(fn()) },
    webServer: {
      register: (route) => {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
  })
  cleanups.push(() => { for (const dispose of disposers) dispose() })
  return {
    request(body) {
      const req = Readable.from([Buffer.from(JSON.stringify(body))])
      req.method = 'POST'
      req.headers = {}
      // Settle on `end` (the last write), capturing the status on the way: the
      // promise must resolve, so status is recorded in a local, not assigned
      // onto `resolve` — which would silently never settle the await.
      return new Promise((resolve) => {
        let status
        routes.get(PROJECT_PATH)(req, {
          writeHead: (code) => { status = code },
          end: (raw) => { resolve({ code: status, body: JSON.parse(raw) }) },
        })
      })
    },
  }
}

function seed(bindings) {
  mkdirSync(join(home, 'workspace-plus'), { recursive: true })
  writeFileSync(join(home, 'workspace-plus', 'bindings.json'), JSON.stringify({ version: 1, bindings }))
}

function stored() {
  return JSON.parse(readFileSync(join(home, 'workspace-plus', 'bindings.json'), 'utf8')).bindings.map((b) => b.root)
}

beforeEach(() => {
  previousHome = process.env.DSH_HOME
  home = mkdtempSync(join(tmpdir(), 'workspace-plus-binding-routes-'))
  process.env.DSH_HOME = home
  cleanups = []
  mkdirSync(join(home, 'dirs'), { recursive: true })
  live = join(home, 'dirs', 'live')
  stale = join(home, 'dirs', 'stale')
  mkdirSync(live, { recursive: true })
  mkdirSync(stale, { recursive: true })
})

afterEach(() => {
  for (const cleanup of cleanups) cleanup()
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  rmSync(home, { recursive: true, force: true })
})

test('prune drops the binding whose workspace is gone and keeps the live one', async () => {
  seed([binding(live), binding(stale)])
  const res = await host().request({ action: 'prune', livePaths: [live] })
  assert.equal(res.code, 200)
  assert.deepEqual(res.body.value.removed, [stale])
  assert.deepEqual(stored(), [live])
})

test('an empty live list is refused by the Host, not honoured', async () => {
  seed([binding(live)])
  const res = await host().request({ action: 'prune', livePaths: [] })
  assert.equal(res.code, 200)
  assert.deepEqual(res.body.value.removed, [])
  assert.deepEqual(stored(), [live], 'an empty live set must never wipe the store')
})

test('a malformed prune body is rejected without touching the store', async () => {
  seed([binding(live)])
  const res = await host().request({ action: 'prune', livePaths: 'nope' })
  assert.equal(res.code, 400)
  assert.deepEqual(stored(), [live])
})

test('prune ignores non-string entries instead of treating them as paths', async () => {
  seed([binding(live)])
  const res = await host().request({ action: 'prune', livePaths: [live, null, 7, {}] })
  assert.equal(res.code, 200)
  assert.deepEqual(res.body.value.removed, [])
  assert.deepEqual(stored(), [live])
})
