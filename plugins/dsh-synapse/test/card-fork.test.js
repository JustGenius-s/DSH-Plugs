import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { apply, cardForkSeed, createCardForkRunner, forkCardSession } from '../index.js'

const event = (seq, type, data = {}) => ({ seq, type, data, time: seq * 1000 })
const message = (id, text) => ({ id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const user = (seq, id, text) => event(seq, 'user/message', message(id, text))
const answer = (seq, text) => event(seq, 'assistant/message', { message: { content: [{ type: 'text', text }] } })
const end = (seq, turn) => event(seq, 'turn/end', { turn, reason: { kind: 'completed' } })
const queued = (seq, id, text) => event(seq, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message(id, text)] })
const target = { seq: 6, reference: { messageId: 'u2', question: 'second', root: true, unique: true } }
const input = { operationId: 'dd122743-ab35-4121-a8bd-4b5ccfaad2c1', sessionId: 'parent', target }

function history() {
  return [
    event(0, 'session/title', { title: 'Parent' }),
    event(1, 'turn/start', { turn: 1 }),
    user(2, 'u1', 'first'), answer(3, 'first answer'), end(4, 1),
    event(5, 'turn/start', { turn: 2 }),
    user(6, 'u2', 'second'), answer(7, 'second answer'), end(8, 2),
    event(9, 'session/end-seed'),
    queued(10, 'u3', 'expand'),
    event(11, 'turn/start', { turn: 3 }),
    event(12, 'agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] }),
    user(13, 'u3', 'expand'), answer(14, 'third answer'), end(15, 3),
  ]
}

test('forking the second card excludes the third prompt queued before its turn/start', () => {
  const events = history()
  const before = structuredClone(events)
  const { seed, sourceAnchorSeq } = cardForkSeed(events, target)
  assert.deepEqual(seed, events.slice(0, 9))
  assert.equal(seed.at(-1).type, 'turn/end')
  assert.equal(sourceAnchorSeq, 7)
  assert.equal(seed.some(item => item.type === 'agent/inbox/spliced'), false)
  assert.deepEqual(seed.filter(item => item.type === 'user/message').map(item => item.data.id), ['u1', 'u2'])
  assert.deepEqual(events, before, 'the source history must remain unchanged')
})

test('message identity resolves a migrated card without falling through to the latest turn', () => {
  const result = cardForkSeed(history(), { ...target, seq: 3408 })
  assert.equal(result.seed.at(-1).seq, 8)
  assert.throws(() => cardForkSeed(history(), {
    seq: 3408, reference: { messageId: 'missing', question: 'second', root: true, unique: true },
  }), /无法定位/)
})

test('nested forks and repeated prompts use the selected message identity', () => {
  const events = history()
  events[6] = user(6, 'u2', 'expand')
  const result = cardForkSeed(events, {
    seq: 6, reference: { messageId: 'u2', question: 'expand', root: false, unique: false },
  })
  assert.equal(result.seed.at(-1).seq, 8)
  assert.equal(result.seed.some(item => item.data?.id === 'u3'), false)
})

test('a legacy unique root question can recover but ambiguous or absent targets fail closed', () => {
  assert.equal(cardForkSeed(history(), {
    seq: 3408, reference: { question: 'second', root: true, unique: true },
  }).seed.at(-1).seq, 8)
  assert.throws(() => cardForkSeed(history(), { seq: 3408, reference: { question: 'second', root: false, unique: true } }), /无法定位/)
  assert.throws(() => cardForkSeed(history(), undefined), /缺少/)
  assert.throws(() => cardForkSeed(history(), { seq: 6 }), /身份/)
  const events = history()
  events[13] = user(13, 'u3', 'second')
  assert.throws(() => cardForkSeed(events, {
    seq: 3408, reference: { question: 'second', root: true, unique: true },
  }), /无法定位/)
})

test('an unfinished selected card cannot borrow the following turn completion', () => {
  const events = history()
  assert.throws(() => cardForkSeed(events.slice(0, 8), target), /等待/)
  assert.throws(() => cardForkSeed(events.filter(item => item.seq !== 8), target), /等待/)
  for (const kind of ['error', 'cancelled', 'interrupted']) {
    events[8] = event(8, 'turn/end', { turn: 2, reason: { kind } })
    assert.throws(() => cardForkSeed(events, target), /等待/)
  }
})

function hostHarness(events = history()) {
  const calls = []
  const sessions = new Map()
  const parentInbox = ['parent pending']
  const source = {
    header: { id: 'parent', cwd: '/project', agentPreset: 'old-preset' },
    events,
    projections: { values: { agentPreset: 'selected-preset' } },
    [Symbol.dispose]: () => { calls.push(['dispose']) },
  }
  const workspace = {
    id: 'workspace', sessionIds: ['parent'],
    async attachSession(id) { calls.push(['attach', id]); this.sessionIds.push(id) },
  }
  const ctx = {
    sessions: { get: id => sessions.get(id) },
    sessionQuery: { observeSession: async id => { calls.push(['observe', id]); return source } },
    workspaceRegistry: { list: () => [workspace] },
    agentDefaultModel: { currentSelection: () => ({ provider: 'provider', model: 'model' }) },
    agentPresets: {
      resolve: async id => { calls.push(['preset', id]); return { id } },
      mount: async (_ctx, id) => { calls.push(['mount', id]) },
    },
    agents: {
      async create(options) {
        calls.push(['create', options])
        const pending = []
        for (const item of options.seed) {
          if (item.type !== 'agent/inbox/spliced' || item.data.target !== 'next-turn') continue
          pending.splice(item.data.start, item.data.removedCount ?? 0, ...item.data.inserted)
        }
        const inbox = { clear() { calls.push(['clear', pending.map(item => item.id)]); pending.length = 0 } }
        await options.setup({}, { inbox })
        calls.push(['publish', pending.length])
        sessions.set(options.sessionId, { header: options.meta })
      },
    },
  }
  return { ctx, calls, sessions, source, workspace, parentInbox }
}

test('host creation preserves lineage and history, publishing an empty child inbox', async () => {
  const h = hostHarness()
  const result = await forkCardSession(h.ctx, input)
  const options = h.calls.find(call => call[0] === 'create')[1]
  assert.deepEqual(options.seed, history().slice(0, 9))
  assert.equal(options.inheritedEventCount, 9)
  assert.deepEqual(options.meta, { cwd: '/project', parentSession: 'parent', isSeeded: true, agentPreset: 'selected-preset' })
  assert.deepEqual(options.agentOptions, { provider: 'provider', model: 'model' })
  assert.deepEqual(result, { id: `session-${input.operationId}`, parentId: 'parent', sourceAnchorSeq: 7 })
  assert.deepEqual(h.calls.map(call => call[0]), ['observe', 'preset', 'create', 'clear', 'mount', 'publish', 'attach', 'dispose'])
  assert.deepEqual(h.calls.find(call => call[0] === 'publish'), ['publish', 0])
  assert.equal(h.sessions.size, 1, 'the cold source must not be activated')
  assert.deepEqual(h.parentInbox, ['parent pending'])
})

test('input queued during the selected turn is cleared before child publication', async () => {
  const events = history()
  events.splice(8, 0, queued(8, 'queued-during-turn', 'do this next'))
  for (let index = 0; index < events.length; index++) events[index].seq = index
  const h = hostHarness(events)
  await forkCardSession(h.ctx, input)
  assert.deepEqual(h.calls.find(call => call[0] === 'clear'), ['clear', ['queued-during-turn']])
  assert.deepEqual(h.calls.find(call => call[0] === 'publish'), ['publish', 0])
  assert.deepEqual(h.parentInbox, ['parent pending'])
})

test('source observations are released on a failed target or child setup', async () => {
  for (const setupFails of [false, true]) {
    const h = hostHarness()
    if (setupFails) h.ctx.agentPresets.mount = async () => { throw new Error('setup failed') }
    const request = setupFails ? input : { ...input, target: { ...target, reference: { messageId: 'missing' } } }
    await assert.rejects(forkCardSession(h.ctx, request))
    assert.equal(h.calls.at(-1)[0], 'dispose')
    assert.equal(h.calls.some(call => call[0] === 'attach'), false)
  }
})

test('concurrent and accepted retries create only one child', async () => {
  const h = hostHarness()
  const run = createCardForkRunner(h.ctx)
  const first = run(input)
  assert.equal(run(input), first)
  const result = await first
  assert.deepEqual(await run(input), result)
  assert.equal(h.calls.filter(call => call[0] === 'create').length, 1)
  await assert.rejects(run({ ...input, sessionId: 'other-parent' }), /其他会话/)
})

test('retry after workspace attachment failure reuses the already-created child', async () => {
  const h = hostHarness()
  const attach = h.workspace.attachSession
  let attempts = 0
  h.workspace.attachSession = async function (id) {
    if (++attempts === 1) throw new Error('attach failed')
    return attach.call(this, id)
  }
  const run = createCardForkRunner(h.ctx)
  await assert.rejects(run(input), /attach failed/)
  const result = await run(input)
  assert.equal(h.calls.filter(call => call[0] === 'create').length, 1)
  assert.equal(h.workspace.sessionIds.includes(result.id), true)
})

test('a fresh runner reuses a live child after its response was lost', async () => {
  const h = hostHarness()
  const first = await createCardForkRunner(h.ctx)(input)
  const retried = await createCardForkRunner(h.ctx)(input)
  assert.deepEqual(retried, first)
  assert.equal(h.calls.filter(call => call[0] === 'create').length, 1)
})

const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const from = client.indexOf('async function requestCardFork')
const to = client.indexOf('function createOperationRunner', from)
assert.ok(from >= 0 && to > from)
const requestCardFork = new Function(`${client.slice(from, to)}; return requestCardFork`)()
const waitFrom = client.indexOf('async function waitForForkSession')
assert.ok(waitFrom >= 0 && waitFrom < from)
const waitForForkSession = new Function(`${client.slice(waitFrom, from)}; return waitForForkSession`)()

test('the bridge waits for the fork binding without activating the new session', async () => {
  const listeners = new Set()
  let listed = false
  let ready = false
  const sessions = {
    scope: id => listed && id === 'child' ? { id } : undefined,
    sessionOf: scope => scope.id === 'child' ? {} : undefined,
    list: { subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) } },
  }
  const pending = waitForForkSession(sessions, 'child').then(() => { ready = true })
  await Promise.resolve()
  assert.equal(ready, false)
  assert.equal(listeners.size, 1)
  listed = true
  for (const listener of listeners) listener()
  await pending
  assert.equal(ready, true)
  assert.equal(listeners.size, 0)
})

