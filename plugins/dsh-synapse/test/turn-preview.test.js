import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8')
const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')

function section(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from, `missing function boundary: ${start}`)
  return source.slice(from, to)
}

const actions = section(appSource, 'function watchCardTurn', 'function cardHideReason')
const root = { id: 'map-root', dshSessionId: 'root-session', parentId: null }
const fork = { id: 'map-fork', dshSessionId: 'fork-session', parentId: root.id }
const nestedFork = { id: 'map-nested', dshSessionId: 'nested-session', parentId: fork.id }

function actionHarness(thread) {
  const card = { id: `${thread.id}:turn:23`, dshThreadId: thread.id, sourceSeq: 23, turnIndex: 1 }
  const camera = { x: -400, y: -200 }
  const state = {
    currentDsh: { id: root.dshSessionId },
    activeId: root.id,
    selectedCardId: 'selected-card',
    canvasCamera: camera,
    inspectorCardId: 'old-inspector',
    canvasCardsById: new Map([[card.id, card]]),
  }
  const messages = []
  const closeCalls = []
  const dispatch = new Function('state', 'post', 'closeCardInspector', `${actions}\nreturn dispatchCardSessionAction`)(
    state,
    (type, payload) => messages.push({ type, payload }),
    options => { closeCalls.push(options); state.inspectorCardId = null },
  )
  return { dispatch, state, card, camera, messages, closeCalls }
}

for (const thread of [root, fork, nestedFork]) {
  test(`details for ${thread.dshSessionId} only request a preview and preserve the map`, () => {
    const { dispatch, state, card, camera, messages, closeCalls } = actionHarness(thread)
    assert.equal(dispatch('watch-turn', thread, card.id), true)
    assert.deepEqual(messages, [{
      type: 'synapse:watch-turn',
      payload: { sessionId: thread.dshSessionId, seq: 23, turnIndex: 1, cardId: card.id },
    }])
    assert.deepEqual(closeCalls, [{ animate: false }])
    assert.equal(state.currentDsh.id, root.dshSessionId)
    assert.equal(state.activeId, root.id)
    assert.equal(state.selectedCardId, 'selected-card')
    assert.equal(state.canvasCamera, camera)
  })
}

test('invalid detail targets are consumed without falling through to session navigation', () => {
  const { dispatch, card, messages, closeCalls } = actionHarness(fork)
  for (const thread of [undefined, { ...fork, dshSessionId: null }, { ...fork, dshSessionId: '' }, root]) {
    assert.equal(dispatch('watch-turn', thread, card.id), true)
  }
  assert.equal(dispatch('watch-turn', fork, 'missing-card'), true)
  assert.deepEqual(messages, [])
  assert.deepEqual(closeCalls, [])
})

test('only the explicit open-session action navigates to the fork', () => {
  const { dispatch, card, messages } = actionHarness(fork)
  assert.equal(dispatch('open-dsh', fork, card.id, '23'), true)
  assert.deepEqual(messages, [{
    type: 'synapse:open-session',
    payload: { sessionId: fork.dshSessionId, seq: 23 },
  }])
  assert.equal(dispatch('open-branch', fork, card.id), false)
  assert.equal(messages.length, 1)
})

test('the host accepts previews for all sessions without opening a session', () => {
  const handler = section(clientSource, "if (event.data.type === 'synapse:watch-turn')", "if (event.data.type === 'synapse:activate-session')")
  const watches = []
  const messages = []
  const ctx = { sessions: { open: () => assert.fail('preview must not open a session') } }
  const receive = new Function('event', 'ctx', 'turnWatch', 'send', handler)
  const turnWatch = { set: value => watches.push(value) }
  const send = type => messages.push(type)
  for (const thread of [root, fork, nestedFork]) {
    receive({ data: { type: 'synapse:watch-turn', sessionId: thread.dshSessionId, seq: 23, turnIndex: 1, cardId: `${thread.id}:turn:23` } }, ctx, turnWatch, send)
    assert.equal(watches.at(-1).sessionId, thread.dshSessionId)
    assert.equal(watches.at(-1).seq, 23)
  }
  assert.deepEqual(messages, Array(3).fill('synapse:close-inspector'))
  receive({ data: { type: 'synapse:watch-turn' } }, ctx, turnWatch, send)
  assert.equal(watches.at(-1), null)
  assert.equal(messages.length, 3)
})

const readTurnDetail = new Function(`${section(clientSource, 'async function readTurnDetail', 'function RemoteTurnPane')}\nreturn readTurnDetail`)()

