import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadConversationCards() {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const start = source.indexOf('function overlapsCard')
  const end = source.indexOf('function canvasConnectors')
  const context = { globalThis: {}, CARD_WIDTH: 310, CARD_HEIGHT: 276, CARD_GAP_Y: 42, CAMERA_INSET_X: 56, CAMERA_INSET_Y: 56, turnsFor: thread => thread.turns ?? [], state: { branchAnchors: new Map(), cardPositions: new Map(), liveReplies: new Map(), collapsedCardIds: new Set() } }
  vm.createContext(context)
  vm.runInContext(`${source.slice(start, end)};globalThis.conversationCards = conversationCards;globalThis.conversationGraphView = conversationGraphView;globalThis.initialCanvasCamera = initialCanvasCamera`, context)
  return { conversationCards: context.globalThis.conversationCards, conversationGraphView: context.globalThis.conversationGraphView, initialCanvasCamera: context.globalThis.initialCanvasCamera, state: context.state }
}

test('projects each user question in one DSH session as a connected canvas card', async () => {
  const { conversationCards } = await loadConversationCards()
  const cards = conversationCards([{
    id: 'session-1', parentId: null, position: { x: 86, y: 82 },
    turns: [
      {seq:1,at:'2026-01-01T00:00:00.000Z',question:'第一个问题',answer:'第一个最终回答',answerSeq:3,error:null,processCount:0,processIds:[]},
      {seq:4,at:'2026-01-01T00:00:00.000Z',question:'第二个问题',answer:'第二个最终回答',answerSeq:5,error:null,processCount:0,processIds:[]},
    ]  }])

  assert.equal(cards.length, 2)
  assert.equal(cards[0].question, '第一个问题')
  assert.equal(cards[0].answer.text, '第一个最终回答')
  assert.equal(cards[1].question, '第二个问题')
  assert.equal(cards[1].parentId, cards[0].id)
  assert.equal(cards[1].position.x, cards[0].position.x + 365)
  assert.equal(cards[0].canContinue, undefined)
  assert.equal(cards[1].canContinue, true)
})

test('keeps a failed turn visible when Harness produces no assistant message', async () => {
  const { conversationCards } = await loadConversationCards()
  const [card] = conversationCards([{
    id: 'session-error', parentId: null, position: { x: 86, y: 82 },
    turns: [
      {seq:1,at:'2026-01-01T00:00:00.000Z',question:'调用搜索',answer:null,answerSeq:null,error:'QuotaExceeded: INSUFFICIENT_BALANCE: 余额不足',processCount:0,processIds:[]},
    ]  }])

  assert.equal(card.answer, null)
  assert.equal(card.error.text, 'QuotaExceeded: INSUFFICIENT_BALANCE: 余额不足')
  assert.equal(card.canContinue, true)
})

test('connects a restored fork to its DSH seed boundary, not its canvas position', async () => {
  const { conversationCards } = await loadConversationCards()
  const cards = conversationCards([
    {
      id: 'parent', parentId: null, position: { x: 86, y: 82 },
      turns: [
      {seq:1,at:'2026-01-01T00:00:00.000Z',question:'第一轮',answer:'第一轮回答',answerSeq:2,error:null,processCount:0,processIds:[]},
      {seq:5,at:'2026-01-01T00:00:00.000Z',question:'第二轮',answer:'第二轮回答',answerSeq:6,error:null,processCount:0,processIds:[]},
      {seq:9,at:'2026-01-01T00:00:00.000Z',question:'第三轮',answer:'第三轮回答',answerSeq:10,error:null,processCount:0,processIds:[]},
    ]    },
    {
      id: 'child', parentId: 'parent', sourceSeedLength: 8, position: { x: 9999, y: -9999 },
      turns: [
      {seq:9,at:'2026-01-01T00:00:00.000Z',question:'分支问题',answer:'分支回答',answerSeq:10,error:null,processCount:0,processIds:[]},
    ]    },
  ])

  const parentTurns = cards.filter(card => card.dshThreadId === 'parent')
  const childTurn = cards.find(card => card.dshThreadId === 'child')
  assert.equal(childTurn.parentId, parentTurns[1].id)
})

