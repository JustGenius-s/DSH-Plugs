import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { buildTurnDetail, persistenceListEntries } from '../index.js'

const userMessage = (seq, text) => ({ type: 'user/message', seq, time: seq * 1000, data: { content: [{ type: 'text', text }] } })
const assistantMessage = (seq, text, turn = 1) => ({ type: 'assistant/message', seq, time: seq * 1000, data: { turn, step: 1, message: { content: [{ type: 'text', text }] } } })
const toolCall = (seq, callId, name, args, turn = 1) => ({ type: 'tool/call', seq, time: seq * 1000, data: { turn, step: 1, callId, name, arguments: args } })
const toolResult = (seq, callId, output, turn = 1) => ({ type: 'tool/result', seq, time: seq * 1000, data: { turn, step: 1, message: { source: { kind: 'tool', callId }, content: [{ type: 'text', text: output }] } } })

test('persistence.list snapshots unwrap to headers', () => {
  const header = { id: 'fork-1', parentSession: 'parent-1', cwd: '/work' }
  assert.deepEqual(persistenceListEntries([{ header, revision: 'r1', sizeBytes: 12 }]), [{ header }])
  assert.deepEqual(persistenceListEntries([header]), [{ header }])
  assert.deepEqual(persistenceListEntries([{ header, inheritedEventCount: 8 }]), [{
    header: { ...header, inheritedEventCount: 8 },
    inheritedEventCount: 8,
  }])
  assert.deepEqual(persistenceListEntries(undefined), [])
  assert.deepEqual(persistenceListEntries([{ revision: 'r' }]), [])
})

test('rebuilds one turn with its full answer and tool records', () => {
  const events = [
    userMessage(1, '跑一下测试'),
    assistantMessage(2, '我先看看。'),
    toolCall(3, 'c1', 'bash', '{"cmd":"pnpm test"}'),
    toolResult(4, 'c1', 'x'.repeat(20_000)),
    assistantMessage(5, '测试通过了。'),
    userMessage(6, '再跑一次'),
  ]
  const detail = buildTurnDetail(events, 1)
  assert.equal(detail.question, '跑一下测试')
  // Every assistant step is kept, and the tool output is uncapped: the detail
  // view reads from DSH, so it is not subject to the card display caps.
  assert.deepEqual(detail.steps.map(step => step.text), ['我先看看。', '测试通过了。'])
  assert.equal(detail.process.length, 1)
  assert.equal(detail.process[0].name, 'bash')
  assert.equal(detail.process[0].arguments, '{"cmd":"pnpm test"}')
  assert.equal(detail.process[0].result.length, 20_000)
  assert.deepEqual(detail.flow.map(item => item.kind), ['assistant', 'tool', 'assistant'])
  assert.equal(detail.flow[1].name, 'bash')
})

test('a turn stops at the next question', () => {
  const events = [
    userMessage(1, '第一问'),
    assistantMessage(2, '第一答'),
    userMessage(3, '第二问'),
    assistantMessage(4, '第二答'),
  ]
  const detail = buildTurnDetail(events, 1)
  assert.equal(detail.question, '第一问')
  assert.deepEqual(detail.steps.map(step => step.text), ['第一答'])
  assert.equal(detail.process.length, 0)
})

test('keeps a failed turn error as a step', () => {
  const events = [
    userMessage(1, '搜索竞品'),
    toolCall(2, 's1', 'web_search', '{"query":"竞品"}', 7),
    { type: 'tool/result', seq: 3, time: 3000, data: { turn: 7, step: 1, error: { name: 'QuotaExceeded', message: '余额不足' }, message: { source: { kind: 'tool', callId: 's1' }, content: [] } } },
    { type: 'turn/end', seq: 4, time: 4000, data: { turn: 7, step: 1, reason: { kind: 'error', error: { name: 'QuotaExceeded', message: '余额不足' } } } },
  ]
  const detail = buildTurnDetail(events, 1)
  assert.equal(detail.question, '搜索竞品')
  assert.equal(detail.steps.length, 1)
  assert.equal(detail.steps[0].kind, 'error')
  assert.equal(detail.steps[0].text, 'QuotaExceeded: 余额不足')
  assert.equal(detail.process[0].error, 'QuotaExceeded: 余额不足')
})