const markdownBodyProps = new Function(`${section(clientSource, 'const MARKDOWN_CODE_LABELS', 'function MarkdownBody')}\nreturn markdownBodyProps`)()

test('preview markdown supplies the 0.1.2 labels contract for code and footnotes', () => {
  const text = '```js\nconst answer = 42\n```\n\nAnswer[^1]\n\n[^1]: Source'
  const props = markdownBodyProps(text, false)
  // The host reads labels.code even for plain text, before parsing markdown.
  const { copyLabel, copiedLabel } = props.labels.code
  assert.equal(copyLabel, '复制')
  assert.equal(copiedLabel, '已复制')
  assert.equal(props.labels.footnotes, '脚注')
  assert.equal(props.text, text)
  assert.equal(props.streaming, false)
})

test('preview markdown retains the legacy codeLabels contract and stable label objects', () => {
  const first = markdownBodyProps('first token', true)
  const next = markdownBodyProps('more tokens', true)
  assert.deepEqual(first.codeLabels, { copyLabel: '复制', copiedLabel: '已复制' })
  assert.equal(first.labels.code, first.codeLabels)
  assert.equal(first.labels, next.labels)
  assert.equal(first.codeLabels, next.codeLabels)
  assert.equal(first.streaming, true)
})

test('preview markdown normalizes empty text and only enables streaming for true', () => {
  assert.equal(markdownBodyProps(null).text, '')
  assert.equal(markdownBodyProps(undefined).text, '')
  assert.equal(markdownBodyProps('answer', 'true').streaming, false)
})

test('the read-only detail request uses the selected session and turn, including forks', async () => {
  for (const thread of [root, fork, nestedFork]) {
    const calls = []
    const detail = { question: 'question', steps: [{ kind: 'assistant', text: 'answer' }], process: [] }
    const request = async (url, options) => {
      calls.push({ url, method: options.method, body: JSON.parse(options.body) })
      return { ok: true, json: async () => ({ detail }) }
    }
    assert.equal(await readTurnDetail({ sessionId: thread.dshSessionId, seq: 23, turnIndex: 1 }, request), detail)
    assert.deepEqual(calls, [{
      url: '/synapse/api/turn-detail',
      method: 'POST',
      body: { sessionId: thread.dshSessionId, seq: 23, turnIndex: 1 },
    }])
  }
})

test('remote detail rebuilds the same chat nodes side-chat renders, including web search', () => {
  const start = clientSource.indexOf('const parseArgs = raw =>')
  const end = clientSource.indexOf('const keysBetweenUser = ')
  assert.ok(start !== -1 && end > start)
  const exports = {}
  new Function('exports', `${clientSource.slice(start, end)}\nexports.inferResultView = inferResultView\nexports.detailToChatNodes = detailToChatNodes\nexports.toolSummary = toolSummary`)(exports)
  const sources = [
    { title: '竞品分析', url: 'https://example.com/a', snippet: '摘要' },
    { title: '对比', url: 'https://example.com/b' },
  ]
  assert.deepEqual(exports.inferResultView('web_search', JSON.stringify({ sources })), { card: 'web', sources })
  assert.equal(exports.toolSummary({ query: ['竞品', '分析'] }, ['query', 'keywords'], 'web_search'), '竞品 · 分析')
  const nodes = exports.detailToChatNodes({
    question: '搜一下',
    flow: [
      { kind: 'tool', name: 'web_search', arguments: '{"query":["竞品"]}', result: JSON.stringify({ sources }), error: null },
      { kind: 'assistant', text: '找到两篇' },
    ],
  })
  assert.deepEqual(nodes.map(node => node.kind), ['user', 'tool-call', 'assistant-step'])
  assert.equal(nodes[1].data.root.call.name, 'web_search')
  assert.equal(nodes[1].data.root.resultView.card, 'web')
  assert.equal(nodes[1].data.root.resultView.sources.length, 2)
})