test('a missing fork binding times out and releases its listener', async () => {
  const listeners = new Set()
  const sessions = {
    scope: () => undefined,
    list: { subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) } },
  }
  await assert.rejects(waitForForkSession(sessions, 'child', 5), /尚未同步/)
  assert.equal(listeners.size, 0)
})

test('an already-visible fork needs no subscription', async () => {
  await waitForForkSession({
    scope: () => ({}),
    sessionOf: () => ({}),
    list: { subscribe() { assert.fail('already ready') } },
  }, 'child')
})

test('the bridge requests an exact card fork without calling native atSeq fork', async () => {
  const calls = []
  const session = { id: 'child', parentId: 'parent', sourceAnchorSeq: 7 }
  assert.deepEqual(await requestCardFork(input, async (path, options) => {
    calls.push({ path, ...options })
    return { ok: true, json: async () => ({ session }) }
  }), session)
  assert.equal(calls[0].path, '/synapse/api/fork-card')
  assert.equal(calls[0].method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].body), input)
})

test('an unavailable precise fork endpoint never falls back to native fork', async () => {
  let calls = 0
  await assert.rejects(requestCardFork(input, async () => {
    calls++
    return { ok: false, json: async () => ({ error: 'endpoint unavailable' }) }
  }), /endpoint unavailable/)
  assert.equal(calls, 1)
  await assert.rejects(requestCardFork(input, async () => ({ ok: true, json: async () => ({ session: {} }) })), /会话标识/)
})

