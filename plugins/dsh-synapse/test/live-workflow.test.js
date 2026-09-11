import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { buildTurnDetail, WorkspaceStore } from '../index.js'

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')
const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const section = (source, start, end) => {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from, `missing boundary: ${start}`)
  return source.slice(from, to)
}
const evaluate = (code, values = {}) => {
  const context = vm.createContext(values)
  vm.runInContext(code, context)
  return context
}
const turn = (seq, question, answer = 'answer') => ({ seq, question, answer, answerSeq: seq + 1, error: null })

function pendingHarness() {
  const state = { pendingReplies: new Map(), liveReplies: new Map(), cardIds: new Map() }
  return evaluate(section(app, 'function pendingReplyFor', 'function persistedMessagesFor'), { state })
}

test('a repeated prompt gets a new card instead of matching an old completed turn', () => {
  const { state, turnsFor } = pendingHarness()
  state.pendingReplies.set('s', { id: 'op', cardId: 'card-op', text: 'continue', at: 10, baseSeq: 1, baseCount: 1, phase: 'queued' })
  const cards = turnsFor({ id: 't', dshSessionId: 's', turns: [turn(1, 'continue')] })
  assert.equal(cards.length, 2)
  assert.equal(cards[1].cardId, 'card-op')
  assert.equal(state.pendingReplies.has('s'), true)
})

test('a long prompt reconciles by sequence without a duplicate synthetic tail', () => {
  const { state, turnsFor } = pendingHarness()
  state.pendingReplies.set('s', { id: 'op', cardId: 'card-op', text: 'x'.repeat(650), at: 10, baseSeq: 1, baseCount: 1, phase: 'queued' })
  const cards = turnsFor({ id: 't', dshSessionId: 's', turns: [turn(1, 'old'), turn(5, 'x'.repeat(600) + '…', null)] })
  assert.equal(cards.length, 2)
  assert.equal(cards[1].cardId, 'card-op')
  assert.equal(cards[1].seq, 5)
  assert.equal(state.pendingReplies.has('s'), true)
})

test('an intermediate assistant step does not finish the pending operation', () => {
  const { state, turnsFor } = pendingHarness()
  state.pendingReplies.set('s', { id: 'op', cardId: 'card-op', text: 'q', at: 10, baseSeq: -1, baseCount: 0, phase: 'running' })
  turnsFor({ id: 't', dshSessionId: 's', turns: [{ ...turn(1, 'q', 'checking files'), status: 'running' }] })
  assert.equal(state.pendingReplies.has('s'), true)
})

test('the same frame processes every dirty session, deduplicating only that session', () => {
  const frames = []
  const patched = []
  const context = evaluate(section(app, 'let liveCardFrame =', 'function applyLiveReplyToCard'), {
    window: { requestAnimationFrame: callback => { frames.push(callback); return frames.length } },
    state: { dragging: false, canvasGesture: false },
    applyLiveReplyToCard: id => { patched.push(id) },
  })
  context.scheduleLiveCardUpdate('a')
  context.scheduleLiveCardUpdate('b')
  context.scheduleLiveCardUpdate('a')
  context.scheduleLiveCardUpdate('c')
  assert.equal(frames.length, 1)
  frames[0]()
  assert.deepEqual(patched.sort(), ['a', 'b', 'c'])
})

test('continuing one branch leaves existing sibling coordinates unchanged', () => {
  const context = evaluate(section(app, 'function overlapsCard', 'function canvasConnectors'), {
    CARD_WIDTH: 310, CARD_HEIGHT: 276, CARD_GAP_Y: 42, CAMERA_INSET_X: 56, CAMERA_INSET_Y: 56,
    turnsFor: thread => thread.turns,
    state: { branchAnchors: new Map(), cardPositions: new Map(), liveReplies: new Map(), collapsedCardIds: new Set(), layoutLanes: new Map(), layoutPositions: new Map() },
  })
  const threads = [
    { id: 'p', parentId: null, turns: [turn(1, 'q1'), turn(3, 'q2'), turn(5, 'q3')] },
    { id: 'a', parentId: 'p', anchorCardId: 'p:turn:1', turns: [turn(10, 'a1')] },
    { id: 'b', parentId: 'p', anchorCardId: 'p:turn:5', turns: [turn(20, 'b1')] },
  ]
  const before = context.conversationCards(threads)
  threads[1].turns.push(turn(12, 'a2'), turn(14, 'a3'))
  const after = context.conversationCards(threads)
  for (const card of before) {
    const next = after.find(item => item.id === card.id)
    assert.deepEqual(next.position, card.position, card.id)
  }
  const positions = after.map(card => card.position)
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) assert.equal(context.overlapsCard(positions[i], positions[j]), false)
  }
})

