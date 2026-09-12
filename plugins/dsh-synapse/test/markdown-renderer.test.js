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
  // A list item is structural: it ends the paragraph above it. The table that
  // follows belongs to the ITEM (it is not indented past the marker, so it is
  // a sibling block of the item's own body, rendered inside it).
  const beforeList = renderMarkdown('- 项目\n| A | B |\n| --- | --- |\n| 1 | 2 |')
  assert.match(beforeList, /<li>/)
  assert.match(beforeList, /项目/)
  assert.match(beforeList, /md-table-wrap/)
  // An indented table is the item's own content, not a sibling of the list.
  const indented = renderMarkdown('- 项目\n\n  | A | B |\n  | --- | --- |\n  | 1 | 2 |')
  assert.match(indented, /<li>.*md-table-wrap.*<\/li>/s)
  // A table at column 0 after a finished list stays a top-level block.
  const afterList = renderMarkdown('- 项目\n\n| A | B |\n| --- | --- |\n| 1 | 2 |')
  assert.match(afterList, /<\/ul><div class="md-table-wrap">/)
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

/** Extract the markdown helpers so they can be unit-tested directly. */
async function loadMarkdownHelpers() {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const start = source.indexOf('const escapeHtml')
  const end = source.indexOf('function canvasConnectors')
  const context = { globalThis: {} }
  vm.createContext(context)
  vm.runInContext(`${source.slice(start, end)};globalThis.renderMarkdown = renderMarkdown;globalThis.inlineMarkdown = inlineMarkdown;globalThis.safeLinkUrl = safeLinkUrl`, context)
  return context.globalThis
}

test('renders blockquotes, including the blocks nested inside them', async () => {
  const { renderMarkdown } = await loadMarkdownHelpers()
  // A blank quote line starts a new paragraph; without one the lines are a
  // single lazy continuation, which is what CommonMark specifies.
  const result = renderMarkdown('> 注意这一点\n>\n> 还有这一点')
  assert.match(result, /<blockquote><p>注意这一点<\/p><p>还有这一点<\/p><\/blockquote>/)
  const lazy = renderMarkdown('> 注意这一点\n> 还有这一点')
  assert.match(lazy, /<blockquote><p>注意这一点\n还有这一点<\/p><\/blockquote>/)

  // A quote is a document in miniature: headings, lists and code inside it are
  // parsed rather than flattened into one line of text.
  const nested = renderMarkdown('> ## 小结\n>\n> - 第一项\n> - 第二项')
  assert.match(nested, /<blockquote><h2 id="md-h-1">小结<\/h2>/)
  assert.match(nested, /<li><p>第一项<\/p><\/li>/)
  // Nested quotes keep their own level.
  const deep = renderMarkdown('> 外层\n>\n> > 内层')
  assert.match(deep, /<blockquote><p>外层<\/p><blockquote><p>内层<\/p><\/blockquote><\/blockquote>/)
})

test('renders a thematic break instead of eating the line', async () => {
  const { renderMarkdown } = await loadMarkdownHelpers()
  assert.match(renderMarkdown('上面\n\n---\n\n下面'), /<hr>/)
  assert.match(renderMarkdown('上面\n\n***\n\n下面'), /<hr>/)
  // A list marker is not a rule, and a heading underline is not one either.
  assert.doesNotMatch(renderMarkdown('- 项目'), /<hr>/)
  assert.doesNotMatch(renderMarkdown('标题\n---'), /<hr>/)
})

test('keeps a list item body, including its nested list and code block', async () => {
  const { renderMarkdown } = await loadMarkdownHelpers()
  // An item is not one line: its indented continuation belongs to it. Without
  // this a rendered answer collapses into one dense wall of text.
  const result = renderMarkdown('- 项目\n  这是同一项的说明\n- 另一项')
  assert.match(result, /<li><p>项目\n这是同一项的说明<\/p><\/li>/)
  assert.match(result, /<li><p>另一项<\/p><\/li>/)

  const nested = renderMarkdown('- 项目\n  - 子项\n- 另一项')
  assert.match(nested, /<ul><li><p>项目<\/p><ul><li><p>子项<\/p><\/li><\/ul><\/li><li><p>另一项<\/p><\/li><\/ul>/)

  // Two blank lines end the list, so a following paragraph is not absorbed.
  const separated = renderMarkdown('- 项目\n\n\n之后的话')
  assert.match(separated, /<\/ul><p>之后的话<\/p>/)
})

test('a numbered list keeps its start and ordered items stay ordered', async () => {
  const { renderMarkdown } = await loadMarkdownHelpers()
  assert.match(renderMarkdown('1. 第一\n2. 第二'), /<ol><li><p>第一<\/p><\/li><li><p>第二<\/p><\/li><\/ol>/)
  assert.match(renderMarkdown('3. 第三\n4. 第四'), /<ol start="3">/)
})

