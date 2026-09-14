import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
const section = (start, end) => {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from, start)
  return source.slice(from, to)
}
const plain = value => JSON.parse(JSON.stringify(value))
const turn = (seq, hidden = false) => ({
  seq, messageId: `message-${seq}`, question: `Question ${seq}`, answer: `Answer ${seq}`,
  answerSeq: seq + 1, status: 'done', hidden,
})
const root = () => ({ id: 'root', dshSessionId: 'session', parentId: null, turns: [turn(1), turn(3, true), turn(5)] })

function harness(threads = [root()]) {
  const state = {
    workspace: { id: 'workspace', threads }, activeId: 'root', selectedCardId: null, inspectorCardId: null,
    draft: null, renamingCardId: null, visibilityMutation: null, visibilityVersion: 0,
    branchAnchors: new Map(), cardPositions: new Map(), liveReplies: new Map(), collapsedCardIds: new Set(),
    layoutLanes: new Map(), layoutPositions: new Map(),
  }
  const context = vm.createContext({
    state, CARD_WIDTH: 310, CARD_HEIGHT: 276, CARD_GAP_Y: 42, CAMERA_INSET_X: 56, CAMERA_INSET_Y: 56,
    turnsFor: thread => thread.turns,
    sessionStatusFor: () => null,
    persistCollapsedCards: () => {}, invalidateGraphCache: () => {},
    closeCardInspector: () => { state.inspectorCardId = null },
    // Native session lifecycle operations must never be part of hiding.
    dshRpc: () => { throw new Error('Unexpected native session operation') },
    post: () => { throw new Error('Unexpected session navigation') },
  })
  vm.runInContext([
    section('function cardState(', 'function cardStateLabel'),
    section('function cardHideReason', 'function dshRpc'),
    section('function overlapsCard', 'function canvasConnectors'),
  ].join('\n'), context)
  context.render = () => { state.canvasAllCards = context.conversationCards(state.workspace.threads) }
  context.requestCanvasRefresh = context.render
  context.render()
  context.api = async (_path, options) => {
    const body = JSON.parse(options.body)
    return { updates: body.cards.map(card => ({ ...card, hidden: body.hidden })) }
  }
  return context
}

test('a hidden fork point becomes a compact node without changing lineage or turn numbering', () => {
  const { state, conversationGraphView } = harness([
    root(),
    { id: 'fork', parentId: 'root', dshSessionId: 'fork-session', anchorCardId: 'root:turn:3', turns: [turn(7)] },
  ])
  const cards = state.canvasAllCards
  const snapshot = plain(cards)
  const graph = conversationGraphView(cards)
  assert.equal(graph.cards.length, 4)
  assert.equal(graph.hiddenCards.length, 1)
  assert.equal(graph.cards[1].hidden, true)
  assert.equal(graph.cards[1].turnIndex, 1)
  assert.equal(graph.cards[2].parentId, 'root:turn:3')
  assert.equal(graph.cards[3].parentId, 'root:turn:3')
  assert.equal(graph.childCounts.get('root:turn:3'), 2)
  assert.deepEqual(plain(cards), snapshot)
})

test('all cards can be hidden while keeping the true tail as the only follow-up target', () => {
  const thread = root()
  thread.turns.forEach(turn => { turn.hidden = true })
  const { state, conversationGraphView } = harness([thread])
  const graph = conversationGraphView(state.canvasAllCards)
  assert.equal(graph.cards.length, 3)
  assert.equal(graph.hiddenCards.length, 3)
  assert.deepEqual(Array.from(graph.cards, card => card.canContinue === true), [false, false, true])
})

test('hiding a collapsed card reveals its children without discarding the fold preference', () => {
  const { state, conversationGraphView } = harness()
  state.collapsedCardIds.add('root:turn:3')
  assert.equal(conversationGraphView(state.canvasAllCards).cards.length, 3)
  assert.equal(state.collapsedCardIds.has('root:turn:3'), true)
  state.workspace.threads[0].turns[1].hidden = false
  const context = harness(state.workspace.threads)
  assert.equal(context.conversationGraphView(context.state.canvasAllCards, state.collapsedCardIds).cards.length, 2)
})

test('hidden cards inside a folded subtree remain recoverable from the list', () => {
  const { state, conversationGraphView, expandedForRestoredCards } = harness()
  const collapsed = new Set(['root:turn:1', 'unrelated'])
  const graph = conversationGraphView(state.canvasAllCards, collapsed)
  assert.equal(graph.cards.length, 1)
  assert.equal(graph.hiddenCards[0].id, 'root:turn:3')
  const expanded = expandedForRestoredCards(state.canvasAllCards, ['root:turn:3'], collapsed)
  assert.deepEqual([...expanded], ['unrelated'])
  assert.equal(collapsed.has('root:turn:1'), true)
})