test('an unloaded historical turn never borrows the current live tail', () => {
  const helpers = new Function(`${section(client, 'const seqOf =', 'const MARKDOWN_CODE_LABELS')}; return { sliceTurnKeysLive, isLastUserTurn }`)()
  const chat = { order: ['u', 'a'], nodes: new Map([
    ['u', { kind: 'user', anchorSeq: 200 }],
    ['a', { kind: 'assistant-step', anchorSeq: 201 }],
  ]) }
  assert.deepEqual(helpers.sliceTurnKeysLive(chat, 5, 0, true), [])
  assert.equal(helpers.isLastUserTurn(chat, 5, 0), false)
})

test('detail lookup with an unknown explicit sequence does not return the first turn', () => {
  const events = [{ seq: 1, time: 1, type: 'user/message', data: { content: [{ type: 'text', text: 'first' }] } }]
  assert.equal(buildTurnDetail(events, 999, 0).question, null)
})

test('detail and projection agree that non-human messages do not start another turn', () => {
  const events = [
    { seq: 1, time: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'question' }] } },
    { seq: 2, time: 2, type: 'user/message', data: { source: { kind: 'tool' }, content: [{ type: 'text', text: 'injected context' }] } },
    { seq: 3, time: 3, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'answer' }] } } },
  ]
  assert.equal(buildTurnDetail(events, 1).steps[0]?.text, 'answer')
})

function submissionHarness(overrides = {}) {
  const parent = { id: 'p', dshSessionId: 's-p', parentId: null, turns: [turn(1, 'old')] }
  const state = {
    workspace: { id: 'A', cwd: '/work', threads: [parent] },
    activeId: 'p', currentDsh: { id: 's-p', cwd: '/work' }, selectedDshWorkspaceId: 'A',
    canvasCamera: { x: 10, y: 20 }, canvasCardsById: new Map(),
    pendingReplies: new Map(), liveReplies: new Map(), submissions: new Map(),
    layoutLanes: new Map(), layoutPositions: new Map(), cardIds: new Map(),
    draft: { kind: 'branch', parentId: 'p', anchorId: 'p:turn:1', atSeq: 2, text: 'new question' },
  }
  const calls = []
  const context = evaluate([
    section(app, 'function branchTargetFor', 'function openBranch'),
    section(app, 'async function submitDraft', 'function threadsById'),
    section(app, 'function pendingReplyFor', 'function persistedMessagesFor'),
  ].join('\n'), {
    state, crypto: webcrypto, Error,
    draftPlacement: () => ({ position: { x: 451, y: 400 } }),
    conversationCards: threads => threads,
    visibleThreads: () => state.workspace.threads,
    render() {}, requestCanvasRefresh() {}, revealConversationThread() {}, revealThreadLatestCard() {},
    rememberBranchAnchor() {}, refreshProjection: async () => {},
    setError: message => { state.error = String(message) },
    dshRpc: async type => {
      calls.push(type)
      return { id: 's-child', title: 'child' }
    },
    api: async path => path.endsWith('/turn-cursor') ? { lastUserSeq: 2 }
      : { thread: { id: 'child', dshSessionId: 's-child', parentId: 'p', turns: [] } },
    ...overrides,
  })
  return { ...context, calls }
}

test('a failed fork keeps its question and card for retry', async () => {
  const h = submissionHarness({ dshRpc: async () => { throw new Error('fork failed') } })
  await h.submitDraft()
  const operation = [...h.state.submissions.values()][0]
  assert.equal(operation.phase, 'failed')
  assert.equal(h.state.workspace.threads.length, 2)
  const card = h.turnsFor(operation.thread)[0]
  assert.equal(card.question, 'new question')
  assert.equal(card.error, 'fork failed')
  assert.equal(card.cardId, operation.cardId)
})

