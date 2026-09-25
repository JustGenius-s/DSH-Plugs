import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportSessionMarkdown, sessionExportFilename } from '../src/session-export.ts'

const header = { id: 'session-1', createdAt: 1000, cwd: '/project' }
const text = (value) => ({ type: 'text', text: value })
const event = (type, data, extra = {}) => ({ type, data, time: 2000, ...extra })
const user = (value, source = { kind: 'user' }) => event('user/message', { source, content: [text(value)] })
const assistant = (content, step = 0, extra = {}) => event('assistant/message', {
  turn: 0, step, message: { content }, ...extra,
})
const render = (events, customHeader = header) => exportSessionMarkdown({ header: customHeader, events }, 3000)
const occurrences = (value, fragment) => value.split(fragment).length - 1

test('exports every human turn and full authored Markdown, including a fork seed', () => {
  const longAnswer = `# 原始标题\n\n\`\`\`ts\nconst name = '中文 🌱'\n\`\`\`\n\n${'完整正文\n'.repeat(2000)}`
  const { filename, markdown } = render([
    event('session/title', { title: '旧标题' }),
    user('最早的问题'),
    assistant([text('最早的答案')]),
    event('session/end-seed', {}),
    user('第二个问题'),
    assistant([text(longAnswer)], 1),
    event('session/title', { title: '新标题' }),
  ], { ...header, parentSession: 'parent-1' })
  assert.equal(filename, '新标题.md')
  assert.ok(markdown.startsWith('# 新标题\n'))
  assert.ok(markdown.includes('parent-1'))
  assert.ok(markdown.includes('1970-01-01T00:00:01.000Z'))
  assert.ok(markdown.includes(longAnswer))
  assert.ok(markdown.indexOf('最早的问题') < markdown.indexOf('最早的答案'))
  assert.ok(markdown.indexOf('最早的答案') < markdown.indexOf('第二个问题'))
})

