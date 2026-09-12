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

test('shows a completed live reply on an unanswered projected turn without a pending state', async () => {
  const { conversationCards, state } = await loadConversationCards()
  state.liveReplies.set('session-live', { running: false, text: '已经完成的最终回答' })

  const [card] = conversationCards([{
    id: 'thread-live', parentId: null, dshSessionId: 'session-live', position: { x: 86, y: 82 },
    turns: [{ seq: 1, at: '2026-09-09T00:00:00.000Z', question: '新分支问题', answer: null, answerSeq: null, error: null, processCount: 0, processIds: [] }],
  }])

  assert.equal(card.answer.text, '已经完成的最终回答')
  assert.equal(card.answer.pending, false)
})

test('keeps the pending bridge until the projected turn contains its final result', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const start = source.indexOf('function pendingReplyFor')
  const end = source.indexOf('function persistedMessagesFor', start)
  const state = { pendingReplies: new Map(), liveReplies: new Map() }
  const context = { globalThis: {}, state }
  vm.createContext(context)
  vm.runInContext(`${source.slice(start, end)};globalThis.turnsFor = turnsFor`, context)
  const thread = {
    id: 'thread-live', dshSessionId: 'session-live',
    turns: [{ seq: 1, question: '新分支问题', answer: null, error: null }],
  }
  state.pendingReplies.set('session-live', { text: '新分支问题', at: Date.now() })
  state.liveReplies.set('session-live', { running: false, text: '最终回答' })

  context.globalThis.turnsFor(thread)
  assert.equal(state.pendingReplies.has('session-live'), true)
  assert.equal(state.liveReplies.has('session-live'), true)

  thread.turns[0].answer = '最终回答'
  context.globalThis.turnsFor(thread)
  assert.equal(state.pendingReplies.has('session-live'), true, 'reading cards cannot end a live operation')
  thread.turns[0].status = 'done'
  vm.runInContext('reconcilePendingReplies([testThread])', Object.assign(context, { testThread: thread }))
  assert.equal(state.pendingReplies.has('session-live'), false)
  assert.equal(state.liveReplies.has('session-live'), false)
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

test('reserves separate lanes for sibling branches that may grow later', async () => {
  const { conversationCards } = await loadConversationCards()
  const turn = (seq, question) => ({ seq, at: '2026-01-01T00:00:00.000Z', question, answer: `${question}回答`, answerSeq: seq + 1, error: null, processCount: 0, processIds: [] })
  const cards = conversationCards([
    {
      id: 'parent', parentId: null,
      turns: [turn(1, '父问题一'), turn(3, '父问题二'), turn(5, '父问题三')],
    },
    {
      id: 'early-fork', parentId: 'parent', anchorCardId: 'parent:turn:1',
      turns: [turn(7, '前面的分支')],
    },
    {
      id: 'late-fork', parentId: 'parent', anchorCardId: 'parent:turn:5',
      turns: [turn(9, '后面的分支')],
    },
  ])

  const early = cards.find(card => card.dshThreadId === 'early-fork')
  const late = cards.find(card => card.dshThreadId === 'late-fork')
  const parent = cards.find(card => card.dshThreadId === 'parent')
  assert.notEqual(early.position.y, late.position.y, 'a branch owns its lane even before it grows into neighboring columns')
  assert.ok(early.position.y > parent.position.y, 'the shared branch lane stays below the parent')
})

test('keeps horizontally overlapping sibling branches on separate lanes', async () => {
  const { conversationCards } = await loadConversationCards()
  const turn = (seq, question) => ({ seq, at: '2026-01-01T00:00:00.000Z', question, answer: `${question}回答`, answerSeq: seq + 1, error: null, processCount: 0, processIds: [] })
  const cards = conversationCards([
    { id: 'parent', parentId: null, turns: [turn(1, '父问题')] },
    { id: 'long-fork', parentId: 'parent', anchorCardId: 'parent:turn:1', turns: [turn(7, '长分支一'), turn(9, '长分支二')] },
    { id: 'short-fork', parentId: 'parent', anchorCardId: 'parent:turn:1', turns: [turn(11, '短分支')] },
  ])

  const longFork = cards.find(card => card.dshThreadId === 'long-fork')
  const shortFork = cards.find(card => card.dshThreadId === 'short-fork')
  assert.notEqual(longFork.position.y, shortFork.position.y, 'overlapping branches must not share a lane')
  assert.ok(longFork.position.y > cards.find(card => card.dshThreadId === 'parent').position.y)
  assert.ok(shortFork.position.y > cards.find(card => card.dshThreadId === 'parent').position.y)
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

test('avoids a manually locked card when placing a newly projected card', async () => {
  const { conversationCards, state } = await loadConversationCards()
  state.cardPositions.set('locked:turn:1', { x: 86, y: 400 })
  const cards = conversationCards([
    { id: 'locked', parentId: null, turns: [{ seq: 1, at: '2026-01-01T00:00:00.000Z', question: '已拖拽卡片', answer: null, answerSeq: null, error: null, processCount: 0, processIds: [] }] },
    { id: 'new', parentId: null, turns: [{ seq: 1, at: '2026-01-01T00:00:00.000Z', question: '新卡片', answer: null, answerSeq: null, error: null, processCount: 0, processIds: [] }] },
  ])

  const locked = cards.find(card => card.dshThreadId === 'locked')
  const newlyPlaced = cards.find(card => card.dshThreadId === 'new')
  assert.equal(locked.position.x, 86)
  assert.equal(locked.position.y, 400)
  assert.ok(newlyPlaced.position.y >= 718, 'the automatic card must move below the locked card')
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

test('a fresh fork with no projected turn still gets a readable card', async () => {
  const { conversationCards } = await loadConversationCards()
  // A branch the user just created is blank for the moments before its first
  // message lands. It must still render one card so the branch is watchable.
  const [fresh] = conversationCards([{ id: 'fresh', parentId: 'parent', createdAt: new Date().toISOString() }])
  assert.equal(fresh.question, '等待用户提问')
  assert.equal(fresh.canContinue, true)

  // An untouched new session is not waiting for anything: no card.
  assert.equal(conversationCards([{ id: 'untitled', parentId: null }]).length, 0)
  assert.equal(conversationCards([{ id: 'titled', parentId: null, title: '我的会话' }]).length, 0)
  assert.equal(conversationCards([{ id: 'empty', parentId: null, turns: [] }]).length, 0)
})

test('a blank branch stays on the map as part of the family tree at any age', async () => {
  const { conversationCards } = await loadConversationCards()
  // The fork exists in DSH's session list, so the map shows it even though it
  // never got a message — hiding it presented a lone chain where the user had
  // actually created a tree.
  const cards = conversationCards([
    {
      id: 'parent', parentId: null,
      turns: [{ seq: 1, at: '2026-01-01T00:00:00.000Z', question: '继续', answer: '好', answerSeq: 2, error: null, processCount: 0, processIds: [] }],
    },
    { id: 'ghost', parentId: 'parent', title: '当前会话 分支', createdAt: '2026-09-03T06:29:34.439Z', turns: [] },
  ])
  assert.equal(cards.length, 2)
  const blank = cards.find(card => card.dshThreadId === 'ghost')
  assert.equal(blank.question, '空分支')
  assert.equal(blank.blank, true)
  assert.equal(blank.parentId, cards[0].id, 'the empty branch still hangs off its parent conversation')
})

test('a blank session with no branch link stays off the canvas', async () => {
  const { conversationCards } = await loadConversationCards()
  // No parent node, no parent session, no question in flight: nothing ties
  // this session into any family, so it is clutter, not a tree node.
  assert.equal(conversationCards([{ id: 'lone', parentId: null, createdAt: '2026-09-03T06:29:34.439Z', turns: [] }]).length, 0)
})

test('a blank branch linked only by DSH parent session stays visible', async () => {
  const { conversationCards } = await loadConversationCards()
  const cards = conversationCards([
    { id: 'root', parentId: null, dshSessionId: 's-root', turns: [{ seq: 1, at: '2026-01-01T00:00:00.000Z', question: '父问题', answer: '父回答', answerSeq: 2, error: null, processCount: 0, processIds: [] }] },
    { id: 'orphan-blank', parentId: null, dshSessionId: 's-child', sourceParentSessionId: 's-root', createdAt: '2026-09-03T06:29:34.439Z', turns: [] },
  ])
  const blank = cards.find(card => card.dshThreadId === 'orphan-blank')
  assert.equal(blank.blank, true)
  assert.equal(blank.parentId, 'root:turn:1', 'the session-level link attaches the empty branch to its family')
})

test('only cards the user asked for reach the canvas', async () => {
  const { conversationCards } = await loadConversationCards()
  // 当前会话 and "<parent> 分支" are DSH's own generated names, and the
  // checkpoint and policy blocks are injected user-role text. None of them is
  // a question anyone asked, so none of them may appear as a card.
  assert.equal(conversationCards([{
    id: 'labeled', parentId: null, title: '当前会话', dshSessionTitle: '当前会话',
    turns: [{ seq: 1, at: '2026-01-01T00:00:00.000Z', question: '当前会话', answer: '总结', answerSeq: 2, error: null, processCount: 0, processIds: [] }],
  }]).length, 0)
  assert.equal(conversationCards([{
    id: 'checkpoint', parentId: null,
    turns: [{ seq: 3, at: '2026-01-01T00:00:00.000Z', question: 'This is an automatically generated checkpoint condensing an earlier span of the conversation', answer: '摘要', answerSeq: 4, error: null, processCount: 0, processIds: [] }],
  }]).length, 0)
  assert.equal(conversationCards([{
    id: 'policy', parentId: null,
    turns: [{ seq: 2, at: '2026-01-01T00:00:00.000Z', question: 'The approval policy changed from "ask" to "never".', answer: null, answerSeq: null, error: null, processCount: 0, processIds: [] }],
  }]).length, 0)

  // A real question is kept even though the session title is a generated one.
  const [real] = conversationCards([{
    id: 'real', parentId: null, title: '当前会话',
    turns: [{ seq: 1, at: '2026-01-01T00:00:00.000Z', question: '帮我改标题', answer: '好', answerSeq: 2, error: null, processCount: 0, processIds: [] }],
  }])
  assert.equal(real.question, '帮我改标题')
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
  // visibleThreads() resolves its anchor through currentDshThread(), so that
  // helper has to be in scope for the extracted snippet to run.
  const anchorHelper = source.slice(source.indexOf('function selectedDshWorkspace'), source.indexOf('function threadFamily'))
  const run = new Function('state', `${anchorHelper}\n${snippet}\nreturn visibleThreads()`)
  const visible = run({ ...state, currentDsh: { id: 'parent-sess' } })
  const ids = visible.map(thread => thread.dshSessionId)
  assert.ok(ids.includes('fork-sess'), 'the fork must remain on the canvas')
  assert.ok(ids.includes('parent-sess'))
  assert.ok(!ids.includes('other-sess'), 'unrelated sessions stay hidden')
  // Without a current session the workspace is kept rather than emptied, so
  // the canvas is never blank during the session/projection race.
  const noCurrent = run({ ...state, currentDsh: null, activeId: null })
  assert.equal(noCurrent.length, state.workspace.threads.length)
})

test('a child session renders its ancestor turns and every sibling branch chain', async () => {
  const { conversationCards } = await loadConversationCards()
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const anchorHelper = source.slice(source.indexOf('function selectedDshWorkspace'), source.indexOf('function threadFamily'))
  const familyScope = source.slice(source.indexOf('function threadFamily'), source.indexOf('function workspaceChoices'))
  const visibleThreads = new Function('state', `${anchorHelper}\n${familyScope}\nreturn visibleThreads()`)
  const turn = (seq, question) => ({ seq, at: '2026-09-09T00:00:00.000Z', question, answer: `${question}回答`, answerSeq: seq + 1, error: null, processCount: 0, processIds: [] })
  const threads = [
    { id: 'root', parentId: null, dshSessionId: 's-root', turns: [turn(1, '祖先一'), turn(3, '祖先二'), turn(5, '祖先三')] },
    { id: 'left', parentId: 'root', dshSessionId: 's-left', anchorCardId: 'root:turn:3', turns: [turn(7, '当前分支一'), turn(9, '当前分支二')] },
    { id: 'right', parentId: 'root', dshSessionId: 's-right', anchorCardId: 'root:turn:3', turns: [turn(11, '兄弟分支一'), turn(13, '兄弟分支二')] },
    { id: 'other', parentId: null, dshSessionId: 's-other', turns: [turn(1, '无关会话')] },
  ]

  const visible = visibleThreads({ workspace: { threads }, currentDsh: { id: 's-left' }, activeId: 'left' })
  assert.deepEqual(visible.map(thread => thread.id), ['root', 'left', 'right'])

  const cards = conversationCards(visible)
  const root = cards.filter(card => card.dshThreadId === 'root')
  const left = cards.filter(card => card.dshThreadId === 'left')
  const right = cards.filter(card => card.dshThreadId === 'right')
  assert.equal(Array.from(root, card => card.question).join(','), '祖先一,祖先二,祖先三')
  assert.equal(Array.from(left, card => card.question).join(','), '当前分支一,当前分支二')
  assert.equal(Array.from(right, card => card.question).join(','), '兄弟分支一,兄弟分支二')
  assert.equal(root[1].parentId, root[0].id)
  assert.equal(root[2].parentId, root[1].id)
  assert.equal(left[0].parentId, root[1].id)
  assert.equal(left[1].parentId, left[0].id)
  assert.equal(right[0].parentId, root[1].id)
  assert.equal(right[1].parentId, right[0].id)
  assert.notEqual(left[0].position.y, right[0].position.y, 'sibling branches occupy separate lanes')
  assert.equal(cards.some(card => card.dshThreadId === 'other'), false)
})

/** Extract the two branch-anchor resolvers so they can be unit-tested directly. */
async function loadAnchorResolvers() {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const start = source.indexOf('function branchAnchorFor')
  const end = source.indexOf('function canvasConnectors')
  const context = { globalThis: {}, state: { branchAnchors: new Map() } }
  vm.createContext(context)
  vm.runInContext(`${source.slice(start, end)};globalThis.branchAnchorFor = branchAnchorFor;globalThis.inheritedTurnFor = inheritedTurnFor`, context)
  return { branchAnchorFor: context.globalThis.branchAnchorFor, inheritedTurnFor: context.globalThis.inheritedTurnFor, state: context.state }
}

test('a branch prefers an anchor recorded on the server over sequence arithmetic', async () => {
  const { branchAnchorFor } = await loadAnchorResolvers()
  const parentCards = [{ id: 'p:t0', sourceSeq: 9, answerSeq: 681 }, { id: 'p:t1', sourceSeq: 688, answerSeq: 1329 }]

  // The anchor names the exact turn, even though the seed would point earlier.
  assert.equal(branchAnchorFor({ anchorCardId: 'p:t1' }, parentCards), 'p:t1')
  // An anchor that names a card outside the parent thread is stale, not truth.
  assert.equal(branchAnchorFor({ anchorCardId: 'other:t9' }, parentCards), undefined)
  // No anchor, no parent cards: nothing to attach to.
  assert.equal(branchAnchorFor({}, undefined), undefined)
})

test('a browser-only anchor still resolves when the server has none', async () => {
  const { branchAnchorFor, state } = await loadAnchorResolvers()
  const parentCards = [{ id: 'p:t0', sourceSeq: 9, answerSeq: 681 }]

  state.branchAnchors.set('fork-sess', 'p:t0')
  assert.equal(branchAnchorFor({ anchorCardId: undefined, dshSessionId: 'fork-sess' }, parentCards), 'p:t0')
  // A fork from another session must not borrow this anchor.
  assert.equal(branchAnchorFor({ anchorCardId: undefined, dshSessionId: 'other-sess' }, parentCards), undefined)
})

test('a zero seed is a real fork boundary, not a missing one', async () => {
  const { inheritedTurnFor } = await loadAnchorResolvers()
  const parentCards = [{ id: 'p:t0', sourceSeq: 9, answerSeq: 681 }, { id: 'p:t1', sourceSeq: 688, answerSeq: 1329 }]

  // A usable boundary selects the last turn that finishes by then. This is the
  // case that used to break: a truthiness check treated seed 0 as "no seed".
  assert.equal(inheritedTurnFor({ sourceSeedLength: 681 }, parentCards, [{ sourceSeq: 2000 }]), 'p:t0')
  assert.equal(inheritedTurnFor({ sourceSeedLength: 1329 }, parentCards, [{ sourceSeq: 2000 }]), 'p:t1')
  // seed 0 cuts before every turn, and a child numbered past the parent
  // continues its numbering, so nothing was inherited at the turn level.
  assert.equal(inheritedTurnFor({ sourceSeedLength: 0 }, parentCards, [{ sourceSeq: 2000 }]), undefined)
  // With no seed at all, a child that continues the parent's numbering copied
  // every earlier turn, so the branch left after the last one it inherited.
  assert.equal(inheritedTurnFor({ sourceSeedLength: null }, parentCards, [{ sourceSeq: 2000 }]), 'p:t1')
})

test('a fork whose seq space differs falls back to the shared inherited prefix', async () => {
  const { inheritedTurnFor } = await loadAnchorResolvers()
  const parentCards = [{ id: 'p:t0', sourceSeq: 9, answerSeq: 681 }, { id: 'p:t1', sourceSeq: 688, answerSeq: 1329 }]

  // The child re-counts from its own origin (seq 7/8), so `sourceSeedLength` of
  // 0 or null can never match. The turn the child shares with its parent is the
  // only reliable evidence left.
  assert.equal(inheritedTurnFor({ sourceSeedLength: 0 }, parentCards, [{ sourceSeq: 9, answerSeq: 681 }]), 'p:t0')
  assert.equal(inheritedTurnFor({ sourceSeedLength: null }, parentCards, [{ sourceSeq: 9, answerSeq: 681 }]), 'p:t0')
  // A child with nothing to compare inherited nothing we can see.
  assert.equal(inheritedTurnFor({ sourceSeedLength: 0 }, parentCards, []), undefined)
  assert.equal(inheritedTurnFor({ sourceSeedLength: 0 }, parentCards, undefined), undefined)
})

test('an unplaceable branch attaches beside its parent instead of the canvas origin', async () => {
  const { conversationCards } = await loadConversationCards()
  // Cross-space forks (child seq 7, parent seq 9) cannot be matched by seq at
  // all. They must still hang off the parent's first card, and be flagged, so
  // they never collapse onto x=86 where they overlap the parent chain.
  const cards = conversationCards([
    { id: 'p', parentId: null, turns: [{ seq: 9, at: '2026-01-01T00:00:00.000Z', question: '父问题', answer: '父回答', answerSeq: 681, error: null, processCount: 0, processIds: [] }] },
    { id: 'f', parentId: 'p', sourceSeedLength: 0, turns: [{ seq: 7, at: '2026-01-01T00:00:00.000Z', question: '分支问题', answer: '分支回答', answerSeq: 739, error: null, processCount: 0, processIds: [] }] },
  ])
  const fork = cards.find(card => card.dshThreadId === 'f')
  assert.equal(fork.parentId, 'p:turn:9', 'the branch attaches to its parent conversation')
  assert.equal(fork.anchorInferred, true, 'an inferred attachment is flagged as unknown')
  assert.ok(fork.position.x > 86, `the branch sits beside its parent, not at the origin (x=${fork.position.x})`)
  // A normal anchored fork is not flagged.
  const anchored = conversationCards([
    { id: 'p2', parentId: null, turns: [{ seq: 9, at: '2026-01-01T00:00:00.000Z', question: '父2', answer: '答2', answerSeq: 681, error: null, processCount: 0, processIds: [] }] },
    { id: 'f2', parentId: 'p2', anchorCardId: 'p2:turn:9', turns: [{ seq: 3000, at: '2026-01-01T00:00:00.000Z', question: '分支2', answer: '答', answerSeq: 3100, error: null, processCount: 0, processIds: [] }] },
  ]).find(card => card.dshThreadId === 'f2')
  assert.notEqual(anchored.anchorInferred, true, 'a real anchor is never flagged as unknown')
})

test('a fork whose Synapse parent is missing still attaches through DSH parent session', async () => {
  const { conversationCards } = await loadConversationCards()
  // DSH records the fork on the session itself (sourceParentSessionId). When
  // the parent thread has not been projected, that link is the only thing
  // keeping the branch off the canvas origin — without it the card gets a null
  // parent and piles up on top of the root chain.
  const cards = conversationCards([
    { id: 'root', parentId: null, dshSessionId: 's-root', turns: [{ seq: 1, at: '2026-01-01T00:00:00.000Z', question: '父问题', answer: '父回答', answerSeq: 2, error: null, processCount: 0, processIds: [] }] },
    { id: 'orphan', parentId: null, dshSessionId: 's-orphan', sourceParentSessionId: 's-root', turns: [{ seq: 5, at: '2026-01-01T00:00:00.000Z', question: '分支问题', answer: '分支回答', answerSeq: 6, error: null, processCount: 0, processIds: [] }] },
  ])

  const orphan = cards.find(card => card.dshThreadId === 'orphan')
  const root = cards.find(card => card.dshThreadId === 'root')
  assert.equal(orphan.parentId, root.id)
  // It sits beside the parent chain, not at the canvas origin.
  assert.notEqual(orphan.position.x, root.position.x)
  assert.notEqual(orphan.position.y, root.position.y)
})

test('a session-linked fork lanes inside its parent subtree, not after every root', async () => {
  const { conversationCards } = await loadConversationCards()
  // The fork's Synapse parentId was never written (a reload raced its
  // creation); only DSH's sourceParentSessionId ties it to the root. Lane
  // assignment must follow that link too — treating the fork as a root parks
  // it in the last lane, below the parent's whole subtree, with its connector
  // stretched across the canvas.
  const turn = (seq, q) => ({ seq, at: '2026-01-01T00:00:00.000Z', question: q, answer: `${q}答`, answerSeq: seq + 1, error: null, processCount: 0, processIds: [] })
  const cards = conversationCards([
    { id: 'root', parentId: null, dshSessionId: 's-root', turns: [turn(1, '根问题')] },
    { id: 'session-fork', parentId: null, dshSessionId: 's-fork', sourceParentSessionId: 's-root', turns: [turn(5, '早到的岔路')] },
    { id: 'child', parentId: 'root', dshSessionId: 's-child', turns: [turn(9, '子代问题')] },
    { id: 'grandchild', parentId: 'child', dshSessionId: 's-grand', turns: [turn(13, '孙代问题')] },
  ])

  const fork = cards.find(card => card.dshThreadId === 'session-fork')
  const child = cards.find(card => card.dshThreadId === 'child')
  const grandchild = cards.find(card => card.dshThreadId === 'grandchild')
  assert.equal(fork.parentId, 'root:turn:1', 'the session link still anchors the connector')
  // The fork is a direct child of the root, so its lane sits above the deeper
  // subtree members instead of below all of them.
  assert.ok(fork.position.y < child.position.y, `fork lane (${fork.position.y}) must sit above the child lane (${child.position.y})`)
  assert.ok(fork.position.y < grandchild.position.y, `fork lane (${fork.position.y}) must sit above the grandchild lane (${grandchild.position.y})`)
})

test('a just-created branch attaches to its parent card immediately', async () => {
  const { conversationCards } = await loadConversationCards()
  const cards = conversationCards([
    {
      id: 'p', parentId: null, dshSessionId: 's-p',
      turns: [{ seq: 1, at: '2026-01-01T00:00:00.000Z', question: '父问题', answer: '父回答', answerSeq: 2, error: null, processCount: 0, processIds: [] }],
    },
    {
      id: 'f', parentId: 'p', dshSessionId: 's-f', createdAt: new Date().toISOString(),
      anchorCardId: 'p:turn:1', turns: [],
    },
  ])
  const parent = cards.find(card => card.dshThreadId === 'p')
  const fork = cards.find(card => card.dshThreadId === 'f')
  assert.equal(fork.parentId, parent.id, 'the connector must have a parent the moment the branch is created')
  assert.ok(fork.position.x !== parent.position.x || fork.position.y !== parent.position.y)
})

test('submitting a branch immediately materializes its card and starts the fork stream', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const pendingSource = source.slice(source.indexOf('function pendingReplyFor'), source.indexOf('function persistedMessagesFor'))
  const targetSource = source.slice(source.indexOf('function branchTargetFor'), source.indexOf('function openBranch'))
  const submitSource = source.slice(source.indexOf('async function submitDraft'), source.indexOf('function threadsById'))
  const parent = {
    id: 'parent', parentId: null, dshSessionId: 's-parent', color: '#3478f6',
    turns: [{ seq: 1, at: '2026-09-09T00:00:00.000Z', question: '父问题', answer: '父回答', answerSeq: 2, error: null, processCount: 0, processIds: [] }],
  }
  const state = {
    workspace: { id: 'workspace', threads: [parent] },
    currentDsh: { id: 's-parent' },
    selectedDshWorkspaceId: 'workspace',
    activeId: 'parent',
    draft: { kind: 'branch', parentId: 'parent', atSeq: 2, anchorId: 'parent:turn:1', text: '立即开始的分支问题', sending: false },
    pendingReplies: new Map(),
    liveReplies: new Map(),
    mapCardSessionSwitches: new Set(),
    canvasCardsById: new Map([['parent:turn:1', { id: 'parent:turn:1', sourceSeq: 1, answerSeq: 2 }]]),
    error: '',
  }
  const rpcCalls = []
  const reveals = []
  const anchors = []
  let resolveFork
  const forkGate = new Promise(resolve => { resolveFork = resolve })
  const context = {
    globalThis: {}, state, crypto: { randomUUID: () => 'test-operation' },
    draftPlacement: () => ({ position: { x: 451, y: 400 } }),
    conversationCards: threads => threads,
    visibleThreads: () => state.workspace.threads,
    render: () => {},
    revealConversationThread: (_cards, threadId) => { reveals.push(`family:${threadId}`) },
    revealThreadLatestCard: threadId => { reveals.push(`latest:${threadId}`) },
    dshRpc: (type, payload) => {
      rpcCalls.push({ type, payload })
      return type === 'synapse:fork-session' ? forkGate : Promise.resolve({})
    },
    api: async path => path.endsWith('/turn-cursor') ? { lastUserSeq: 2 }
      : ({ thread: { id: 'child', parentId: 'parent', dshSessionId: 's-child', dshSessionTitle: '子分支', turns: [], createdAt: '2026-09-09T00:00:00.000Z' } }),
    requestCanvasRefresh: () => {},
    rememberBranchAnchor: (sessionId, anchorId) => { anchors.push(`${sessionId}:${anchorId}`) },
    loadThreadHistory: () => {},
    refreshProjection: async () => {},
    setError: error => { state.error = error instanceof Error ? error.message : String(error) },
    window: { setTimeout: () => {} },
  }
  vm.createContext(context)
  vm.runInContext(`${pendingSource}\n${targetSource}\n${submitSource};globalThis.submitDraft = submitDraft;globalThis.turnsFor = turnsFor`, context)

  const submission = context.globalThis.submitDraft()
  const optimistic = state.workspace.threads.find(thread => thread.optimistic === true)
  assert.ok(optimistic, 'the branch thread exists before the fork RPC resolves')
  assert.equal(state.activeId, optimistic.id)
  assert.equal(state.pendingReplies.get(optimistic.id).text, '立即开始的分支问题')
  assert.equal(context.globalThis.turnsFor(optimistic).at(-1).question, '立即开始的分支问题')
  assert.equal(rpcCalls[0].type, 'synapse:fork-session')
  assert.equal(rpcCalls[0].payload.sessionId, 's-parent')
  assert.equal(rpcCalls[0].payload.target.seq, 1)
  assert.equal(rpcCalls[0].payload.target.reference.question, '父问题')
  assert.equal(rpcCalls[0].payload.atSeq, undefined)
  assert.ok(reveals.includes(`family:${optimistic.id}`))
  assert.ok(reveals.includes(`latest:${optimistic.id}`))
  assert.equal(state.currentDsh.id, 's-parent', 'creating a branch keeps the map on the current host session')

  resolveFork({ id: 's-child', title: '子分支' })
  await submission

  const child = state.workspace.threads.find(thread => thread.id === 'child')
  assert.ok(child)
  assert.equal(state.workspace.threads.some(thread => thread.id === optimistic.id), false)
  assert.equal(state.activeId, 'child')
  assert.equal(state.pendingReplies.has(optimistic.id), false)
  assert.equal(state.pendingReplies.get('s-child').text, '立即开始的分支问题')
  assert.equal(context.globalThis.turnsFor(child).at(-1).question, '立即开始的分支问题')
  assert.equal(rpcCalls.map(call => call.type).join(','), 'synapse:fork-session,synapse:send-message')
  assert.equal(rpcCalls[1].payload.sessionId, 's-child')
  assert.equal(rpcCalls.some(call => call.type === 'synapse:activate-session'), false)
  assert.equal(reveals.filter(value => value.startsWith('latest:')).length, 1, 'an asynchronous result must not steal the camera again')
  assert.deepEqual(anchors, ['s-child:parent:turn:1'])
})

async function loadKeepLiveCanvasThreads() {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const fresh = source.slice(source.indexOf('function isFreshBlankFork'), source.indexOf('function conversationCards'))
  const keep = source.slice(source.indexOf('function keepLiveCanvasThreads'), source.indexOf('async function openDshWorkspace'))
  const context = { globalThis: {}, state: { workspace: { threads: [] }, pendingReplies: new Map() } }
  vm.createContext(context)
  vm.runInContext(`${fresh}\n${keep};globalThis.keepLiveCanvasThreads = keepLiveCanvasThreads`, context)
  return { keepLiveCanvasThreads: context.globalThis.keepLiveCanvasThreads, state: context.state }
}

test('a workspace reload keeps a just-created branch and restores its parent link', async () => {
  const { keepLiveCanvasThreads, state } = await loadKeepLiveCanvasThreads()
  const localFork = {
    id: 'fork-local', parentId: 'p', dshSessionId: 's-fork', createdAt: new Date().toISOString(),
    sourceParentSessionId: 's-parent', anchorCardId: 'p:turn:1',
  }
  state.workspace.threads = [
    { id: 'p', parentId: null, dshSessionId: 's-parent' },
    localFork,
  ]
  state.pendingReplies.set('s-fork', { text: '分支问题', at: Date.now() })

  // The fetch raced the branch POST: the new node is missing entirely.
  const omitted = keepLiveCanvasThreads([{ id: 'p', parentId: null, dshSessionId: 's-parent' }])
  assert.equal(omitted.some(thread => thread.id === 'fork-local'), true, 'the optimistic branch must survive the reload')
  assert.equal(omitted.find(thread => thread.id === 'fork-local').parentId, 'p')

  // The fetch saw the session, but as an unlinked root — the connector would vanish.
  const staleRoot = keepLiveCanvasThreads([
    { id: 'p', parentId: null, dshSessionId: 's-parent' },
    { id: 'fork-local', parentId: null, dshSessionId: 's-fork' },
  ])
  const restored = staleRoot.find(thread => thread.id === 'fork-local')
  assert.equal(restored.parentId, 'p')
  assert.equal(restored.anchorCardId, 'p:turn:1')
  assert.equal(restored.sourceParentSessionId, 's-parent')
})