test('restoration keeps dragged positions and a new turn remains visible after a hidden tail', () => {
  const context = harness()
  const { state, conversationCards, conversationGraphView } = context
  state.cardPositions.set('root:turn:3', { x: 1100, y: 900 })
  state.workspace.threads[0].turns[2].hidden = true
  const before = conversationCards(state.workspace.threads)
  state.workspace.threads[0].turns.push(turn(7))
  const after = conversationCards(state.workspace.threads)
  assert.equal(after[3].hidden, false)
  assert.equal(after[3].parentId, 'root:turn:5')
  state.workspace.threads[0].turns[1].hidden = false
  const restored = conversationGraphView(conversationCards(state.workspace.threads))
  assert.deepEqual(plain(restored.cards[1].position), { x: 1100, y: 900 })
  assert.deepEqual(plain(after.slice(0, 3).map(card => card.position)), plain(before.map(card => card.position)))
})

test('compact node bounds and connectors retain the original node center', () => {
  const { state, canvasNodeBounds, connectorPath, connectorLinkBox } = harness()
  const first = canvasNodeBounds(state.canvasAllCards[0])
  const hidden = canvasNodeBounds(state.canvasAllCards[1])
  const card = state.canvasAllCards[1]
  assert.equal(hidden.width, 148)
  assert.equal(hidden.height, 32)
  assert.equal(hidden.x + hidden.width / 2, card.position.x + 155)
  assert.equal(hidden.y + hidden.height / 2, card.position.y + 138)
  const path = connectorPath(first, hidden)
  assert.ok(path.startsWith(`M ${first.x + first.width} ${first.y + first.height / 2}`))
  assert.ok(path.endsWith(`${hidden.x} ${hidden.y + hidden.height / 2}`))
  const box = connectorLinkBox(hidden, first)
  assert.ok(box.width > 0 && box.height > 0)
})

test('hide guards cover live turns, approvals, pending submissions and anchored drafts', () => {
  const { state, cardHideReason } = harness()
  const card = { ...state.canvasAllCards[2], hidden: false }
  for (const status of ['creating', 'queued', 'running']) {
    assert.ok(cardHideReason({ ...card, status }, { running: true }, null))
  }
  assert.ok(cardHideReason({ ...card, status: undefined, answer: null }, { pendingInteraction: 'approval' }, null))
  assert.ok(cardHideReason({ ...card, operationId: 'pending' }, null, null))
  assert.ok(cardHideReason({ ...card, blank: true }, null, null))
  assert.ok(cardHideReason(card, null, { kind: 'branch', parentId: 'root', anchorId: card.id }))
  assert.ok(cardHideReason(card, null, { kind: 'continue', parentId: 'root' }))
  assert.equal(cardHideReason(card, null, { kind: 'new' }), null)
  assert.equal(cardHideReason(state.canvasAllCards[0], { running: true }, null), null)
  assert.equal(cardHideReason({ ...card, status: 'cancelled' }, null, null), null)
})