test('a code fence keeps its language and drops the info string from the code', async () => {
  const { renderMarkdown } = await loadMarkdownHelpers()
  const result = renderMarkdown('```js\nconst a = 1\n```')

  assert.match(result, /<pre data-lang="js">/)
  assert.match(result, /<code>const a = 1<\/code>/)
  // The info string is metadata, not the first line of the sample.
  assert.doesNotMatch(result, /<code>js\n/)
  // An unnamed fence has no label.
  assert.doesNotMatch(renderMarkdown('```\nplain\n```'), /data-lang/)
  // A `#` inside a fence is code, not a heading.
  assert.doesNotMatch(renderMarkdown('```\n# not a heading\n```'), /<h1/)
  assert.match(renderMarkdown('```\n# not a heading\n```'), /<code># not a heading<\/code>/)
})

test('a link is only rendered for a safe scheme', async () => {
  const { renderMarkdown, safeLinkUrl } = await loadMarkdownHelpers()
  assert.match(renderMarkdown('[站点](https://example.com)'), /<a href="https:\/\/example\.com" target="_blank" rel="noreferrer noopener">站点<\/a>/)
  assert.match(renderMarkdown('[邮件](mailto:a@b.com)'), /<a href="mailto:a@b\.com"/)
  assert.match(renderMarkdown('[章节](#md-h-1)'), /<a href="#md-h-1"/)
  // A javascript: target must never become clickable in a rendered answer.
  assert.doesNotMatch(renderMarkdown('[点我](javascript:alert(1))'), /<a /)
  assert.doesNotMatch(renderMarkdown('[点我](JaVaScRiPt:alert(1))'), /<a /)
  assert.doesNotMatch(renderMarkdown('[点我](data:text/html,<script>)'), /<a /)
  assert.equal(safeLinkUrl('javascript:alert(1)'), null)
  assert.equal(safeLinkUrl(' data:text/html,x'), null)
  assert.equal(safeLinkUrl('https://example.com'), 'https://example.com')
})

test('preserves the author line breaks instead of collapsing them', async () => {
  const { renderMarkdown } = await loadMarkdownHelpers()
  // A soft break is a newline, not a <br>: the CSS's pre-wrap renders it, and
  // the text stays copy-pasteable as the author wrote it.
  const result = renderMarkdown('第一行\n第二行')
  assert.match(result, /<p>第一行\n第二行<\/p>/)
  assert.doesNotMatch(result, /<br>/)
})

test('a heading keeps its closing hashes out of the text', async () => {
  const { renderMarkdown } = await loadMarkdownHelpers()
  assert.match(renderMarkdown('## 标题 ##'), /<h2 id="md-h-1">标题<\/h2>/)
})

test('keeps a tight allowlist of phrasing HTML and leaves everything else escaped', async () => {
  const { renderMarkdown } = await loadMarkdownHelpers()
  const footnote = '<small>*ARC-AGI-3 分数有出入：Engadget 报 98.6%，另一家报 99.9%。这正是我上一轮说的"看口径"的活案例。另外 Epoch AI 的 ECI 综合指数榜首是 GPT-6 Astra。</small>'
  const result = renderMarkdown(footnote)
  assert.match(result, /<p><small>\*ARC-AGI-3/)
  assert.match(result, /<\/small><\/p>/)
  assert.doesNotMatch(result, /&lt;small/)
  // A lone opening * is a footnote marker, not emphasis.
  assert.doesNotMatch(result, /<em>/)

  assert.match(renderMarkdown('<small>*footnote*</small>'), /<small><em>footnote<\/em><\/small>/)
  assert.match(renderMarkdown('line<br>break'), /<p>line<br>break<\/p>/)
  assert.match(renderMarkdown('x<br/>y'), /<p>x<br>y<\/p>/)
  assert.match(renderMarkdown('E = mc<sup>2</sup>'), /<sup>2<\/sup>/)

  // Attributes and unknown tags stay escaped so they cannot become markup.
  assert.match(renderMarkdown('<small onclick="alert(1)">x</small>'), /&lt;small onclick=/)
  assert.match(renderMarkdown('<script>alert(1)</script>'), /&lt;script&gt;/)
  assert.doesNotMatch(renderMarkdown('<script>alert(1)</script>'), /<script>/)

  const code = renderMarkdown('`<small>x</small>`')
  assert.match(code, /<code>&lt;small&gt;x&lt;\/small&gt;<\/code>/)
  const fence = renderMarkdown('```\n<small>x</small>\n```')
  assert.match(fence, /<code>&lt;small&gt;x&lt;\/small&gt;<\/code>/)
})

test('sidebar small tags shrink without changing the surrounding type', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8')
  assert.match(css, /\.card-inspector-answer small \{[^}]*font-size: 0\.85em/)
  assert.match(css, /\.thread-answer small \{[^}]*font-size: 0\.85em/)
  assert.match(css, /\.message-body small \{[^}]*font-size: 0\.85em/)
})