test('a listed but cold fork is not a live watch — it falls back to the server detail', () => {
  const start = clientSource.indexOf('const liveSessionOf = ')
  const end = clientSource.indexOf('const subscribeLiveTurn')
  assert.ok(start !== -1 && end > start)
  const { isLiveWatch } = new Function(`${clientSource.slice(start, end)}\nreturn { isLiveWatch }`)()

  // A fork never opened in this window: DSH still mints a scope for every
  // listed session, so scope/sessionOf resolve — but the history window is
  // cold and its chat target is empty. Binding the pane to it would render an
  // empty transcript forever (loadThrough no-ops while cold).
  const coldCtx = {
    sessions: {
      scope: () => ({}),
      sessionOf: () => ({ getSnapshot: () => ({ openState: 'cold' }) }),
    },
    uiConversation: {
      binding: () => ({ target: () => ({ getSnapshot: () => ({ order: [] }) }) }),
    },
  }
  assert.equal(isLiveWatch(coldCtx, 'fork-session'), false)

  // An opened session (current or previously viewed in this window) is live.
  const openCtx = {
    sessions: {
      scope: () => ({}),
      sessionOf: () => ({ getSnapshot: () => ({ openState: 'open' }) }),
    },
  }
  assert.equal(isLiveWatch(openCtx, 'fork-session'), true)

  // Hosts before openState carry the loaded chat on the session snapshot.
  const legacyCtx = {
    sessions: {
      scope: () => ({}),
      sessionOf: () => ({ getSnapshot: () => ({ chat: { order: ['k1'] } }) }),
    },
  }
  assert.equal(isLiveWatch(legacyCtx, 'fork-session'), true)

  // A materialized chat target with content is live even without a session.
  const chatCtx = {
    sessions: {
      scope: () => undefined,
      get: () => undefined,
    },
    uiConversation: {
      binding: () => ({ target: () => ({ getSnapshot: () => ({ order: ['k1'] }) }) }),
    },
  }
  assert.equal(isLiveWatch(chatCtx, 'fork-session'), true)

  // Nothing resolvable at all → remote.
  const emptyCtx = { sessions: { scope: () => undefined, get: () => undefined } }
  assert.equal(isLiveWatch(emptyCtx, 'fork-session'), false)
})

test('missing sequences keep the turn index and failed detail reads never navigate', async () => {
  const calls = []
  await assert.rejects(readTurnDetail({ sessionId: fork.dshSessionId, turnIndex: 2 }, async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) })
    return { ok: false }
  }), /detail unavailable/)
  assert.deepEqual(calls, [{
    url: '/synapse/api/turn-detail',
    body: { sessionId: fork.dshSessionId, seq: null, turnIndex: 2 },
  }])
})

test('bridge effects can restart without losing or duplicating preview listeners', () => {
  const listeners = new Map()
  const subscribe = callback => {
    const key = Symbol()
    listeners.set(key, callback)
    return () => listeners.delete(key)
  }
  const events = new Map()
  const window = {
    addEventListener: (type, callback) => {
      if (!events.has(type)) events.set(type, new Set())
      events.get(type).add(callback)
    },
    removeEventListener: (type, callback) => events.get(type)?.delete(callback),
  }
  let attachments = 0
  let removals = 0
  const style = { remove: () => { removals++ } }
  const document = { head: { append: () => { attachments++ } }, body: {} }
  const themeObserver = { observe() {}, disconnect() {} }
  const liveUnsubscribers = new Map()
  let previewCount = 0
  let liveDisposed = 0
  const syncCurrentSession = () => {
    if (!liveUnsubscribers.has('fork')) liveUnsubscribers.set('fork', () => { liveDisposed++ })
  }
  const install = new Function(
    'ctx', 'document', 'style', 'themeObserver', 'window', 'syncCurrentSession', 'onMessage', 'onKeyDown', 'onSpaceDown', 'onSpaceUp', 'frame', 'liveUnsubscribers',
    `${section(clientSource, 'function installMapBridge', '// The map view:')}\nreturn installMapBridge`,
  )(
    { sessions: { list: { subscribe } }, workspaces: { list: { subscribe } } },
    document, style, themeObserver, window, syncCurrentSession,
    () => { previewCount++ }, () => {}, () => {}, () => {}, {}, liveUnsubscribers,
  )
  for (let round = 1; round <= 2; round++) {
    const dispose = install()
    assert.equal(events.get('message').size, 1)
    assert.equal(listeners.size, 2)
    assert.equal(liveUnsubscribers.size, 1)
    for (const callback of events.get('message')) callback({ type: 'synapse:watch-turn' })
    assert.equal(previewCount, round)
    dispose()
    assert.equal(events.get('message').size, 0)
    assert.equal(listeners.size, 0)
    assert.equal(liveUnsubscribers.size, 0)
  }
  assert.equal(attachments, 2)
  assert.equal(removals, 2)
  assert.equal(liveDisposed, 2)
})