test('retains pre-compaction history and original tool output without model replacement copies', () => {
  const replacement = { surfaceOp: { op: 'replace', start: 1, end: 3 } }
  const { markdown } = render([
    user('原始问题'),
    assistant([text('原始回答')]),
    event('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'read', arguments: '{"path":"/file"}' }),
    event('tool/result', { turn: 0, step: 0, message: { source: { kind: 'tool', callId: 'c1' }, content: [text('原始输出')] } }),
    event('user/message', { source: { kind: 'user' }, content: [text('重复压缩摘要')] }, replacement),
    event('tool/result', { turn: 0, step: 0, message: { source: { callId: 'c1' }, content: [text('被裁剪的结果')] } }, replacement),
    user('压缩后的新问题'),
    assistant([text('后续回答')], 1),
  ])
  for (const kept of ['原始问题', '原始回答', '原始输出', '压缩后的新问题', '后续回答']) assert.ok(markdown.includes(kept))
  assert.ok(!markdown.includes('重复压缩摘要'))
  assert.ok(!markdown.includes('被裁剪的结果'))
})

test('filters injected context and reasoning by provenance without dropping user-authored lookalikes', () => {
  const { markdown } = render([
    event('request/header', { system: 'SECRET_SYSTEM_PROMPT' }),
    user('PLUGIN_CONTEXT', { kind: 'plugin', plugin: 'runtime' }),
    user('<system-reminder>这是用户自己贴的文字</system-reminder>'),
    assistant([{ type: 'reasoning', text: 'REASONING_BODY' }, text('可见回复')]),
  ])
  assert.ok(!markdown.includes('SECRET_SYSTEM_PROMPT'))
  assert.ok(!markdown.includes('PLUGIN_CONTEXT'))
  assert.ok(!markdown.includes('REASONING_BODY'))
  assert.ok(markdown.includes('<system-reminder>这是用户自己贴的文字</system-reminder>'))
  assert.ok(markdown.includes('可见回复'))
})

test('pairs assistant requests, execution records and nested results once and preserves failures', () => {
  const call = { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{"command":"pnpm test"}' }
  const { markdown } = render([
    user('运行测试'),
    assistant([text('我来验证。'), call]),
    event('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: call.arguments }),
    event('tool/result', {
      turn: 0, step: 0,
      message: {
        source: { kind: 'tool', callId: 'c1' },
        content: [{ type: 'tool-result', toolCallId: 'c1', isError: true, content: [text('Assertion failed: expected 2, got 1')] }],
      },
    }),
    assistant([text('测试失败，需要修复。')], 1),
  ])
  assert.equal(occurrences(markdown, 'pnpm test'), 1)
  assert.equal(occurrences(markdown, 'Assertion failed: expected 2, got 1'), 1)
  assert.ok(markdown.includes('1 次失败'))
  assert.ok(markdown.indexOf('我来验证。') < markdown.indexOf('pnpm test'))
  assert.ok(markdown.indexOf('pnpm test') < markdown.indexOf('测试失败，需要修复。'))
  assert.ok(!markdown.includes('"toolCallId"'))
})

test('reused call ids in different steps stay separate, missing and orphan results remain visible', () => {
  const { markdown } = render([
    ...[0, 1].flatMap((step) => [
      event('tool/call', { turn: 0, step, callId: 'same', name: 'read', arguments: `{"path":"/file-${step}"}` }),
      event('tool/result', { turn: 0, step, message: { source: { callId: 'same' }, content: [text(`结果-${step}`)] } }),
    ]),
    assistant([{ type: 'tool-call', id: 'never-started', name: 'write', arguments: '{"path":"/pending"}' }], 2),
    event('tool/call', { turn: 0, step: 3, callId: 'no-result', name: 'bash', arguments: '{"command":"waiting"}' }),
    event('tool/result', { turn: 0, step: 4, message: { source: { callId: 'orphan' }, content: [text('孤立结果')] } }),
  ])
  for (const kept of ['结果-0', '结果-1', '未记录执行', '未记录结果', '孤立结果']) assert.ok(markdown.includes(kept))
  assert.ok(markdown.includes('5 次'))
})

test('settled stream chunks do not duplicate text and an unfinished streamed prefix is retained', () => {
  const chunk = (step, value) => event('assistant/chunk', { turn: 0, step, chunk: value })
  const { markdown } = render([
    event('turn/start', { turn: 0 }),
    chunk(0, { type: 'text-delta', index: 0, text: '已完成的回答' }),
    assistant([text('已完成的回答')]),
    chunk(1, { type: 'block-start', index: 0, blockType: 'reasoning' }),
    chunk(1, { type: 'reasoning-delta', index: 0, text: 'UNFINISHED_REASONING' }),
    chunk(1, { type: 'text-delta', index: 1, text: '这是' }),
    chunk(1, { type: 'text-delta', index: 1, text: '半条回复' }),
    chunk(1, { type: 'block-end', index: 1, block: text('这是半条回复') }),
  ])
  assert.equal(occurrences(markdown, '已完成的回答'), 1)
  assert.equal(occurrences(markdown, '这是半条回复'), 1)
  assert.ok(markdown.includes('仍在进行中'))
  assert.ok(markdown.includes('（未完成）'))
  assert.ok(!markdown.includes('UNFINISHED_REASONING'))
})

test('unfinished streams keep provider arrival order and ignore duplicate starts and closed-block stragglers', () => {
  const chunk = (value) => event('assistant/chunk', { turn: 0, step: 0, chunk: value })
  const { markdown } = render([
    chunk({ type: 'text-delta', index: 5, text: 'FIRST' }),
    chunk({ type: 'block-start', index: 5, blockType: 'text' }),
    chunk({ type: 'text-delta', index: 2, text: 'SECOND' }),
    chunk({ type: 'block-end', index: 5, block: text('FIRST') }),
    chunk({ type: 'text-delta', index: 5, text: 'STRAGGLER' }),
    chunk({ type: 'block-end', index: 5, block: text('WRONG_RECLOSE') }),
  ])
  assert.ok(markdown.includes('FIRSTSECOND'))
  assert.ok(!markdown.includes('STRAGGLER'))
  assert.ok(!markdown.includes('WRONG_RECLOSE'))
})

test('an interrupted code block is closed before the following status and conversation', () => {
  for (const fence of ['```', '~~~~']) {
    const unfinished = `${fence}ts\nconst unfinished = `
    const { markdown } = render([
      assistant([text(unfinished)], 0, { interrupted: true }),
      event('turn/end', { reason: { kind: 'aborted' } }),
      user('继续完成代码'),
      assistant([text('后续回复')], 1),
    ])
    assert.ok(markdown.includes(`${unfinished}\n${fence}\n\n> 导出时补齐了未闭合的代码围栏。`))
    assert.ok(markdown.indexOf('导出时补齐') < markdown.indexOf('本轮已中断'))
    assert.ok(markdown.indexOf('本轮已中断') < markdown.indexOf('## 用户'))
  }
  const complete = '````md\n```ts\nconst x = 1\n```\n````'
  assert.ok(!render([assistant([text(complete)])]).markdown.includes('导出时补齐'))
})

test('exports interrupted answers, command outcomes and failed turns', () => {
  const { markdown } = render([
    event('command/run', { commandId: 'cmd-1', name: 'test', args: ' all' }),
    event('command/done', { commandId: 'cmd-1', kind: 'error', text: '命令输出' }),
    event('turn/start', { turn: 0 }),
    assistant([text('中断前正文')], 0, { interrupted: true }),
    event('turn/end', { reason: { kind: 'error', error: { code: 'OFFLINE', message: '连接已断开' } } }),
  ])
  for (const kept of ['/test all', '命令失败', '命令输出', '中断前正文', '（未完成）', 'OFFLINE', '连接已断开']) assert.ok(markdown.includes(kept))
  assert.ok(!markdown.includes('仍在进行中'))
})

test('attachment-only messages keep names and durable references without embedding binary data', () => {
  const { markdown } = render([
    event('user/message', { source: { kind: 'user' }, content: [
      { type: 'image', attachment: { name: '截图.png', mediaType: 'image/png', width: 1280, height: 720, attachmentId: 'image-123', data: 'BINARY_PAYLOAD' } },
      { type: 'future-block', data: 'UNKNOWN_PAYLOAD' },
    ] }),
  ])
  for (const kept of ['## 用户', '截图.png', '1280 × 720', 'image-123', '未嵌入文件', 'future-block']) assert.ok(markdown.includes(kept))
  assert.ok(!markdown.includes('BINARY_PAYLOAD'))
  assert.ok(!markdown.includes('UNKNOWN_PAYLOAD'))
})

test('tool output with Markdown fences and HTML remains in a longer literal code fence', () => {
  const result = '```html\n</details><script>example</script>\n```'
  const { markdown } = render([
    event('tool/result', { message: { content: [text(result)] } }),
  ])
  assert.ok(markdown.includes('  ````text\n'))
  assert.ok(markdown.includes('  </details><script>example</script>'))
  assert.ok(markdown.includes('  ````\n'))
})

test('empty sessions export a valid document and unsafe titles produce bounded .md filenames', () => {
  const empty = render([])
  assert.equal(empty.filename, '未命名会话.md')
  assert.ok(empty.markdown.includes('尚无可导出的对话'))
  assert.equal(sessionExportFilename('  ../a:b\\c?*  ', 'id'), '-a-b-c--.md')
  assert.equal(sessionExportFilename('CON', 'id'), '_CON.md')
  assert.equal(sessionExportFilename(' ... ', 'a/b'), 'session-ab.md')
  const long = sessionExportFilename('🌱中文'.repeat(100), 'id')
  assert.ok(Buffer.byteLength(long, 'utf8') <= 184)
  assert.ok(long.endsWith('.md'))
  assert.ok(!long.includes('\ufffd'))
})

test('derived titles never split an astral Unicode character at the title boundary', () => {
  const prompt = `${'a'.repeat(79)}🌱 more text`
  const { filename, markdown } = render([user(prompt)])
  assert.ok(markdown.startsWith(`# ${'a'.repeat(79)}🌱\n`))
  assert.ok(filename.endsWith('🌱.md'))
  assert.ok(markdown.includes(prompt))
})
