import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildTurnDetail, shouldRebaseProjection, WorkspaceStore } from '../index.js'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
function section(start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from, start)
  return source.slice(from, to)
}
const event = (seq, type, data) => ({ seq, type, data, time: seq * 1000 })
const question = (seq, text) => event(seq, 'user/message', { id: `user-${seq}`, content: [{ type: 'text', text }] })
const args = '{"command":"printf hello","description":"Check greeting"}'
const tool = { type: 'tool-call', callId: 'call-1', name: 'bash', arguments: args }

test('assistant text and tool arguments remain separate in the detail flow', () => {
  const detail = buildTurnDetail([
    question(1, 'q'),
    event(2, 'assistant/message', { message: { content: [{ type: 'text', text: 'Let me check.' }, tool] } }),
    event(3, 'tool/call', { callId: tool.callId, name: tool.name, arguments: args }),
    event(4, 'tool/result', { message: { source: { callId: tool.callId }, content: [{ type: 'text', text: 'hello' }] } }),
    event(5, 'assistant/message', { message: { content: [{ type: 'text', text: 'Done.' }] } }),
  ], 1)
  assert.deepEqual(detail.steps.map(step => step.text), ['Let me check.', 'Done.'])
  assert.deepEqual(detail.flow.map(item => item.kind), ['assistant', 'tool', 'assistant'])
  assert.equal(detail.process[0].arguments, args)
  assert.equal(detail.process[0].result, 'hello')
})

test('tool-only assistant messages do not create a raw JSON prose bubble', () => {
  const detail = buildTurnDetail([
    question(1, 'q'),
    event(2, 'assistant/message', { message: { content: [tool] } }),
    event(3, 'tool/call', { callId: tool.callId, name: tool.name, arguments: args }),
  ], 1)
  assert.equal(detail.steps.length, 0)
  assert.equal(detail.process.length, 1)
})

test('legitimate prose code examples are not filtered as tool metadata', () => {
  const text = `Example:\n\`\`\`json\n${args}\n\`\`\``
  const detail = buildTurnDetail([
    question(1, 'q'),
    event(2, 'assistant/message', { message: { content: [{ type: 'text', text }] } }),
  ], 1)
  assert.equal(detail.steps[0].text, text)
})

function displayHelpers() {
  return new Function(`${section('const parseArgs =', 'const isSettledTool =')}; return { detailToChatNodes }`)()
}

test('legacy flattened tool text is removed only when the matching structured call exists', () => {
  const { detailToChatNodes } = displayHelpers()
  const process = { kind: 'tool', name: 'bash', callId: 'call-1', arguments: args, result: 'hello' }
  const nodes = detailToChatNodes({
    question: 'q',
    flow: [{ kind: 'assistant', seq: 2, text: `Let me check.\nbash\n${args}` }, process],
    process: [process],
  })
  assert.equal(nodes[1].data.blocks[0].text, 'Let me check.')
  assert.deepEqual(nodes.map(node => node.kind), ['user', 'assistant-step', 'tool-call'])
  const unmatched = detailToChatNodes({ steps: [{ kind: 'assistant', text: `bash\n${args}` }] })
  assert.equal(unmatched[0].data.blocks[0].text, `bash\n${args}`)
})

test('legacy tool-only prose is folded into one tool row and does not remove fenced examples', () => {
  const { detailToChatNodes } = displayHelpers()
  const process = { kind: 'tool', name: 'bash', callId: 'call-1', arguments: args, result: 'hello' }
  const nodes = detailToChatNodes({ flow: [{ kind: 'assistant', text: `bash\n${args}` }, process], process: [process] })
  assert.deepEqual(nodes.map(node => node.kind), ['tool-call'])
  const example = `\`\`\`text\nbash\n${args}`
  const code = detailToChatNodes({ flow: [{ kind: 'assistant', text: example }, process], process: [process] })
  assert.equal(code[0].data.blocks[0].text, example)
})

const readTurnDetail = new Function(`${section('async function readTurnDetail', 'function subscribeTurnDetail')}; return readTurnDetail`)()

test('a stale root sequence recovers only after verifying the selected question', async () => {
  const calls = []
  const request = async (_path, init) => {
    const target = JSON.parse(init.body)
    calls.push(target)
    return { ok: true, json: async () => ({ detail: target.seq === null
      ? { seq: 44, question: 'read the playbook', steps: [{ kind: 'assistant', text: 'answer' }] }
      : { question: null, steps: [], process: [] } }) }
  }
  const detail = await readTurnDetail({
    sessionId: 's', seq: 1654, turnIndex: 1,
    reference: { question: 'read the playbook', root: true, unique: true },
  }, request)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].turnIndex, 1)
  assert.equal(detail.seq, 44)
  assert.equal(detail.question, 'read the playbook')
})

test('a mismatching recovery cannot display another question as the selected turn', async () => {
  const detail = await readTurnDetail({
    sessionId: 's', seq: 1654, turnIndex: 1,
    reference: { question: 'selected question', root: true, unique: true },
  }, async () => ({ ok: true, json: async () => ({ detail: { seq: 44, question: 'different question', steps: [{ text: 'wrong' }] } }) }))
  assert.equal(detail.question, null)
})

test('forks and repeated questions cannot recover through a global turn index', async () => {
  for (const reference of [
    { question: 'same', root: false, unique: true },
    { question: 'same', root: true, unique: false },
  ]) {
    let calls = 0
    const detail = await readTurnDetail({ sessionId: 's', seq: 1654, turnIndex: 1, reference },
      async () => { calls++; return { ok: true, json: async () => ({ detail: { question: null, steps: [] } }) } })
    assert.equal(calls, 1)
    assert.equal(detail.question, null)
  }
})

