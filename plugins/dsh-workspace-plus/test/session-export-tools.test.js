import { test } from 'node:test'
import assert from 'node:assert/strict'

import { summarizeToolArguments, summarizeToolResult } from '../src/session-export-tools.ts'

test('tool arguments retain targets while omitting edit bodies and credentials', () => {
  const summary = summarizeToolArguments(JSON.stringify({
    file_path: '/workspace/src/index.ts',
    content: 'private file body'.repeat(100),
    token: 'secret-value',
    old_string: 'old body',
    new_string: 'new body',
  }))
  assert.match(summary, /file_path: \/workspace\/src\/index.ts/)
  assert.match(summary, /4 fields omitted/)
  assert.doesNotMatch(summary, /private file body|secret-value|old body|new body/)
})

test('shell and search calls retain their concrete command and search target', () => {
  assert.equal(summarizeToolArguments('{"command":"pnpm test","cwd":"/project"}'),
    'command: pnpm test; cwd: /project')
  assert.equal(summarizeToolArguments({ query: 'export session', path: '/project' }),
    'path: /project; query: export session')
  assert.equal(summarizeToolArguments('{}'), '')
  assert.equal(summarizeToolArguments(undefined), '')
})

test('unknown arguments summarize a few fields without serializing nested payloads', () => {
  const summary = summarizeToolArguments({
    mode: 'fast',
    tasks: [{ body: 'huge-body' }],
    options: { data: 'nested secret' },
    extra: 'fourth field',
    api_key: 'secret',
  })
  assert.match(summary, /mode: fast/)
  assert.match(summary, /tasks: \[object\]/)
  assert.match(summary, /options: \[object: 1 fields\]/)
  assert.match(summary, /2 fields omitted/)
  assert.doesNotMatch(summary, /huge-body|nested secret|fourth field|api_key/)
})

test('arguments remain bounded and explicitly mark truncated data', () => {
  const summary = summarizeToolArguments({
    cmd: 'long command with many flags '.repeat(40),
    path: '/deep/path/'.repeat(30),
    query: 'search word '.repeat(100),
    content: 'not exported',
  })
  assert.ok(summary.length <= 300)
  assert.match(summary, /truncated/)
  assert.match(summary, /1 fields omitted/)
  assert.equal(summarizeToolArguments('*** Begin Patch\n*** Add File: secret\n+body\n*** End Patch'),
    '[patch content omitted]')
})

test('short results preserve text and whitespace while removing terminal presentation', () => {
  const summary = summarizeToolResult([
    { type: 'text', text: '\u001b[32mPASS\u001b[0m src/a.ts\n  2 tests passed' },
    { type: 'text', text: '\u001b]8;;https://example.com\u0007report\u001b]8;;\u0007' },
  ], false)
  assert.equal(summary, 'PASS src/a.ts\n  2 tests passed\nreport')
  assert.equal(summarizeToolResult([{ type: 'text', text: '  indented code\n\n' }], false),
    '  indented code\n\n')
})

test('nested result blocks preserve canonical content once and retain repeated output lines', () => {
  const summary = summarizeToolResult([{
    type: 'tool-result',
    content: [{ type: 'text', text: 'first\nsame\nsame\nlast' }],
    text: 'first\nsame\nsame\nlast',
    metadata: { blob: 'not exported' },
  }], false)
  assert.equal(summary, 'first\nsame\nsame\nlast')
})

test('successful logs are bounded with both the beginning and final outcome visible', () => {
  const text = 'Build starting\n' + 'building module\n'.repeat(200) + 'Build finished: 47 modules'
  const summary = summarizeToolResult([{ type: 'text', text }], false)
  assert.ok(summary.length <= 800)
  assert.ok(summary.startsWith('Build starting\n'))
  assert.ok(summary.endsWith('Build finished: 47 modules'))
  assert.match(summary, /output truncated/)
})

test('failures allow more diagnostic context and preserve structured error facts', () => {
  const text = 'Compiling\n' + 'import trace\n'.repeat(200) + 'Cannot find module ./missing.ts'
  const summary = summarizeToolResult([{ type: 'text', text }], true, {
    name: 'BuildError',
    code: 'MODULE_NOT_FOUND',
    message: 'Cannot find module ./missing.ts',
    stack: 'large stack trace excluded',
  })
  assert.ok(summary.length > 800 && summary.length <= 1_600)
  assert.match(summary, /^name: BuildError; code: MODULE_NOT_FOUND\nCompiling/)
  assert.ok(summary.endsWith('Cannot find module ./missing.ts'))
  assert.equal(summary.split('Cannot find module ./missing.ts').length - 1, 1)
  assert.doesNotMatch(summary, /large stack/)
})

test('nested tool errors receive the error diagnostic budget', () => {
  const summary = summarizeToolResult({
    type: 'tool-result',
    isError: true,
    content: [{ type: 'text', text: 'diagnostic line\n'.repeat(200) }],
  }, false)
  assert.ok(summary.length > 800 && summary.length <= 1_600)
  assert.match(summary, /truncated/)
})

test('images and unknown content use placeholders without leaking binary data', () => {
  const data = 'A'.repeat(512)
  const summary = summarizeToolResult([
    { type: 'image', attachment: { filename: 'screen.png', mimeType: 'image/png', data } },
    { type: 'custom', payload: data },
    { type: 'text', text: `Inline data:image/png;base64,${data}\nResult is ready` },
  ], false)
  assert.match(summary, /\[image: screen.png, image\/png; attachment omitted\]/)
  assert.match(summary, /\[custom output omitted\]/)
  assert.match(summary, /Inline \[base64 data omitted\]\nResult is ready/)
  assert.doesNotMatch(summary, /AAAA/)
})

test('plain base64, cycles, and empty values do not produce raw payload dumps', () => {
  assert.equal(summarizeToolResult('A'.repeat(512), false), '[base64 data omitted]')
  const cycle = { type: 'tool-result' }
  cycle.content = [cycle]
  assert.equal(summarizeToolResult(cycle, false), '[nested output omitted]')
  assert.equal(summarizeToolResult([], false), '')
  assert.equal(summarizeToolResult(undefined, true, new Error('permission denied')),
    'name: Error; message: permission denied')
})
test('current host failure reasons survive when no result text contains the explanation', () => {
  const output = summarizeToolResult([], true, {
    name: 'ToolError',
    code: 'DENIED',
    reason: 'The requested path is outside the workspace',
  })
  assert.ok(output.includes('DENIED'))
  assert.ok(output.includes('The requested path is outside the workspace'))
  const rendered = summarizeToolResult([{ type: 'text', text: 'Request denied' }], true, { reason: 'Request denied' })
  assert.equal(rendered, 'Request denied')
})
