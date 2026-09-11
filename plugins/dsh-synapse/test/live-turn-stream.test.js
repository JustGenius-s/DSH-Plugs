import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
function section(start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from, start)
  return source.slice(from, to)
}
const helpers = new Function([
  section('const seqOf =', 'const MARKDOWN_CODE_LABELS'),
  section('const liveSessionOf =', 'class TurnNodeErrorBoundary'),
  section('function turnPaneSource', 'function SynapseTurnPane'),
  'return { liveSessionOf, isLiveWatch, subscribeWatchedSession, sliceTurnKeysLive, turnPaneSource }',
].join('\n'))()
const flush = () => new Promise(resolve => setImmediate(resolve))

function observable(initial) {
  let value = initial
  const listeners = new Set()
  return {
    listeners,
    getSnapshot: () => value,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    update(next) { value = next; for (const listener of [...listeners]) listener() },
  }
}

function harness({ listed = true, open } = {}) {
  const session = observable({ openState: 'cold', running: true })
  const target = observable({ order: [], nodes: new Map() })
  const list = observable({ current: 'parent', ids: listed ? ['parent', 'fork'] : ['parent'] })
  const calls = []
  const ctx = {
    sessions: {
      list,
      scope: id => list.getSnapshot().ids.includes(id) ? { id } : undefined,
      sessionOf: scope => scope.id === 'fork' ? session : undefined,
      open: () => assert.fail('details must not select a different host session'),
    },
    uiConversation: { binding: id => list.getSnapshot().ids.includes(id) ? { target: () => target } : undefined },
  }
  session.open = async () => {
    calls.push('open')
    if (open !== undefined) return open(session, target)
    session.update({ openState: 'open', running: true })
  }
  const snapshots = []
  const stop = helpers.subscribeWatchedSession(ctx, 'fork', () => {
    const chat = target.getSnapshot()
    const keys = helpers.sliceTurnKeysLive(chat, 23, 0, session.getSnapshot().running)
    snapshots.push({
      mode: helpers.turnPaneSource('fork', 'parent', false, helpers.isLiveWatch(ctx, 'fork')),
      nodes: keys.map(key => chat.nodes.get(key)),
      running: session.getSnapshot().running,
    })
  })
  return { ctx, session, target, list, calls, snapshots, stop }
}

function chat(nodes) {
  return { order: nodes.map(node => node.key), nodes: new Map(nodes.map(node => [node.key, node])) }
}
const question = { key: 'question', kind: 'user', anchorSeq: 23, data: { content: [{ type: 'text', text: 'example' }] } }
const think = text => ({
  key: 'assistant:24', kind: 'assistant-step', anchorSeq: 24,
  data: { status: 'running', blocks: [{ kind: 'reasoning', text }] },
})

test('details opens a cold fork event window without changing the current session', async () => {
  const h = harness()
  assert.equal(h.snapshots.at(-1).mode, 'remote')
  await flush()
  assert.deepEqual(h.calls, ['open'])
  assert.equal(h.snapshots.at(-1).mode, 'legacy')
  assert.equal(h.list.getSnapshot().current, 'parent')
  h.stop()
})

test('reasoning, tool updates and answer tokens stream before the turn is committed', async () => {
  const h = harness()
  await flush()
  h.target.update(chat([question, think('checking')]))
  assert.equal(h.snapshots.at(-1).nodes[1].data.blocks[0].text, 'checking')
  h.target.update(chat([question, think('checking the examples')]))
  assert.equal(h.snapshots.at(-1).nodes[1].data.blocks[0].text, 'checking the examples')

  const tool = { key: 'tool:25', kind: 'tool-call', anchorSeq: 25, data: { root: { name: 'bash', argsRaw: '{"command":"ls"}' } } }
  h.target.update(chat([question, think('checking the examples'), tool]))
  assert.equal(h.snapshots.at(-1).nodes[2].data.root.name, 'bash')
  const settledTool = { ...tool, data: { root: { kind: 'result', call: { name: 'bash' }, content: [{ type: 'text', text: 'example.js' }] } } }
  h.target.update(chat([question, think('checking the examples'), settledTool]))
  assert.equal(h.snapshots.at(-1).nodes[2].data.root.kind, 'result')

  const reply = text => ({ key: 'assistant:26', kind: 'assistant-step', anchorSeq: 26, data: { status: 'running', blocks: [{ kind: 'text', text }] } })
  h.target.update(chat([question, settledTool, reply('For')]))
  assert.equal(h.snapshots.at(-1).nodes.at(-1).data.blocks[0].text, 'For')
  h.target.update(chat([question, settledTool, reply('For example')]))
  assert.equal(h.snapshots.at(-1).nodes.at(-1).data.blocks[0].text, 'For example')
  assert.equal(h.snapshots.at(-1).running, true)
  assert.deepEqual(h.calls, ['open'], 'token updates must not reopen the event window')
  h.stop()
})