test('uses a restored child message sequence to reconnect a legacy fork at its user turn', async () => {
  const { conversationCards } = await loadConversationCards()
  const cards = conversationCards([
    {
      id: 'parent', parentId: null, position: { x: 86, y: 82 },
      turns: [
      {seq:7,at:'2026-01-01T00:00:00.000Z',question:'你好',answer:'你好，我是助手。',answerSeq:111,error:null,processCount:0,processIds:[]},
      {seq:118,at:'2026-01-01T00:00:00.000Z',question:'你是谁',answer:'我是 DSH。',answerSeq:278,error:null,processCount:0,processIds:[]},
    ]    },
    {
      id: 'child', parentId: 'parent', sourceSeedLength: null, position: { x: 1200, y: 900 },
      turns: [
      {seq:121,at:'2026-01-01T00:00:00.000Z',question:'代码是什么',answer:'代码是指令。',answerSeq:569,error:null,processCount:0,processIds:[]},
    ]    },
  ])

  const parentTurns = cards.filter(card => card.dshThreadId === 'parent')
  const childTurn = cards.find(card => card.dshThreadId === 'child')
  assert.equal(childTurn.parentId, parentTurns[1].id)
})

test('places a fork beside the exact parent turn while avoiding overlap', async () => {
  const { conversationCards } = await loadConversationCards()
  const cards = conversationCards([
    {
      id: 'parent', parentId: null, position: { x: 86, y: 82 },
      turns: [
      {seq:1,at:'2026-01-01T00:00:00.000Z',question:'第一轮',answer:'第一轮回答',answerSeq:2,error:null,processCount:0,processIds:[]},
      {seq:5,at:'2026-01-01T00:00:00.000Z',question:'第二轮',answer:'第二轮回答',answerSeq:6,error:null,processCount:0,processIds:[]},
      {seq:9,at:'2026-01-01T00:00:00.000Z',question:'第三轮',answer:'第三轮回答',answerSeq:10,error:null,processCount:0,processIds:[]},
    ]    },
    {
      id: 'child', parentId: 'parent', sourceSeedLength: 8, position: { x: 86, y: 900 },
      turns: [
      {seq:9,at:'2026-01-01T00:00:00.000Z',question:'第二轮分支',answer:'分支回答',answerSeq:10,error:null,processCount:0,processIds:[]},
    ]    },
  ])

  const parentTurns = cards.filter(card => card.dshThreadId === 'parent')
  const childTurn = cards.find(card => card.dshThreadId === 'child')
  assert.equal(childTurn.parentId, parentTurns[1].id)
  assert.equal(childTurn.position.x, parentTurns[1].position.x + 365)
  assert.ok(childTurn.position.y > parentTurns[1].position.y)
})

test('keeps every turn of one branch on the same horizontal lane', async () => {
  const { conversationCards } = await loadConversationCards()
  const cards = conversationCards([
    {
      id: 'parent', parentId: null, position: { x: 86, y: 82 },
      turns: [
      {seq:1,at:'2026-01-01T00:00:00.000Z',question:'第一轮',answer:'第一轮回答',answerSeq:2,error:null,processCount:0,processIds:[]},
      {seq:5,at:'2026-01-01T00:00:00.000Z',question:'第二轮',answer:'第二轮回答',answerSeq:6,error:null,processCount:0,processIds:[]},
    ]    },
    {
      id: 'child', parentId: 'parent', sourceSeedLength: 7, position: { x: 999, y: 999 },
      turns: [
      {seq:7,at:'2026-01-01T00:00:00.000Z',question:'分支第一轮',answer:'分支第一轮回答',answerSeq:8,error:null,processCount:0,processIds:[]},
      {seq:9,at:'2026-01-01T00:00:00.000Z',question:'分支第二轮',answer:'分支第二轮回答',answerSeq:10,error:null,processCount:0,processIds:[]},
      {seq:11,at:'2026-01-01T00:00:00.000Z',question:'分支第三轮',answer:'分支第三轮回答',answerSeq:12,error:null,processCount:0,processIds:[]},
    ]    },
  ])

  const childTurns = cards.filter(card => card.dshThreadId === 'child')
  assert.equal(new Set(childTurns.map(card => card.position.y)).size, 1)
  assert.equal(childTurns[1].position.x, childTurns[0].position.x + 365)
  assert.equal(childTurns[2].position.x, childTurns[1].position.x + 365)
})