test('canonical message identity wins over a legacy sequence and an edited question', () => {
  const events = [question(9, 'first'), question(44, 'updated question')]
  const detail = buildTurnDetail(events, 1654, 1, { messageId: 'user-44', question: 'old question', root: true, unique: true })
  assert.equal(detail.seq, 44)
  assert.equal(detail.question, 'updated question')
  assert.equal(detail.messageId, 'user-44')
  const unknownId = buildTurnDetail(events, 44, 1, { messageId: 'missing-id', question: 'updated question', root: true, unique: true })
  assert.equal(unknownId.question, null)
})

test('the server can recover a unique root question but never an ambiguous one', () => {
  const events = [question(9, 'first'), question(44, 'selected')]
  const detail = buildTurnDetail(events, 1654, 0, { question: 'selected', root: true, unique: true })
  assert.equal(detail.seq, 44)
  assert.equal(buildTurnDetail([...events, question(70, 'selected')], 1654, 0, { question: 'selected', root: true, unique: true }).question, null)
})

test('a completed card keeps its readable summary when full history is unavailable', () => {
  const presentation = new Function(`${section('function turnDetailPresentation', 'function RemoteTurnPane')};return turnDetailPresentation`)()
  const preview = { question: 'selected', answer: 'stored answer', completed: true }
  const result = presentation({ question: null, steps: [] }, preview, false)
  assert.equal(result.hasDetail, false)
  assert.equal(result.hasPreview, true)
  assert.equal(result.missing, true)
  assert.equal(result.displayDetail.question, 'selected')
  assert.equal(result.displayDetail.steps[0].text, 'stored answer')
})

test('full-log sequence migration preserves card identity, custom title and branch anchors', () => {
  const store = Object.create(WorkspaceStore.prototype)
  const root = {
    id: 'root', dshSessionId: 's', dshSessionTitle: 'Root',
    turns: [
      { seq: 8, question: 'first', answerSeq: 1639, answer: 'a' },
      { seq: 1654, question: 'read playbook', title: 'custom title', answerSeq: 3408, answer: 'b' },
      { seq: 70, question: 'expand', answerSeq: 83, answer: 'c' },
    ],
    lastEventSeq: 3408, processIds: [], pendingProcess: [],
  }
  const branch = { id: 'branch', parentId: 'root', sourceAnchorSeq: 3408 }
  const workspace = { threads: [root, branch] }
  const events = [
    event(0, 'permission/preset', {}),
    event(8, 'turn/start', { turn: 1 }), question(9, 'first'),
    event(29, 'assistant/message', { message: { content: [{ type: 'text', text: 'a' }] } }),
    event(30, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    event(43, 'turn/start', { turn: 2 }), question(44, 'read playbook'),
    event(61, 'assistant/message', { message: { content: [{ type: 'text', text: 'b' }] } }),
    event(62, 'turn/end', { turn: 2, reason: { kind: 'completed' } }),
    event(69, 'turn/start', { turn: 3 }), question(70, 'expand'),
    event(83, 'assistant/message', { message: { content: [{ type: 'text', text: 'c' }] } }),
    event(84, 'turn/end', { turn: 3, reason: { kind: 'completed' } }),
  ]
  assert.equal(shouldRebaseProjection(root, events), true)
  assert.equal(store.rebaseProjection(workspace, root, events, 0), true)
  assert.deepEqual(root.turns.map(turn => turn.seq), [9, 44, 70])
  assert.equal(root.turns[1].title, 'custom title')
  assert.equal(root.turns[1].cardId, 'root:turn:1654')
  assert.equal(root.turns[1].messageId, 'user-44')
  assert.equal(branch.sourceAnchorSeq, 61)
  assert.equal(root.lastEventSeq, 84)
  store.projectEventInto(workspace, root, question(90, 'next question'))
  assert.equal(root.turns.at(-1).question, 'next question')
})

test('a partial log or changed question prefix cannot trigger destructive rebasing', () => {
  const root = { turns: [{ seq: 1654, question: 'selected' }] }
  assert.equal(shouldRebaseProjection(root, [question(44, 'selected')]), false)
  assert.equal(shouldRebaseProjection(root, [event(0, 'permission/preset', {}), question(44, 'different')]), false)
  assert.equal(shouldRebaseProjection(root, [event(0, 'permission/preset', {})]), false)
})

test('long terminal output supplies every label callback required by the host primitive', () => {
  const props = new Function(`${section('const TERMINAL_LABELS', 'function ToolResultBody')};return terminalBodyProps`)()
  const output = Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n')
  const view = props('printf hello', output)
  assert.equal(view.maxLines, 16)
  assert.equal(view.output, output)
  assert.equal(view.labels.expandAria(24), '展开其余 24 行输出')
  assert.equal(view.labels.expand(24), '展开 24 行')
  assert.equal(view.labels.signal('SIGTERM'), '信号 SIGTERM')
  assert.equal(view.labels.exitCode(1), '退出码 1')
  assert.equal(props('sleep 1', '', true).running, true)
  for (const key of ['copy', 'copied', 'running', 'done', 'failed', 'noOutput', 'collapse', 'collapseAria']) {
    assert.equal(typeof view.labels[key], 'string', key)
  }
})

test('structured detail preserves literal tool examples even if an identical call was executed', () => {
  const { detailToChatNodes } = displayHelpers()
  const text = `bash\n${args}`
  const process = { kind: 'tool', name: 'bash', callId: 'call-1', arguments: args, result: 'hello' }
  const nodes = detailToChatNodes({ format: 'structured-v1', flow: [{ kind: 'assistant', text }, process], process: [process] })
  assert.equal(nodes[0].data.blocks[0].text, text)
})