test('visibility targets use raw indices for manual cards even when injected turns are filtered', () => {
  const { state } = harness([{
    id: 'manual', parentId: null, turns: [
      { seq: null, question: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.' },
      { seq: null, question: 'Manual note', answer: null },
    ],
  }])
  assert.equal(state.canvasAllCards.length, 1)
  assert.equal(state.canvasAllCards[0].visibilityTarget.cardKey, 'i1')
  assert.equal(state.canvasAllCards[0].visibilityTarget.cardId, 'manual:turn:i1')
})

test('a committed card uses its storage identity rather than its browser submission alias', async () => {
  const thread = root()
  thread.turns.forEach(turn => { delete turn.messageId })
  const context = harness([thread])
  context.turnsFor = thread => thread.turns.map(turn => ({ ...turn, cardId: `submission:${turn.seq}` }))
  context.render()
  const card = context.state.canvasAllCards[0]
  assert.equal(card.id, 'submission:1')
  assert.equal(card.visibilityTarget.cardId, 'root:turn:1')
  await context.changeCardVisibility([card.id], true)
  assert.equal(context.state.workspace.threads[0].turns[0].hidden, true)
  assert.equal(context.state.canvasAllCards[0].hidden, true)
})

test('visibility responses merge by identity without replacing newer answers or turns', () => {
  const { state, applyCardVisibilityUpdates } = harness()
  const target = state.canvasAllCards[1].visibilityTarget
  const threads = plain(state.workspace.threads)
  threads[0].turns[1].seq = 30
  threads[0].turns[1].answer = 'Newer answer'
  threads[0].turns.push(turn(40))
  const next = applyCardVisibilityUpdates(threads, [{ ...target, hidden: false }])
  assert.equal(next[0].turns[1].answer, 'Newer answer')
  assert.equal(next[0].turns[1].seq, 30)
  assert.equal(next[0].turns[1].hidden, undefined)
  assert.equal(next[0].turns.length, 4)
  assert.equal(threads[0].turns[1].hidden, true)
})

test('hiding is optimistic, never archives, and can be undone without changing the active session', async () => {
  const context = harness()
  const { state, changeCardVisibility } = context
  let resolve
  context.api = async (path, options) => {
    assert.equal(path, '/synapse/api/cards/visibility')
    assert.equal(options.method, 'PATCH')
    const body = JSON.parse(options.body)
    return new Promise(done => { resolve = () => done({ updates: body.cards.map(card => ({ ...card, hidden: body.hidden })) }) })
  }
  const promise = changeCardVisibility(['root:turn:1'], true)
  assert.equal(state.canvasAllCards[0].hidden, true)
  assert.equal(state.workspace.threads[0].turns[0].hidden, false)
  await assert.rejects(changeCardVisibility(['root:turn:5'], true), /正在保存/)
  state.workspace.threads[0].turns[0].answer = 'Newer answer'
  resolve()
  await promise
  assert.equal(state.workspace.threads[0].turns[0].hidden, true)
  assert.equal(state.workspace.threads[0].turns[0].answer, 'Newer answer')
  assert.equal(state.visibilityMutation, null)
  assert.equal(state.activeId, 'root')
  const undo = changeCardVisibility(['root:turn:1'], false)
  resolve()
  await undo
  assert.equal(state.canvasAllCards[0].hidden, false)
  assert.equal(state.workspace.threads[0].turns[0].hidden, undefined)
})

test('a failed save rolls back the optimistic display and remains retryable', async () => {
  const context = harness()
  context.api = async () => { throw new Error('Save failed') }
  await assert.rejects(context.changeCardVisibility(['root:turn:1'], true), /Save failed/)
  assert.equal(context.state.visibilityMutation, null)
  assert.equal(context.state.canvasAllCards[0].hidden, false)
})

test('finishing a hide requests an incremental refresh rather than remounting an active draft', async () => {
  const context = harness()
  let initialRenders = 0
  let incrementalRefreshes = 0
  const render = context.render
  context.render = () => { initialRenders++; render() }
  context.requestCanvasRefresh = () => { incrementalRefreshes++ }
  await context.changeCardVisibility(['root:turn:1'], true)
  assert.equal(initialRenders, 1)
  assert.equal(incrementalRefreshes, 1)
})

test('late visibility callbacks do not modify the new workspace or steal its selection', async () => {
  const context = harness()
  let resolve
  context.api = async (_path, options) => {
    const body = JSON.parse(options.body)
    return new Promise(done => { resolve = () => done({ updates: body.cards.map(card => ({ ...card, hidden: true })) }) })
  }
  const pending = context.changeCardVisibility(['root:turn:1'], true)
  const { state } = context
  state.workspace = { id: 'other-workspace', threads: [{ id: 'other', parentId: null, turns: [turn(11)] }] }
  state.activeId = 'other'
  state.selectedCardId = 'other:turn:11'
  state.inspectorCardId = 'other:turn:11'
  resolve()
  await pending
  assert.equal(state.activeId, 'other')
  assert.equal(state.selectedCardId, 'other:turn:11')
  assert.equal(state.inspectorCardId, 'other:turn:11')
  assert.equal(state.workspace.threads[0].turns[0].hidden, false)
})

test('bulk restoration retains confirmed batches when a later batch fails', async () => {
  const context = harness([{ id: 'root', parentId: null, turns: Array.from({ length: 205 }, (_, index) => turn(index * 2 + 1, true)) }])
  let count = 0
  context.api = async (_path, options) => {
    const body = JSON.parse(options.body)
    assert.ok(body.cards.length <= 100)
    if (++count === 2) throw new Error('Second batch failed')
    return { updates: body.cards.map(card => ({ ...card, hidden: false })) }
  }
  await assert.rejects(context.changeCardVisibility(context.state.canvasAllCards.map(card => card.id), false), /Second batch failed/)
  assert.equal(context.state.canvasAllCards.filter(card => card.hidden).length, 105)
  assert.equal(context.state.visibilityMutation, null)
})

test('restoring from the list expands folded ancestors without moving cards', async () => {
  const context = harness()
  context.state.collapsedCardIds.add('root:turn:1')
  const positions = plain(context.state.canvasAllCards.map(card => card.position))
  await context.changeCardVisibility(['root:turn:3'], false)
  assert.equal(context.state.collapsedCardIds.has('root:turn:1'), false)
  assert.deepEqual(plain(context.state.canvasAllCards.map(card => card.position)), positions)
})

test('a workspace fetch started before a visibility write is retried instead of reverting that write', async () => {
  const state = { workspace: { id: 'workspace', threads: [] }, workspaceLoad: 0, visibilityVersion: 0, activeId: 'root' }
  let resolve
  let calls = 0
  const context = vm.createContext({
    state,
    api: () => ++calls === 1 ? new Promise(done => { resolve = done })
      : Promise.resolve({ workspace: { id: 'workspace', threads: [{ id: 'root', turns: [turn(1, true)] }] } }),
    keepLiveCanvasThreads: threads => threads,
    reconcilePendingReplies: () => {}, resetCanvasCamera: () => {}, flushCanvasRefresh: () => {},
  })
  vm.runInContext(section('async function openWorkspace', 'async function refreshProjection'), context)
  const fetch = context.openWorkspace('workspace')
  state.visibilityVersion++
  resolve({ workspace: { id: 'workspace', threads: [{ id: 'root', turns: [turn(1, false)] }] } })
  await fetch
  assert.equal(calls, 2)
  assert.equal(state.workspace.threads[0].turns[0].hidden, true)
})