test('moves automatically placed cards below an occupied card instead of overlapping it', async () => {
  const { conversationCards } = await loadConversationCards()
  const cards = conversationCards([
    { id: 'first', parentId: null, position: { x: 86, y: 82 }, turns: [{ seq: 1, at: '2026-01-01T00:00:00.000Z', question: '第一条', answer: null, answerSeq: null, error: null, processCount: 0, processIds: [] }] },
    { id: 'second', parentId: null, position: { x: 86, y: 220 }, turns: [{ seq: 1, at: '2026-01-01T00:00:00.000Z', question: '第二条', answer: null, answerSeq: null, error: null, processCount: 0, processIds: [] }] },
  ])

  assert.equal(cards[0].position.y, 82)
  assert.ok(cards[1].position.y >= 400)
})

test('honors an in-memory dragged card position even far from the natural layout', async () => {
  const { conversationCards, state } = await loadConversationCards()
  state.cardPositions.set('session-1:turn:1', { x: 1280, y: 1280 })
  const cards = conversationCards([{
    id: 'session-1', parentId: null, position: { x: 86, y: 82 },
    turns: [
      {seq:1,at:'2026-01-01T00:00:00.000Z',question:'第一个问题',answer:'第一个回答',answerSeq:2,error:null,processCount:0,processIds:[]},
    ]  }])

  assert.equal(cards[0].position.x, 1280)
  assert.equal(cards[0].position.y, 1280)
})

test('does not move later turns when an earlier card is dragged', async () => {
  const { conversationCards, state } = await loadConversationCards()
  state.cardPositions.set('session-1:turn:1', { x: 1280, y: 1280 })
  const cards = conversationCards([{
    id: 'session-1', parentId: null, position: { x: 86, y: 82 },
    turns: [
      {seq:1,at:'2026-01-01T00:00:00.000Z',question:'第一个问题',answer:'第一个回答',answerSeq:2,error:null,processCount:0,processIds:[]},
      {seq:3,at:'2026-01-01T00:00:00.000Z',question:'第二个问题',answer:'第二个回答',answerSeq:4,error:null,processCount:0,processIds:[]},
    ]  }])

  assert.equal(cards[0].position.x, 1280)
  assert.equal(cards[1].position.x, 451)
  assert.equal(cards[1].position.y, 82)
})

test('keeps a dragged pending turn position after DSH assigns a source sequence', async () => {
  const { conversationCards, state } = await loadConversationCards()
  state.cardPositions.set('session-1:turn-index:0', { x: 740, y: 360 })
  const cards = conversationCards([{
    id: 'session-1', parentId: null, position: { x: 86, y: 82 },
    turns: [
      {seq:21,at:'2026-01-01T00:00:00.000Z',question:'第一个问题',answer:'第一个回答',answerSeq:22,error:null,processCount:0,processIds:[]},
    ]  }])

  assert.equal(cards[0].position.x, 740)
  assert.equal(cards[0].position.y, 360)
})

test('derives root card positions from the visible graph instead of stale persisted thread pixels', async () => {
  const { conversationCards } = await loadConversationCards()
  const cards = conversationCards([
    { id: 'dirty-root', parentId: null, position: { x: 86, y: 3200 }, turns: [{ seq: 1, at: '2026-01-01T00:00:00.000Z', question: '脏坐标会话', answer: null, answerSeq: null, error: null, processCount: 0, processIds: [] }] },
  ])

  assert.equal(cards[0].position.x, 86)
  assert.equal(cards[0].position.y, 82)
})

test('focuses a new-session draft before existing cards when initializing the canvas', async () => {
  const { initialCanvasCamera, state } = await loadConversationCards()
  state.draft = { kind: 'new', text: '', sending: false }
  state.zoom = 1
  const camera = initialCanvasCamera([{ id: 'old-card', position: { x: 86, y: 1600 } }])

  assert.equal(camera.x, -30)
  assert.equal(camera.y, -26)
})

test('collapsing a conversation card hides its complete linear descendant chain', async () => {
  const { conversationCards, conversationGraphView } = await loadConversationCards()
  const cards = conversationCards([{
    id: 'session-1', parentId: null,
    turns: [
      {seq:1,at:'2026-01-01T00:00:00.000Z',question:'第一轮',answer:'回答一',answerSeq:2,error:null,processCount:0,processIds:[]},
      {seq:3,at:'2026-01-01T00:00:00.000Z',question:'第二轮',answer:'回答二',answerSeq:4,error:null,processCount:0,processIds:[]},
      {seq:5,at:'2026-01-01T00:00:00.000Z',question:'第三轮',answer:'回答三',answerSeq:6,error:null,processCount:0,processIds:[]},
    ]  }])

  const graph = conversationGraphView(cards, new Set([cards[0].id]))
  assert.deepEqual(Array.from(graph.cards, card => card.id), [cards[0].id])
  assert.equal(graph.childCounts.get(cards[0].id), 1)
  assert.equal(graph.descendantCounts.get(cards[0].id), 2)
})