test('a historical card submission keeps its own message identity and sends only the new prompt', async () => {
  const calls = []
  const h = submissionHarness({ dshRpc: async (type, payload) => {
    calls.push({ type, payload })
    return type === 'synapse:fork-session' ? { id: 's-child', sourceAnchorSeq: 4 } : {}
  } })
  const parent = h.state.workspace.threads[0]
  parent.turns = [
    { ...turn(1, 'first'), messageId: 'u1' },
    { ...turn(3, 'second'), cardId: 'p:turn:1654', messageId: 'u2', title: 'custom title' },
    { ...turn(5, 'expand'), messageId: 'u3' },
  ]
  h.state.draft = { kind: 'branch', parentId: 'p', anchorId: 'p:turn:1654', atSeq: 3408, text: 'my new prompt' }
  await h.submitDraft()
  assert.deepEqual(calls.map(call => call.type), ['synapse:fork-session', 'synapse:send-message'])
  const fork = calls[0].payload
  assert.equal(fork.target.seq, 3)
  assert.equal(fork.target.reference.messageId, 'u2')
  assert.equal(fork.target.reference.question, 'second')
  assert.equal(fork.atSeq, undefined)
  assert.equal(calls[1].payload.text, 'my new prompt')
  assert.equal(calls[1].payload.sessionId, 's-child')
  const operation = [...h.state.submissions.values()][0]
  assert.equal(operation.sourceAnchorSeq, 4)
  assert.equal(operation.anchorId, 'p:turn:1654')
})

test('a missing selected card cannot silently create a branch at the latest reply', async () => {
  const h = submissionHarness()
  h.state.draft.anchorId = 'p:turn:missing'
  await assert.rejects(h.submitDraft(), /无法定位/)
  assert.equal(h.calls.length, 0)
  assert.equal(h.state.workspace.threads.length, 1)
  assert.equal(h.state.draft.text, 'new question')
})

test('retrying a send failure reuses the created fork and the same card', async () => {
  let forks = 0
  let sends = 0
  const h = submissionHarness({ dshRpc: async type => {
    if (type === 'synapse:fork-session') { forks++; return { id: 's-child' } }
    if (++sends === 1) throw new Error('send failed')
    return {}
  } })
  await h.submitDraft()
  const operation = [...h.state.submissions.values()][0]
  const cardId = operation.cardId
  assert.equal(operation.phase, 'failed')
  await h.runSubmission(operation)
  assert.equal(forks, 1)
  assert.equal(sends, 2)
  assert.equal(operation.cardId, cardId)
  assert.equal(h.state.workspace.threads.length, 2)
  assert.equal(operation.accepted, true)
})

test('a delayed fork response does not insert into or select another workspace', async () => {
  let resolveFork
  const gate = new Promise(resolve => { resolveFork = resolve })
  const h = submissionHarness({ dshRpc: type => type === 'synapse:fork-session' ? gate : Promise.resolve({}) })
  const origin = h.state.workspace
  const submission = h.submitDraft()
  h.state.workspace = { id: 'B', threads: [{ id: 'other', dshSessionId: 'other-session' }] }
  h.state.activeId = 'other'
  h.state.selectedCardId = 'other-card'
  const camera = h.state.canvasCamera
  resolveFork({ id: 's-child' })
  await submission
  assert.equal(h.state.workspace.threads.length, 1)
  assert.equal(h.state.activeId, 'other')
  assert.equal(h.state.selectedCardId, 'other-card')
  assert.equal(h.state.canvasCamera, camera)
  assert.ok(origin.threads.some(thread => thread.id === 'child'))
})

test('new conversations materialize before the create request resolves', async () => {
  let resolveCreate
  const gate = new Promise(resolve => { resolveCreate = resolve })
  const h = submissionHarness({ dshRpc: type => type === 'synapse:create-session' ? gate : Promise.resolve({}) })
  h.state.draft = { kind: 'new', text: 'first question' }
  const pending = h.submitDraft()
  const operation = [...h.state.submissions.values()][0]
  assert.equal(h.turnsFor(operation.thread)[0].cardId, operation.cardId)
  assert.equal(operation.phase, 'creating')
  resolveCreate({ id: 'new-session' })
  await pending
  assert.equal(operation.sessionId, 'new-session')
})