test('the last turn runs to the end of the log', () => {
  const events = [
    userMessage(1, '第一问'),
    assistantMessage(2, '第一答'),
    userMessage(3, '第二问'),
    assistantMessage(4, '第二答'),
    assistantMessage(5, '补充'),
  ]
  const detail = buildTurnDetail(events, 3)
  assert.equal(detail.question, '第二问')
  assert.deepEqual(detail.steps.map(step => step.text), ['第二答', '补充'])
})

test('uses the card turn index when its durable source sequence is missing', () => {
  const events = [
    userMessage(1, '第一问'),
    assistantMessage(2, '第一答'),
    userMessage(3, '第二问'),
    assistantMessage(4, '第二答'),
  ]
  const detail = buildTurnDetail(events, null, 1)
  assert.equal(detail.question, '第二问')
  assert.deepEqual(detail.steps.map(step => step.text), ['第二答'])
})

test('survives a missing or unreadable log', () => {
  assert.deepEqual(buildTurnDetail(undefined, 1), { question: null, steps: [], process: [], flow: [] })
  assert.deepEqual(buildTurnDetail([], 1), { question: null, steps: [], process: [], flow: [] })
  // No user event at all: nothing to show rather than throwing.
  assert.deepEqual(buildTurnDetail([assistantMessage(1, 'hi')], 1), { question: null, steps: [], process: [], flow: [] })
})

test('pairs a tool result that arrives before its call', () => {
  // Out-of-order delivery must not duplicate the invocation.
  const events = [
    userMessage(1, 'q'),
    assistantMessage(2, 'a'),
    toolResult(3, 'c1', 'done'),
    toolCall(4, 'c1', 'bash', '{}'),
  ]
  const detail = buildTurnDetail(events, 1)
  assert.equal(detail.process.length, 1)
  assert.equal(detail.process[0].result, 'done')
  assert.equal(detail.process[0].name, 'bash')
})