test('collapsing a fork point hides all branch descendants without hiding another root', async () => {
  const { conversationCards, conversationGraphView } = await loadConversationCards()
  const cards = conversationCards([
    {
      id: 'parent', parentId: null,
      turns: [
      {seq:1,at:'2026-01-01T00:00:00.000Z',question:'父问题',answer:'父回答',answerSeq:2,error:null,processCount:0,processIds:[]},
      {seq:5,at:'2026-01-01T00:00:00.000Z',question:'父追问',answer:'父追问回答',answerSeq:6,error:null,processCount:0,processIds:[]},
    ]    },
    {
      id: 'child', parentId: 'parent', sourceSeedLength: 4,
      turns: [
      {seq:4,at:'2026-01-01T00:00:00.000Z',question:'分支问题',answer:'分支回答',answerSeq:5,error:null,processCount:0,processIds:[]},
      {seq:6,at:'2026-01-01T00:00:00.000Z',question:'分支追问',answer:null,answerSeq:null,error:null,processCount:0,processIds:[]},
    ]    },
    { id: 'other-root', parentId: null, turns: [{ seq: 1, at: '2026-01-01T00:00:00.000Z', question: '独立会话', answer: null, answerSeq: null, error: null, processCount: 0, processIds: [] }] },
  ])
  const forkPoint = cards.find(card => card.dshThreadId === 'parent' && card.turnIndex === 0)
  const graph = conversationGraphView(cards, new Set([forkPoint.id]))

  assert.deepEqual(Array.from(graph.cards, card => card.question).sort(), ['父问题', '独立会话'].sort())
  assert.equal(graph.childCounts.get(forkPoint.id), 2)
  assert.equal(graph.descendantCounts.get(forkPoint.id), 3)
})

test('expanding a card restores descendants at their original coordinates', async () => {
  const { conversationCards, conversationGraphView } = await loadConversationCards()
  const cards = conversationCards([{
    id: 'session-1', parentId: null,
    turns: [
      {seq:1,at:'2026-01-01T00:00:00.000Z',question:'第一轮',answer:'回答一',answerSeq:2,error:null,processCount:0,processIds:[]},
      {seq:3,at:'2026-01-01T00:00:00.000Z',question:'第二轮',answer:null,answerSeq:null,error:null,processCount:0,processIds:[]},
    ]  }])
  const originalPositions = cards.map(card => ({ ...card.position }))

  assert.equal(conversationGraphView(cards, new Set([cards[0].id])).cards.length, 1)
  const expanded = conversationGraphView(cards, new Set()).cards
  assert.equal(expanded.length, 2)
  assert.deepEqual(expanded.map(card => ({ ...card.position })), originalPositions)
})

test('a new descendant remains hidden while its ancestor is collapsed', async () => {
  const { conversationCards, conversationGraphView } = await loadConversationCards()
  const initialCards = conversationCards([{
    id: 'session-1', parentId: null,
    turns: [
      {seq:1,at:'2026-01-01T00:00:00.000Z',question:'第一轮',answer:'回答一',answerSeq:2,error:null,processCount:0,processIds:[]},
      {seq:3,at:'2026-01-01T00:00:00.000Z',question:'第二轮',answer:null,answerSeq:null,error:null,processCount:0,processIds:[]},
    ]  }])
  const collapsedId = initialCards[0].id
  const updatedCards = conversationCards([{
    id: 'session-1', parentId: null,
    turns: [
      {seq:1,at:'2026-01-01T00:00:00.000Z',question:'第一轮',answer:'回答一',answerSeq:2,error:null,processCount:0,processIds:[]},
      {seq:3,at:'2026-01-01T00:00:00.000Z',question:'第二轮',answer:'回答二',answerSeq:4,error:null,processCount:0,processIds:[]},
      {seq:5,at:'2026-01-01T00:00:00.000Z',question:'后来新增的第三轮',answer:null,answerSeq:null,error:null,processCount:0,processIds:[]},
    ]  }])

  const graph = conversationGraphView(updatedCards, new Set([collapsedId]))
  assert.deepEqual(Array.from(graph.cards, card => card.question), ['第一轮'])
  assert.equal(graph.descendantCounts.get(collapsedId), 2)
})