test('a migrated host cursor can replace a larger cached sequence before sending', async () => {
  const h = submissionHarness({ api: async () => ({ lastUserSeq: 44 }) })
  h.state.workspace.threads[0].turns = [turn(1654, 'old question')]
  h.state.draft = { kind: 'continue', parentId: 'p', text: 'next question' }
  await h.submitDraft()
  const operation = [...h.state.submissions.values()][0]
  assert.equal(operation.baseSeq, 44)
  const thread = { id: 'p', dshSessionId: 's-p', turns: [turn(44, 'old question'), turn(50, 'next question', null)] }
  assert.equal(h.turnsFor(thread).length, 2)
  assert.equal(h.turnsFor(thread)[1].cardId, operation.cardId)
})

test('a confirmed turn keeps its optimistic identity after completion', () => {
  const { state, turnsFor, reconcilePendingReplies } = pendingHarness()
  const operation = { id: 'op', cardId: 'stable', text: 'q', at: 10, baseSeq: 1, baseCount: 1, phase: 'queued' }
  state.pendingReplies.set('s', operation)
  const thread = { id: 't', dshSessionId: 's', turns: [turn(1, 'old'), { ...turn(5, 'q'), status: 'done', endSeq: 8 }] }
  reconcilePendingReplies([thread])
  assert.equal(state.pendingReplies.has('s'), false)
  assert.equal(turnsFor(thread)[1].cardId, 'stable')
})

test('an old completed turn cannot settle the next submission before it is projected', () => {
  const settled = new Function(`${section(app, 'function projectedReplyHasSettled', 'async function refreshSummaries')}; return projectedReplyHasSettled`)()
  assert.equal(settled({ turns: [{ ...turn(1, 'same'), status: 'done' }] }, { baseSeq: 1, baseCount: 1 }), false)
})

test('a legacy projection settles only after the live completion and final answer agree', () => {
  const { state, turnsFor, reconcilePendingReplies } = pendingHarness()
  const pending = { id: 'op', cardId: 'stable', text: 'q', at: 10, baseSeq: -1, baseCount: 0, completed: true, finalText: 'final' }
  state.pendingReplies.set('s', pending)
  const thread = { id: 't', dshSessionId: 's', turns: [turn(1, 'q', 'intermediate')] }
  reconcilePendingReplies([thread])
  assert.equal(state.pendingReplies.has('s'), true)
  thread.turns[0].answer = 'final'
  reconcilePendingReplies([thread])
  assert.equal(state.pendingReplies.has('s'), false)
  assert.equal(turnsFor(thread)[0].cardId, 'stable')
})

test('summary polling does not discard a new conversation before its host session exists', async () => {
  const state = { summaries: [], selectedDshWorkspaceId: null, workspace: { id: 'pending-workspace:new', threads: [] } }
  const h = evaluate(section(app, 'async function refreshSummaries', 'async function openWorkspace'), {
    state, summariesFingerprint: summaries => JSON.stringify(summaries),
    graphCache: new Map(), selectedDshWorkspace: () => undefined,
    api: async () => ({ workspaces: [] }), canReplaceView: () => true, render() {},
  })
  await h.refreshSummaries()
  assert.equal(state.workspace.id, 'pending-workspace:new')
})

test('bridge retries share the same in-flight and accepted operation', async () => {
  const make = new Function(`${section(client, 'function createOperationRunner', "const TAB_LABEL =")}; return createOperationRunner`)()
  const run = make()
  let calls = 0
  const action = async () => { calls++; return 'session-id' }
  const first = run('fork', 'op', action)
  assert.equal(run('fork', 'op', action), first)
  await first
  assert.equal(await run('fork', 'op', action), 'session-id')
  assert.equal(calls, 1)
})

test('unavailable conversation services cannot throw out of the preview adapter', () => {
  const helpers = new Function(`${section(client, 'const liveSessionOf =', 'const subscribeLiveTurn')}; return { chatTargetOf }`)()
  const ctx = { get() { throw new Error('service was not injected') } }
  assert.equal(helpers.chatTargetOf(ctx, 's'), undefined)
})