test('streaming nodes after the indexed question are not lost when the location index lags', async () => {
  const h = harness()
  await flush()
  const user = { ...question, location: { kind: 'turn', turn: { turn: 4 } } }
  h.target.update({ ...chat([user, think('live reasoning')]), locations: { getTurn: () => ['question'] } })
  assert.deepEqual(h.snapshots.at(-1).nodes.map(node => node.key), ['question', 'assistant:24'])
  h.stop()
})

test('a fork arriving after details opened is automatically bound and streamed', async () => {
  const h = harness({ listed: false })
  await flush()
  assert.deepEqual(h.calls, [])
  h.list.update({ current: 'parent', ids: ['parent', 'fork'] })
  await flush()
  h.target.update(chat([question, think('first token')]))
  assert.deepEqual(h.calls, ['open'])
  assert.equal(h.snapshots.at(-1).mode, 'legacy')
  assert.equal(h.snapshots.at(-1).nodes[1].data.blocks[0].text, 'first token')
  assert.equal(h.list.getSnapshot().current, 'parent')
  h.stop()
})

test('closing details releases every listener and ignores later tokens', async () => {
  const h = harness()
  await flush()
  h.stop()
  const count = h.snapshots.length
  assert.equal(h.list.listeners.size, 0)
  assert.equal(h.session.listeners.size, 0)
  assert.equal(h.target.listeners.size, 0)
  h.target.update(chat([question, think('late token')]))
  h.session.update({ openState: 'open', running: false })
  h.list.update({ current: 'parent', ids: ['parent', 'fork'] })
  assert.equal(h.snapshots.length, count)
})

test('closing before bootstrap prevents opening the session', async () => {
  const h = harness()
  h.stop()
  await flush()
  assert.deepEqual(h.calls, [])
})

test('a late open completion cannot resubscribe a closed detail pane', async () => {
  let finish
  const h = harness({ open: () => new Promise(resolve => { finish = resolve }) })
  await flush()
  h.stop()
  const count = h.snapshots.length
  finish()
  await flush()
  assert.equal(h.snapshots.length, count)
  assert.equal(h.session.listeners.size, 0)
  assert.equal(h.target.listeners.size, 0)
})

test('a failed event-window open keeps the remote fallback and does not loop', async () => {
  const h = harness({ open: async () => { throw new Error('temporarily unavailable') } })
  await flush()
  h.list.update({ current: 'parent', ids: ['parent', 'fork'] })
  h.session.update({ openState: 'error', running: true })
  await flush()
  assert.deepEqual(h.calls, ['open'])
  assert.equal(h.snapshots.at(-1).mode, 'remote')
  h.stop()
})

test('a target materialized after session open gets its own live subscription', async () => {
  const session = observable({ openState: 'cold', running: true })
  const target = observable({ order: [] })
  let chatReady = false
  let updates = 0
  session.open = async () => {
    chatReady = true
    session.update({ openState: 'open', running: true })
  }
  const ctx = {
    sessions: { scope: () => ({}), sessionOf: () => session },
    uiConversation: { binding: () => chatReady ? { target: () => target } : undefined },
  }
  const stop = helpers.subscribeWatchedSession(ctx, 'fork', () => { updates++ })
  await flush()
  const count = updates
  target.update(chat([question, think('streaming')]))
  assert.equal(updates, count + 1)
  assert.equal(target.listeners.size, 1)
  stop()
  assert.equal(target.listeners.size, 0)
})

test('switching watches isolates the new stream and releases the old one', async () => {
  const old = harness()
  await flush()
  old.stop()
  const next = harness()
  await flush()
  const oldCount = old.snapshots.length
  old.target.update(chat([question, think('old stream')]))
  next.target.update(chat([question, think('new stream')]))
  assert.equal(old.snapshots.length, oldCount)
  assert.equal(next.snapshots.at(-1).nodes[1].data.blocks[0].text, 'new stream')
  next.stop()
})

test('historical details never borrow the live tail of a later question', async () => {
  const h = harness()
  await flush()
  const oldAnswer = { key: 'old-answer', kind: 'assistant-step', anchorSeq: 24, data: { status: 'settled', blocks: [{ kind: 'text', text: 'completed answer' }] } }
  const nextQuestion = { ...question, key: 'next-question', anchorSeq: 30 }
  h.target.update(chat([question, oldAnswer, nextQuestion, think('unrelated new reasoning')]))
  assert.deepEqual(h.snapshots.at(-1).nodes.map(node => node.key), ['question', 'old-answer'])
  h.stop()
})

test('binding-only hosts use the same read-only session window as side chat', async () => {
  const session = observable({ openState: 'cold' })
  let opens = 0
  session.open = async () => { opens++; session.update({ openState: 'open' }) }
  const ctx = { sessions: { binding: id => id === 'fork' ? { session } : undefined } }
  assert.equal(helpers.liveSessionOf(ctx, 'fork'), session)
  const stop = helpers.subscribeWatchedSession(ctx, 'fork', () => {})
  await flush()
  assert.equal(opens, 1)
  assert.equal(helpers.isLiveWatch(ctx, 'fork'), true)
  stop()
})
