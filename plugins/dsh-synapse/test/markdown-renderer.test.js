import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

async function loadRenderer() {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const start = source.indexOf('const escapeHtml')
  const end = source.indexOf('function canvasConnectors')
  const context = { globalThis: {} }
  vm.createContext(context)
  vm.runInContext(`${source.slice(start, end)};globalThis.renderMarkdown = renderMarkdown`, context)
  return context.globalThis.renderMarkdown
}

test('renders images, quotes, and tables alongside links', async () => {
  const renderMarkdown = await loadRenderer()
  const result = renderMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |')

  assert.match(result, /class="md-table-wrap"/)
  assert.match(result, /<table><thead>/)
  assert.match(result, /<th>A<\/th>/)
  assert.match(result, /<td>2<\/td>/)
})

test('renders GFM tables without outer pipes and honors alignment', async () => {
  const renderMarkdown = await loadRenderer()
  const result = renderMarkdown('来源 | 工作区 | 会话\n:--- | :---: | ---:\n会话地图 | DSH-Plugs | 会话地图')

  assert.match(result, /class="md-table-wrap"/)
  assert.match(result, /<th>来源<\/th>/)
  assert.match(result, /<th class="md-table-center">工作区<\/th>/)
  assert.match(result, /<th class="md-table-right">会话<\/th>/)
  assert.match(result, /<td>会话地图<\/td>/)
})

test('falls back to a table when pipe rows omit the delimiter', async () => {
  const renderMarkdown = await loadRenderer()
  const result = renderMarkdown('| 来源 | 工作区 |\n| 会话地图 | DSH-Plugs |')

  assert.match(result, /class="md-table-wrap"/)
  assert.match(result, /<th>来源<\/th>/)
  assert.match(result, /<td>DSH-Plugs<\/td>/)

  // A lone pipe line is still a paragraph, not a one-row table.
  const lone = renderMarkdown('只是提到 A | B 这种写法')
  assert.doesNotMatch(lone, /<table>/)
  assert.match(lone, /<p>/)

  // A table does not swallow the paragraph above it.
  const attached = renderMarkdown('说明如下\n来源 | 工作区\n--- | ---\n会话地图 | DSH-Plugs')
  assert.match(attached, /<p>说明如下<\/p>/)
  assert.match(attached, /<th>来源<\/th>/)
  // A list item is structural: it must not be absorbed as a table row.
  const beforeList = renderMarkdown('- 项目\n| A | B |\n| --- | --- |\n| 1 | 2 |')
  assert.match(beforeList, /<li>项目<\/li>/)
  assert.match(beforeList, /md-table-wrap/)
})

test('sidebar tables scroll instead of wrapping every character', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8')
  const wrap = css.match(/\.md-table-wrap \{[^}]*\}/)?.[0] ?? ''
  const inspectorTable = css.match(/\.card-inspector-answer table \{[^}]*\}/)?.[0] ?? ''
  const inspectorCell = css.match(/\.card-inspector-answer th, \.card-inspector-answer td \{[^}]*\}/)?.[0] ?? ''

  assert.match(wrap, /overflow-x: auto/)
  assert.match(inspectorTable, /display: table/)
  assert.doesNotMatch(inspectorTable, /display: block/)
  assert.match(inspectorCell, /white-space: nowrap/)
  assert.doesNotMatch(inspectorCell, /overflow-wrap: anywhere/)
})

test('renders PowerShell marker-only diagnostic lines without stalling', async () => {
  const renderMarkdown = await loadRenderer()
  const input = 'cmd : Access is denied.\nAt line:1 char:1\n+ \n+ ~~~~~\n    + CategoryInfo : PermissionDenied'
  const result = renderMarkdown(input)

  assert.match(result, /cmd : Access is denied/)
  assert.match(result, /CategoryInfo/)
})

test('assigns heading ids and extracts a table of contents', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const start = source.indexOf('const escapeHtml')
  const end = source.indexOf('function canvasConnectors')
  const context = { globalThis: {} }
  vm.createContext(context)
  vm.runInContext(`${source.slice(start, end)};globalThis.renderMarkdown = renderMarkdown;globalThis.markdownHeadings = markdownHeadings`, context)
  const html = context.globalThis.renderMarkdown('# 标题一\n\n## 标题二')
  assert.match(html, /id="md-h-1"/)
  assert.match(html, /id="md-h-2"/)
  const headings = context.globalThis.markdownHeadings('# 标题一\n\n```\n# 代码里的标题\n```\n\n## 标题二')
  assert.equal(JSON.stringify(headings), JSON.stringify([
    { id: 'md-h-1', level: 1, text: '标题一' },
    { id: 'md-h-2', level: 2, text: '标题二' },
  ]))
})

test('note body keeps the reply and records the map source', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const start = source.indexOf('function inspectorNoteBody')
  const end = source.indexOf('function setInspectorTocOpen')
  const context = { globalThis: {} }
  vm.createContext(context)
  vm.runInContext(`${source.slice(start, end)};globalThis.inspectorNoteBody = inspectorNoteBody`, context)
  const body = context.globalThis.inspectorNoteBody({
    question: '怎么做',
    answer: '先打开地图',
    workspaceTitle: 'DSH-Plugs',
    sessionTitle: '会话地图',
    turnIndex: 0,
    sessionId: 'sess-1',
  })
  assert.match(body, /# 怎么做/)
  assert.match(body, /先打开地图/)
  assert.match(body, /来源：会话地图/)
  assert.match(body, /工作区：DSH-Plugs/)
  assert.match(body, /会话：会话地图/)
  assert.match(body, /轮次：第 1 轮/)
  assert.match(body, /会话 ID：sess-1/)
})
