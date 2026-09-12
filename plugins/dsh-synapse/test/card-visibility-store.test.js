import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { WorkspaceStore, apply } from '../index.js'

const event = (seq, type, data) => ({ seq, type, data, time: seq * 1000 })
const eventsFor = (offset = 0) => [0, 1, 2].flatMap(index => {
  const seq = index * 4 + offset
  const turn = index + 1
  return [
    event(seq, 'turn/start', { turn }),
    event(seq + 1, 'user/message', { id: `message-${turn}`, source: { kind: 'user' }, content: [{ type: 'text', text: `Question ${turn}` }] }),
    event(seq + 2, 'assistant/message', { turn, message: { content: [{ type: 'text', text: `Answer ${turn}` }] } }),
    event(seq + 3, 'turn/end', { turn, reason: { kind: 'completed' } }),
  ]
})

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'synapse-card-visibility-'))
  const file = join(directory, 'workspaces.json')
  const store = new WorkspaceStore(file)
  t.after(async () => {
    await store.flush()
    clearTimeout(store.flushTimer)
    await rm(directory, { recursive: true, force: true })
  })
  const session = { id: 'source', header: { meta: { cwd: '/fixture' } }, events: eventsFor() }
  const thread = await store.projectSession(session)
  await store.flush()
  const workspace = (await store.list())[0]
  const target = (index = 1) => {
    const turn = thread.turns[index]
    return { threadId: thread.id, cardKey: String(turn.seq), cardId: `${thread.id}:turn:${turn.seq}`, messageId: turn.messageId }
  }
  const getThread = async () => (await store.get(workspace.id)).threads.find(item => item.id === thread.id)
  return { store, file, session, thread, workspace, target, getThread }
}

test('hiding one card persists across reload without removing content or its session', async t => {
  const { store, file, session, thread, workspace, target, getThread } = await fixture(t)
  const original = structuredClone(session.events)
  await store.updateCardTitle(thread.id, '5', 'Custom title')
  const before = (await store.get(workspace.id)).revision
  await store.updateCardVisibility([target()], true)
  const hidden = await getThread()
  assert.deepEqual(hidden.turns.map(turn => turn.hidden === true), [false, true, false])
  assert.equal(hidden.turns[1].title, 'Custom title')
  assert.equal(hidden.turns[1].question, 'Question 2')
  assert.equal(hidden.turns[1].answer, 'Answer 2')
  assert.deepEqual(session.events, original)
  assert.deepEqual(store.state.hiddenSessionIds, [])
  assert.equal((await store.get(workspace.id)).revision, before + 1)

  const reloaded = await new WorkspaceStore(file).get(workspace.id)
  assert.equal(reloaded.threads[0].turns[1].hidden, true)
  assert.equal(reloaded.threads[0].turns.length, 3)
})

test('hiding a fork point preserves every descendant and exact branch anchor', async t => {
  const { store, thread, workspace, target, getThread } = await fixture(t)
  await store.branch(thread.id, {
    title: 'Fork', dshSessionId: 'fork', anchorCardId: `${thread.id}:turn:5`, sourceAnchorSeq: 6,
  })
  const before = (await store.get(workspace.id)).threads.find(item => item.dshSessionId === 'fork')
  await store.updateCardVisibility([target()], true)
  const after = (await store.get(workspace.id)).threads.find(item => item.dshSessionId === 'fork')
  assert.deepEqual(after, before)
  assert.equal((await getThread()).turns.length, 3)
})

test('bulk restoration changes only visibility and increments a workspace revision once', async t => {
  const { store, workspace, target, getThread } = await fixture(t)
  await store.updateCardVisibility([target(0), target(1), target(2)], true)
  const hiddenRevision = (await store.get(workspace.id)).revision
  await store.updateCardVisibility([target(0)], true)
  assert.equal((await store.get(workspace.id)).revision, hiddenRevision)
  const result = await store.updateCardVisibility([target(0), target(1), target(2)], false)
  assert.equal(result.updates.length, 3)
  assert.equal((await store.get(workspace.id)).revision, hiddenRevision + 1)
  assert.deepEqual((await getThread()).turns.map(turn => turn.hidden), [undefined, undefined, undefined])
})

test('incremental updates, session sync, and full replay retain a hidden card', async t => {
  const { store, session, target, getThread } = await fixture(t)
  await store.updateCardVisibility([target()], true)
  await store.projectSession(session)
  await store.syncSessions([{ id: session.id, title: 'Renamed session', cwd: '/fixture', blank: false }])
  await store.projectEvents(session, [event(12, 'session/title', { title: 'Another title' })])
  assert.equal((await getThread()).turns[1].hidden, true)
})

test('sequence rebasing keeps hidden metadata and resolves the original card identity', async t => {
  const { store, session, target, getThread } = await fixture(t)
  const oldTarget = target()
  await store.updateCardVisibility([oldTarget], true)
  const rebased = [event(0, 'session/title', { title: 'Migrated' }), ...eventsFor(20)]
  await store.projectSession({ ...session, events: rebased })
  const turn = (await getThread()).turns[1]
  assert.equal(turn.seq, 25)
  assert.equal(turn.hidden, true)
  assert.equal(turn.cardId, oldTarget.cardId)
  await store.updateCardVisibility([{ ...oldTarget, messageId: undefined }], false)
  assert.equal((await getThread()).turns[1].hidden, undefined)
})