test('an injected runtime-context block does not split one turn into several', () => {
  // DSH emits runtime-context snapshots and <system-reminder> blocks as
  // user-role messages. They are not real turns: the card projection skips
  // them, so the detail view must slice on the same rule.
  const events = [
    userMessage(1, '真实问题'),
    userMessage(2, 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\nPolicy.'),
    userMessage(3, '<system-reminder>\nA skill is a reusable set of task-specific instructions.\n</system-reminder>'),
    assistantMessage(4, '真实回答'),
    toolCall(5, 'c1', 'bash', '{}'),
    toolResult(6, 'c1', 'done'),
  ]
  const detail = buildTurnDetail(events, 1)
  assert.equal(detail.question, '真实问题')
  assert.deepEqual(detail.steps.map(step => step.text), ['真实回答'])
  assert.equal(detail.process.length, 1)
  // Asking for an injected block's seq still resolves to the real turn it
  // belongs to, rather than starting a bogus empty turn at that block.
  for (const injectedSeq of [2, 3]) {
    const viaInjected = buildTurnDetail(events, injectedSeq)
    assert.equal(viaInjected.question, '真实问题')
    assert.deepEqual(viaInjected.steps.map(step => step.text), ['真实回答'])
  }
})

test('a later real turn stops at its own next question', () => {
  const events = [
    userMessage(1, '第一问'),
    assistantMessage(2, '第一答'),
    userMessage(3, '<system-reminder>ignored</system-reminder>'),
    userMessage(4, '第二问'),
    assistantMessage(5, '第二答'),
  ]
  assert.deepEqual(buildTurnDetail(events, 1).steps.map(step => step.text), ['第一答'])
  const second = buildTurnDetail(events, 4)
  assert.equal(second.question, '第二问')
  assert.deepEqual(second.steps.map(step => step.text), ['第二答'])
})

// `readSessionEvents` is not exported, so it is extracted the same way the
// canvas tests extract app.js helpers.
async function loadReadSessionEvents() {
  const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
  const helperStart = source.indexOf('function sessionEventLog')
  const end = source.indexOf('/**', source.indexOf('async function readSessionEvents'))
  const module = await import(`data:text/javascript,${encodeURIComponent(`${source.slice(helperStart, end)}\nexport { readSessionEvents }`)}`)
  return module.readSessionEvents
}

test('reads events from a live session without I/O', async () => {
  const readSessionEvents = await loadReadSessionEvents()
  const events = [{ seq: 1, type: 'user/message', time: 1, data: { content: [{ type: 'text', text: 'q' }] } }]
  const ctx = { sessions: { get: () => ({ events }) } }
  assert.equal(await readSessionEvents(ctx, 'session-1'), events)
  const viaSnapshot = { sessions: { get: () => ({ snapshotEvents: () => events }) } }
  assert.deepEqual(await readSessionEvents(viaSnapshot, 'session-1'), events)
})

test('falls back to persistence for a cold session', async () => {
  const readSessionEvents = await loadReadSessionEvents()
  const events = [{ seq: 1, type: 'user/message', time: 1, data: { content: [{ type: 'text', text: 'q' }] } }]
  let inspected = null
  const ctx = {
    sessions: { get: () => undefined },
    sessionPersistence: { inspect: async id => { inspected = id; return { meta: {}, events } } },
  }
  assert.equal(await readSessionEvents(ctx, 'session-cold'), events)
  assert.equal(inspected, 'session-cold')
})

test('reads a cold session through persistence.open when inspect is gone', async () => {
  const readSessionEvents = await loadReadSessionEvents()
  const events = [{ seq: 1, type: 'user/message', time: 1, data: { content: [{ type: 'text', text: 'fork q' }] } }]
  const closed = []
  const ctx = {
    sessions: { get: () => undefined, list: () => [] },
    get: name => name === 'sessionPersistence' ? {
      open: async (id, access) => {
        assert.equal(id, 'session-fork')
        assert.equal(access, 'read')
        return {
          read: async () => ({ events }),
          close: async () => { closed.push(id) },
        }
      },
    } : undefined,
  }
  assert.deepEqual(await readSessionEvents(ctx, 'session-fork'), events)
  assert.deepEqual(closed, ['session-fork'])
})

test('a rejecting session lookup degrades to no detail instead of failing the request', async () => {
  const readSessionEvents = await loadReadSessionEvents()
  // A branded-id store rejects a raw string; that must not surface as a 500.
  const throwing = {
    sessions: { get: id => { throw new TypeError(`invalid SessionId: ${id}`) } },
    sessionPersistence: { inspect: async () => ({ events: [] }) },
  }
  assert.deepEqual(await readSessionEvents(throwing, 'session-raw'), [])
  // And when persistence is unavailable or throws, there is simply no detail.
  assert.equal(await readSessionEvents({ sessions: { get: () => undefined } }, 'session-x'), null)
  assert.equal(await readSessionEvents({ sessions: { get: () => undefined }, sessionPersistence: { inspect: async () => { throw new Error('gone') } } }, 'session-x'), null)
  assert.equal(await readSessionEvents({ sessions: { get: () => undefined } }, ''), null)
})

test('the client falls back to the card summary when the detail read fails', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const load = source.slice(source.indexOf('async function loadThreadHistory'), source.indexOf('function turnForCardId'))
  // A failed/404 detail read must cache a null result, not throw: the canvas
  // keeps rendering the stored summary and never shows a broken pane.
  assert.match(load, /catch \(error\)/)
  assert.match(load, /if \(!state\.historyBySession\.has\(key\)\) state\.historyBySession\.set\(key, null\)/)
  assert.match(load, /turnIndex: Number\.isInteger\(target\.turn\.turnIndex\) \? target\.turn\.turnIndex : null/)
  // The inspector and the thread view both read the nullable detail and fall
  // back to the card fields when it is null.
  const inspector = source.slice(source.indexOf('function lastAssistantText'), source.indexOf('function renderThread'))
  assert.match(inspector, /detail\?\.steps \?\? \[\]/)
  assert.match(inspector, /card\.answer\?\.text/)
  assert.match(inspector, /const pending = card\.answer\?\.pending === true/)
  assert.doesNotMatch(inspector, /live\?\.running === true/)
  assert.match(inspector, /texts\[texts\.length - 1\]/)
  assert.match(inspector, /正在回复/)
  assert.doesNotMatch(inspector, /正在读取完整内容/)
  assert.doesNotMatch(inspector, /等待助手回复/)
  const thread = source.slice(source.indexOf('function renderThread'), source.indexOf('function render()'))
  assert.match(thread, /card\.turn\.answer/)
})

