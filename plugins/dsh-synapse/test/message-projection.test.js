import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadMessagesFromEvents() {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const start = source.indexOf('function messagesFromEvents')
  const end = source.indexOf('async function loadThreadHistory')
  const context = { globalThis: {} }
  vm.createContext(context)
  vm.runInContext(`${source.slice(start, end)};globalThis.messagesFromEvents = messagesFromEvents`, context)
  return context.globalThis.messagesFromEvents
}

test('does not turn DSH runtime context into a question card', async () => {
  const messagesFromEvents = await loadMessagesFromEvents()
  const messages = messagesFromEvents([
    { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\nPolicy details.' }] } },
    { type: 'user/message', seq: 2, time: 2, data: { content: [{ type: 'text', text: '你是谁' }] } },
  ])

  assert.deepEqual(messages.map(message => message.text), ['你是谁'])
})

test('does not turn injected <system-reminder> blocks into a question card', async () => {
  const messagesFromEvents = await loadMessagesFromEvents()
  // One turn emits the real question and then a system-reminder block; only
  // the real question may become a card (one turn = one card).
  const messages = messagesFromEvents([
    { type: 'user/message', seq: 7, time: 1, data: { content: [{ type: 'text', text: '你好' }] } },
    { type: 'user/message', seq: 9, time: 2, data: { content: [{ type: 'text', text: '<system-reminder>\nA skill is a reusable set of task-specific instructions.\n</system-reminder>' }] } },
    { type: 'assistant/message', seq: 38, time: 3, data: { message: { content: [{ type: 'text', text: '你好！有什么可以帮你的？' }] } } },
  ])

  assert.deepEqual(
    messages.map(message => `${message.kind}:${message.text}`),
    ['user:你好', 'assistant:你好！有什么可以帮你的？'],
  )
})

test('server projection skips injected system blocks too', async () => {
  const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
  // The Host-side projection shares the same rule; keep both in step.
  assert.ok(source.indexOf('system-reminder|system|context|environment|reminder') !== -1)
  assert.ok(source.indexOf('Current runtime context. This snapshot supersedes') !== -1)
})
