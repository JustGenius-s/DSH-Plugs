import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { apply } from '../index.js'

const event = (seq, type, data) => ({ seq, type, data, time: seq * 1000 })
const user = (seq, text) => event(seq, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text }] })
const answer = (seq, text) => event(seq, 'assistant/message', { turn: 1, message: { content: [{ type: 'text', text }] } })

test('live routes preserve session getters, cursor identity, revisions and terminal state', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'synapse-live-api-'))
  const routes = new Map()
  const handlers = new Map()
  const errors = []
  class Session {
    id = 'live-session'
    title = 'Live'
    header = { meta: { cwd: '/fixture' } }
    log = [event(0, 'turn/start', { turn: 1 }), user(1, 'question'), answer(2, 'intermediate')]
    get events() { return this.log }
  }
  const session = new Session()
  let closes = 0
  const persistence = {
    list: async () => [],
    open: async id => {
      if (id !== 'cold-session') throw new Error('not found')
      return { read: async () => ({ events: [user(10, 'cold question'), answer(11, 'cold answer'), event(12, 'turn/end', { turn: 1, reason: { kind: 'completed' } })] }), close: async () => { closes++ } }
    },
  }
  const ctx = {
    sessions: { list: () => [session], get: id => id === session.id ? session : undefined },
    get: name => name === 'sessionPersistence' ? persistence : undefined,
    webServer: { register: route => { routes.set(route.path, route.handler); return () => {} } },
    effect: callback => callback(),
    on: (name, handler) => handlers.set(name, handler),
    logger: { warn: error => errors.push(error), error: error => errors.push(error) },
  }
  apply(ctx, { dataFile: join(directory, 'workspaces.json') })
  t.after(async () => {
    // Projection saves are coalesced for 800 ms by the production store.
    await new Promise(resolve => setTimeout(resolve, 850))
    await rm(directory, { recursive: true, force: true })
  })
  const request = async (method, path, body) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    req.method = method
    req.url = path
    req.headers = { host: 'localhost' }
    let status
    let result
    await routes.get('/synapse/api')(req, { writeHead: code => { status = code }, end: value => { result = JSON.parse(value) } })
    return { status, ...result }
  }
  await request('GET', '/synapse/api/workspaces')
  await new Promise(resolve => setImmediate(resolve))
  const list = await request('GET', '/synapse/api/workspaces')
  const workspaceId = list.workspaces[0].id
  const graph = await request('GET', `/synapse/api/workspaces/${workspaceId}`)
  assert.equal(graph.workspace.threads[0].turns[0]?.question, 'question', 'startup must read the prototype event getter')
  assert.equal(graph.workspace.threads[0].turns[0].status, 'running')
  const revision = list.workspaces[0].revision
  assert.ok(revision > 0)

  const cursor = await request('POST', '/synapse/api/turn-cursor', { sessionId: session.id })
  assert.equal(cursor.status, 200)
  assert.equal(cursor.lastUserSeq, 1)
  const detail = await request('POST', '/synapse/api/turn-detail', { sessionId: session.id, seq: 1 })
  assert.equal(detail.detail.complete, false)
  assert.equal(detail.detail.steps[0].text, 'intermediate')
  const absent = await request('POST', '/synapse/api/turn-detail', { sessionId: session.id, seq: 999, turnIndex: 0 })
  assert.equal(absent.detail.question, null)

  for (const item of [answer(3, 'final'), event(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } })]) {
    session.log.push(item)
    handlers.get('session/event')(session, item)
  }
  await new Promise(resolve => setImmediate(resolve))
  const complete = await request('POST', '/synapse/api/turn-detail', { sessionId: session.id, seq: 1 })
  assert.equal(complete.detail.complete, true)
  assert.equal(complete.detail.revision, 4)
  const updated = await request('GET', `/synapse/api/workspaces/${workspaceId}`)
  assert.equal(updated.workspace.threads[0].turns[0].status, 'done')
  assert.ok(updated.workspace.revision > revision)

  const cold = await request('POST', '/synapse/api/turn-detail', { sessionId: 'cold-session', seq: 10 })
  assert.equal(cold.status, 200)
  assert.equal(cold.detail.question, 'cold question')
  assert.equal(cold.detail.complete, true)
  assert.equal(closes, 1)
  assert.deepEqual(errors, [])
})