function detailSubscription(options) {
  const subscribe = new Function(`${section(client, 'function subscribeTurnDetail', 'function RemoteTurnPane')}; return subscribeTurnDetail`)()
  return subscribe({ sessionId: 's', seq: 1 }, options)
}

test('cold running detail polls through completion and releases its subscription', async () => {
  const timers = []
  const details = []
  let stopped = false
  let count = 0
  const stop = detailSubscription({
    read: async () => ({ complete: ++count === 2, revision: count }),
    isRunning: () => true,
    onDetail: value => details.push(value),
    onError: error => assert.fail(error),
    schedule: fn => { timers.push(fn); return timers.length },
    cancel() {},
    subscribe: () => () => { stopped = true },
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(timers.length, 1)
  timers.shift()()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(details.length, 2)
  assert.equal(timers.length, 0)
  stop()
  assert.equal(stopped, true)
})

test('closing a detail watch aborts the request and ignores its late response', async () => {
  let resolveRead
  let signal
  const values = []
  const stop = detailSubscription({
    read: (_watch, nextSignal) => { signal = nextSignal; return new Promise(resolve => { resolveRead = resolve }) },
    isRunning: () => true, onDetail: value => values.push(value), onError() {},
    schedule: () => assert.fail('a closed watch must not schedule more reads'), cancel() {},
  })
  stop()
  resolveRead({ complete: false })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(signal.aborted, true)
  assert.equal(values.length, 0)
})

test('projection waits for turn/end and replay cannot overwrite a later turn', () => {
  const store = Object.create(WorkspaceStore.prototype)
  const workspace = {}
  const thread = { turns: [], pendingProcess: [], processIds: [], dshSessionTitle: null }
  const event = (seq, type, data) => ({ seq, type, data, time: seq * 1000 })
  const events = [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'user/message', { content: [{ type: 'text', text: 'question 1' }] }),
    event(2, 'assistant/message', { turn: 1, message: { content: [{ type: 'text', text: 'intermediate' }] } }),
    event(3, 'assistant/message', { turn: 1, message: { content: [{ type: 'text', text: 'answer 1' }] } }),
    event(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    event(5, 'turn/start', { turn: 2 }),
    event(6, 'user/message', { content: [{ type: 'text', text: 'question 2' }] }),
    event(7, 'assistant/message', { turn: 2, message: { content: [{ type: 'text', text: 'answer 2' }] } }),
    event(8, 'turn/end', { turn: 2, reason: { kind: 'interrupted' } }),
  ]
  for (const item of events.slice(0, 3)) store.projectEventInto(workspace, thread, item)
  assert.equal(thread.turns[0].status, 'running')
  for (const item of events.slice(3)) store.projectEventInto(workspace, thread, item)
  assert.equal(thread.turns[0].status, 'done')
  assert.equal(thread.turns[1].status, 'cancelled')
  const expected = structuredClone(thread)
  for (const item of events) store.projectEventInto(workspace, thread, item)
  assert.deepEqual(thread, expected)
})

test('detail cache refreshes on a new answer revision and on completion', async () => {
  const thread = { id: 't', dshSessionId: 's', turns: [{ ...turn(1, 'q'), status: 'running' }] }
  const state = { workspace: { threads: [thread] }, historyBySession: new Map(), historyRequests: new Map() }
  let answer = 'intermediate'
  let reads = 0
  const h = evaluate([
    section(app, 'async function loadThreadHistory', 'function canReplaceView'),
    section(app, 'function lastAssistantText', 'function inspectorNoteBody'),
  ].join('\n'), {
    state, turnsFor: thread => thread.turns,
    api: async () => { reads++; return { detail: { steps: [{ kind: 'assistant', text: answer }], revision: thread.turns[0].answerSeq, complete: thread.turns[0].status === 'done' } } },
  })
  await h.loadThreadHistory(thread, 't:turn:1')
  answer = 'final full answer'
  Object.assign(thread.turns[0], { answerSeq: 5, answer, status: 'done', endSeq: 6 })
  await h.loadThreadHistory(thread, 't:turn:1')
  await h.loadThreadHistory(thread, 't:turn:1')
  assert.equal(reads, 2)
  assert.equal(h.inspectorReply({ id: 't:turn:1', dshThreadId: 't', answerSeq: 5, answer: { text: 'summary' } }).answerText, answer)
})