test('the card-fork route authenticates before creating and deduplicates successful retries', async t => {
  const h = hostHarness()
  const directory = await mkdtemp(join(tmpdir(), 'synapse-card-fork-'))
  const routes = new Map()
  const errors = []
  Object.assign(h.ctx, {
    connection: { requestRejection: req => req.headers.origin === 'https://untrusted.invalid' ? 403 : req.headers.cookie === 'trusted=1' ? undefined : 401 },
    get: () => undefined,
    webServer: { register: route => { routes.set(route.path, route.handler); return () => {} } },
    effect: callback => callback(),
    on() {},
    logger: { warn: error => errors.push(error), error: error => errors.push(error) },
  })
  h.ctx.sessions.list = () => []
  apply(h.ctx, { dataFile: join(directory, 'workspaces.json'), autoProjection: false })
  t.after(async () => {
    await new Promise(resolve => setTimeout(resolve, 850))
    await rm(directory, { recursive: true, force: true })
  })
  const request = async (body, headers = {}) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))])
    Object.assign(req, { method: 'POST', url: '/synapse/api/fork-card', headers: { host: 'localhost', ...headers } })
    let status
    let result
    await routes.get('/synapse/api')(req, { writeHead: code => { status = code }, end: value => { result = JSON.parse(value) } })
    return { status, ...result }
  }
  assert.equal((await request(input)).status, 401)
  assert.equal((await request(input, { cookie: 'trusted=1', origin: 'https://untrusted.invalid' })).status, 403)
  assert.equal(h.calls.length, 0)
  const invalid = await request({ ...input, target: undefined }, { cookie: 'trusted=1' })
  assert.equal(invalid.status, 400)
  assert.equal(h.calls.some(call => call[0] === 'create'), false)
  const created = await request(input, { cookie: 'trusted=1' })
  assert.equal(created.status, 201)
  assert.equal(created.session.parentId, 'parent')
  assert.equal(created.session.sourceAnchorSeq, 7)
  const retried = await request(input, { cookie: 'trusted=1' })
  assert.deepEqual(retried, created)
  assert.equal(h.calls.filter(call => call[0] === 'create').length, 1)
  assert.deepEqual(errors, [])
})