test('nested collapsed nodes remain visible when their ancestor is expanded', async () => {
  const { conversationCards, conversationGraphView } = await loadConversationCards()
  const cards = conversationCards([{
    id: 'session-1', parentId: null,
    turns: [
      {seq:1,at:'2026-01-01T00:00:00.000Z',question:'第一轮',answer:'回答一',answerSeq:2,error:null,processCount:0,processIds:[]},
      {seq:3,at:'2026-01-01T00:00:00.000Z',question:'第二轮',answer:'回答二',answerSeq:4,error:null,processCount:0,processIds:[]},
      {seq:5,at:'2026-01-01T00:00:00.000Z',question:'第三轮',answer:null,answerSeq:null,error:null,processCount:0,processIds:[]},
    ]  }])

  const nested = conversationGraphView(cards, new Set([cards[0].id, cards[1].id]))
  assert.deepEqual(Array.from(nested.cards, card => card.question), ['第一轮', '第二轮'])
  const childOnly = conversationGraphView(cards, new Set([cards[1].id]))
  assert.deepEqual(Array.from(childOnly.cards, card => card.question), ['第一轮', '第二轮'])
})

test('cyclic collapsed roots stay visible and count unique descendants', async () => {
  const { conversationGraphView } = await loadConversationCards()
  const cards = [
    { id: 'a', parentId: 'b', dshThreadId: 'a' },
    { id: 'b', parentId: 'a', dshThreadId: 'b' },
  ]
  const graph = conversationGraphView(cards, new Set(['a', 'b']))

  assert.deepEqual(Array.from(graph.cards, card => card.id), ['a', 'b'])
  assert.equal(graph.descendantCounts.get('a'), 1)
  assert.equal(graph.descendantCounts.get('b'), 1)
})

test('a session with no projected turn still gets a readable card', async () => {
  const { conversationCards } = await loadConversationCards()
  // A created-but-unasked session (or a fork awaiting its first message) has
  // no turns at all. It must still render one card, with a real label rather
  // than the literal string "undefined".
  const [bare] = conversationCards([{ id: 'untitled', parentId: null }])
  assert.equal(bare.question, '等待用户提问')
  assert.equal(bare.canContinue, true)

  const [titled] = conversationCards([{ id: 'titled', parentId: null, title: '我的会话' }])
  assert.equal(titled.question, '我的会话')

  const [empty] = conversationCards([{ id: 'empty', parentId: null, turns: [] }])
  assert.equal(empty.question, '等待用户提问')
})

test('a fork stays visible when the host keeps the parent as its current session', async () => {
  const { conversationCards } = await loadConversationCards()
  // Branching no longer activates the fork, so `currentDsh` stays the parent.
  // threadFamily expands downward from the parent, so the branch must still be
  // on the canvas — while unrelated sessions stay out of the way.
  const state = { workspace: { id: 'w', threads: [
    { id: 'p', parentId: null, dshSessionId: 'parent-sess', turns: [{ seq: 1, at: '2026-01-01T00:00:00.000Z', question: '父问题', answer: '父回答', answerSeq: 2, error: null, processCount: 0, processIds: [] }] },
    { id: 'f', parentId: 'p', dshSessionId: 'fork-sess', turns: [], sourceSeedLength: 3 },
    { id: 'o', parentId: null, dshSessionId: 'other-sess', turns: [{ seq: 1, at: '2026-01-01T00:00:00.000Z', question: '无关会话', answer: 'a', answerSeq: 2, error: null, processCount: 0, processIds: [] }] },
  ] } }
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const snippet = source.slice(source.indexOf('function threadFamily'), source.indexOf('function workspaceChoices'))
  const run = new Function('state', 'conversationCards', `${snippet}\nreturn visibleThreads()`)
  const visible = run({ ...state, currentDsh: { id: 'parent-sess' } }, conversationCards)
  const ids = visible.map(thread => thread.dshSessionId)
  assert.ok(ids.includes('fork-sess'), 'the fork must remain on the canvas')
  assert.ok(ids.includes('parent-sess'))
  assert.ok(!ids.includes('other-sess'), 'unrelated sessions stay hidden')
})
