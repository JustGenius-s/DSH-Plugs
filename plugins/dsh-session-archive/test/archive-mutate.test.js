import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../lib/index.js'

const UNARCHIVE_PATH = '/dsh-session-archive/unarchive'
const DELETE_PATH = '/dsh-session-archive/delete'

/**
 * Host context whose archive set lives in a real mutable state object, so a
 * route under test mutates it exactly the way the durable domain does.
 */
function archiveContext({ archived = ['a', 'b'], sessionIds = ['a', 'b'], native = false } = {}) {
  const state = { initialized: true, workspaceIds: ['ws'], archivedSessionIds: [...archived] }
  const routes = new Map()
  const writes = []
  let accounted = [...sessionIds]
  const ctx = {
    effect(setup) { setup() },
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => {}
      },
    },
    workspaceRegistry: {
      get archivedSessionIds() { return state.archivedSessionIds },
      list() {
        return [{
          id: 'ws',
          title: '归档测试',
          path: '/workspace/archive-test',
          sessionIds: accounted,
          async detachSession(sessionId) {
            accounted = accounted.filter((id) => String(id) !== String(sessionId))
          },
        }]
      },
      async enqueueOperation(operation) { return await operation() },
      requireState() { return state },
      async setState(next) {
        writes.push(next)
        state.initialized = next.initialized
        state.workspaceIds = next.workspaceIds
        state.archivedSessionIds = next.archivedSessionIds
      },
      // 0.1.6+ registries own the archive-set write; older ones do not.
      ...(native ? {
        async unarchiveSession(sessionId) {
          writes.push({ via: 'registry' })
          state.archivedSessionIds = state.archivedSessionIds.filter((id) => String(id) !== String(sessionId))
        },
      } : {}),
    },
    sessionPersistence: {
      async list() { return [] },
      async inspect() { return { events: [], meta: { createdAt: 1 } } },
    },
    get() { return undefined },
  }
  apply(ctx)
  return { routes, state, writes, sessionIdsOf: () => accounted }
}

/** Drive one handler with a JSON body the way the web server delivers it. */
function postJson(handler, payload) {
  return new Promise((resolve, reject) => {
    let status = 0
    const listeners = new Map()
    const request = {
      method: 'POST',
      on(event, listener) {
        listeners.set(event, listener)
        return request
      },
      destroy() {},
    }
    const response = {
      writeHead(nextStatus) { status = nextStatus },
      end(value) {
        try {
          resolve({ status, body: JSON.parse(String(value)) })
        } catch (error) {
          reject(error)
        }
      },
    }
    handler(request, response)
    // The handler attaches its listeners synchronously.
    listeners.get('data')?.(Buffer.from(JSON.stringify(payload)))
    listeners.get('end')?.()
  })
}

test('unarchive drops the session from the archive set durably', async () => {
  const ctx = archiveContext({ archived: ['a', 'b'] })
  const result = await postJson(ctx.routes.get(UNARCHIVE_PATH), { sessionId: 'a' })

  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { ok: true, value: { unarchived: true, sessionId: 'a' } })
  assert.deepEqual(ctx.state.archivedSessionIds, ['b'])
  assert.equal(ctx.writes.length, 1, 'the write must go through setState so the domain emits')
  assert.equal(ctx.sessionIdsOf().includes('a'), true, 'unarchiving must not touch workspace accounting')
})

test('unarchive uses the registry command when the host provides one', async () => {
  const ctx = archiveContext({ archived: ['a', 'b'], native: true })
  const result = await postJson(ctx.routes.get(UNARCHIVE_PATH), { sessionId: 'a' })

  assert.equal(result.status, 200)
  assert.deepEqual(ctx.state.archivedSessionIds, ['b'])
  assert.deepEqual(ctx.writes, [{ via: 'registry' }], 'the native command must do the write')
  assert.equal(ctx.sessionIdsOf().includes('a'), true, 'unarchiving must not touch workspace accounting')
})

test('unarchive falls back to the state mutators on an older registry', async () => {
  const ctx = archiveContext({ archived: ['a', 'b'], native: false })
  const result = await postJson(ctx.routes.get(UNARCHIVE_PATH), { sessionId: 'a' })

  assert.equal(result.status, 200)
  assert.deepEqual(ctx.state.archivedSessionIds, ['b'])
  assert.equal(ctx.writes.length, 1, 'the fallback must commit through setState so the domain emits')
  assert.deepEqual(ctx.writes[0].archivedSessionIds, ['b'])
})

test('unarchiving a session that is not archived is a no-op, not an error', async () => {
  const ctx = archiveContext({ archived: ['b'] })
  const result = await postJson(ctx.routes.get(UNARCHIVE_PATH), { sessionId: 'a' })

  assert.equal(result.status, 200)
  assert.deepEqual(ctx.state.archivedSessionIds, ['b'])
  assert.deepEqual(ctx.writes, [], 'an idempotent unarchive must not write')
})

test('unarchive rejects a missing sessionId and never touches the set', async () => {
  const ctx = archiveContext()
  const result = await postJson(ctx.routes.get(UNARCHIVE_PATH), {})

  assert.equal(result.status, 400)
  assert.equal(result.body.ok, false)
  assert.deepEqual(ctx.state.archivedSessionIds, ['a', 'b'])
})

test('delete detaches the workspace accounting before dropping the archive entry', async () => {
  const ctx = archiveContext({ archived: ['a'], sessionIds: ['a'] })
  const result = await postJson(ctx.routes.get(DELETE_PATH), { sessionId: 'a' })

  assert.equal(result.status, 200)
  assert.deepEqual(ctx.state.archivedSessionIds, [])
  assert.deepEqual(ctx.sessionIdsOf(), [])
})

test('post routes reject a non-POST method without mutating anything', async () => {
  const ctx = archiveContext()
  const result = await new Promise((resolve) => {
    const response = {
      writeHead(status) { this.status = status },
      end(value) { resolve({ status: this.status, body: JSON.parse(String(value)) }) },
    }
    ctx.routes.get(UNARCHIVE_PATH)({ method: 'GET' }, response)
  })

  assert.equal(result.status, 405)
  assert.deepEqual(ctx.state.archivedSessionIds, ['a', 'b'])
})