test('known message identity takes priority and never falls back to a different sequence', async t => {
  const { store, target, getThread } = await fixture(t)
  await store.updateCardVisibility([{ ...target(), cardKey: '1' }], true)
  assert.deepEqual((await getThread()).turns.map(turn => turn.hidden === true), [false, true, false])
  await assert.rejects(store.updateCardVisibility([{ ...target(0), messageId: 'missing' }], true), /卡片不存在/)
  assert.equal((await getThread()).turns[0].hidden, undefined)
})

test('invalid batches and running turns cannot partially hide earlier targets', async t => {
  const { store, session, thread, target, getThread } = await fixture(t)
  await store.projectEvents(session, [
    event(12, 'turn/start', { turn: 4 }),
    event(13, 'user/message', { content: [{ type: 'text', text: 'Running' }] }),
  ])
  await assert.rejects(store.updateCardVisibility([target(0), { threadId: thread.id, cardKey: '13' }], true), /结束/)
  await assert.rejects(store.updateCardVisibility([target(0), { threadId: thread.id, cardKey: '999' }], true), /不存在/)
  await assert.rejects(store.updateCardVisibility([target()], 'true'), /布尔/)
  await assert.rejects(store.updateCardVisibility([], true), /100/)
  await assert.rejects(store.updateCardVisibility(Array.from({ length: 101 }, () => target()), true), /100/)
  await assert.rejects(store.updateCardVisibility([null], true), /地址/)
  assert.ok((await getThread()).turns.every(turn => turn.hidden !== true))
})

test('a failed disk write rolls back visibility and leaves later mutations usable', async t => {
  const { store, workspace, target, getThread } = await fixture(t)
  const revision = (await store.get(workspace.id)).revision
  const save = store.save
  store.save = async () => { throw new Error('Disk unavailable') }
  try {
    await assert.rejects(store.updateCardVisibility([target()], true), /Disk unavailable/)
    assert.equal((await getThread()).turns[1].hidden, undefined)
    assert.equal((await store.get(workspace.id)).revision, revision)
  } finally {
    store.save = save
  }
  await store.updateCardVisibility([target()], true)
  assert.equal((await getThread()).turns[1].hidden, true)
})

test('legacy removed sessions remain suppressed while new card visibility remains reversible', async t => {
  const { store, file, session, thread } = await fixture(t)
  await store.removeThread(thread.id)
  await store.projectSession(session)
  await store.syncSessions([{ id: session.id, title: 'Legacy removed', cwd: '/fixture', blank: false }])
  await store.flush()
  assert.equal((await store.list()).length, 0)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).hiddenSessionIds, [session.id])
  assert.equal((await new WorkspaceStore(file).list()).length, 0)
})

test('the visibility HTTP interface hides and restores manual cards without archiving sessions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'synapse-visibility-api-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const routes = new Map()
  const errors = []
  const ctx = {
    sessions: { list: () => [] },
    get: () => undefined,
    webServer: { register: route => routes.set(route.path, route.handler) },
    effect: callback => callback(), on: () => {},
    logger: { warn: error => errors.push(error), error: error => errors.push(error) },
  }
  apply(ctx, { dataFile: join(directory, 'workspaces.json'), autoProjection: false })
  const request = async (method, path, body) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    Object.assign(req, { method, url: path, headers: { host: 'localhost' } })
    let status
    let result
    await routes.get('/synapse/api')(req, { writeHead: code => { status = code }, end: value => { result = JSON.parse(value) } })
    return { status, ...result }
  }
  const { workspace } = await request('POST', '/synapse/api/workspaces', { title: 'Workspace' })
  const { thread } = await request('POST', `/synapse/api/workspaces/${workspace.id}`, { title: 'Thread' })
  await request('POST', `/synapse/api/threads/${thread.id}/messages`, { text: 'Manual note' })
  const cards = [{ threadId: thread.id, cardKey: 'i0', cardId: `${thread.id}:turn:i0` }]
  const hidden = await request('PATCH', '/synapse/api/cards/visibility', { cards, hidden: true })
  assert.equal(hidden.status, 200)
  assert.equal(hidden.updates[0].hidden, true)
  const graph = await request('GET', `/synapse/api/workspaces/${workspace.id}`)
  assert.equal(graph.workspace.threads[0].turns[0].hidden, true)
  assert.equal(graph.workspace.threads[0].turns[0].question, 'Manual note')
  assert.equal((await request('PATCH', '/synapse/api/cards/visibility', { cards, hidden: false })).status, 200)
  assert.equal((await request('PATCH', '/synapse/api/cards/visibility', { cards, hidden: null })).status, 400)
  assert.equal((await request('PATCH', '/synapse/api/cards/visibility', { cards: [{ threadId: thread.id, cardKey: 'i99' }], hidden: true })).status, 404)
  assert.equal((await request('PATCH', `/synapse/api/threads/${thread.id}/cards/i0`, { title: 'Renamed' })).status, 200)
  assert.deepEqual(errors, [])
})