test('reading events never trips the cordis inject guard', async () => {
  const { inject } = await import('../index.js')
  for (const service of ['webServer', 'sessions', 'sessionPersistence']) assert.ok(inject.includes(service))
  const readSessionEvents = await loadReadSessionEvents()
  // Even with the inject declaration, a host proxy can still throw if the
  // service is missing. The lookup must stay guarded so turn-detail is a 404,
  // not a 500.
  const throwingProxy = new Proxy({ sessions: { get: () => undefined } }, {
    get(target, prop) {
      if (prop === 'sessionPersistence') throw new Error('cannot get property "sessionPersistence" without inject')
      if (prop === 'get') return () => undefined
      return target[prop]
    },
  })
  assert.equal(await readSessionEvents(throwingProxy, 'session-x'), null)

  // ctx.get present and returning a working service still resolves.
  const events = [{ seq: 1, type: 'user/message', time: 1, data: { content: [{ type: 'text', text: 'q' }] } }]
  const withGet = {
    sessions: { get: () => undefined },
    get: name => (name === 'sessionPersistence' ? { inspect: async () => ({ events }) } : undefined),
  }
  assert.equal(await readSessionEvents(withGet, 'session-cold'), events)

  // ctx.get throwing (service unknown to the runtime) must also degrade.
  const getThrows = {
    sessions: { get: () => undefined },
    get() { throw new Error('unknown service') },
  }
  assert.equal(await readSessionEvents(getThrows, 'session-x'), null)
})

test('inspector keeps settled card text while a later turn is live', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const start = source.indexOf('function lastAssistantText')
  const end = source.indexOf('function inspectorNoteBody')
  const context = {
    state: {
      workspace: { threads: [{ id: 't1', dshSessionId: 's1' }] },
      liveReplies: new Map([['s1', { running: true, text: 'streaming', question: '现在几点' }]]),
      historyBySession: new Map(),
    },
    historyForCard: () => null,
    isSessionLabelQuestion: () => false,
  }
  vm.createContext(context)
  vm.runInContext(source.slice(start, end), context)
  const settled = context.inspectorReply({
    id: 't1:turn:1',
    dshThreadId: 't1',
    question: '你好',
    answer: { kind: 'assistant', text: '你好！', pending: false },
    error: null,
    sourceSeq: 1,
  })
  assert.equal(settled.pending, false)
  assert.equal(settled.answerText, '你好！')
  const live = context.inspectorReply({
    id: 't1:turn:9',
    dshThreadId: 't1',
    question: '现在几点',
    answer: { kind: 'assistant', text: '', pending: true },
    error: null,
  })
  assert.equal(live.pending, true)
  assert.equal(live.answerText, '')
})

test('inspector uses only the last assistant markdown from a multi-step turn', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const start = source.indexOf('function lastAssistantText')
  const end = source.indexOf('function inspectorNoteBody')
  const context = {
    state: {
      workspace: { threads: [{ id: 't1', dshSessionId: 's1' }] },
      liveReplies: new Map(),
      historyBySession: new Map(),
    },
    historyForCard: () => ({
      steps: [
        { kind: 'assistant', text: '我先看看。' },
        { kind: 'assistant', text: '测试通过了。' },
      ],
      process: [],
    }),
    isSessionLabelQuestion: () => false,
  }
  vm.createContext(context)
  vm.runInContext(source.slice(start, end), context)
  assert.equal(context.lastAssistantText(context.historyForCard().steps, '摘要'), '测试通过了。')
  assert.equal(context.lastAssistantText([], '卡片摘要'), '卡片摘要')
  const reply = context.inspectorReply({
    id: 't1:turn:1',
    dshThreadId: 't1',
    question: '跑一下测试',
    answer: { kind: 'assistant', text: '卡片摘要', pending: false },
    error: null,
    sourceSeq: 1,
  })
  assert.equal(reply.pending, false)
  assert.equal(reply.answerText, '测试通过了。')
})
