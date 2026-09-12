/**
 * Markdown → editor HTML for the sticky-note editor.
 *
 * `htmlToMarkdown` runs in the browser (it needs DOMParser), but
 * `markdownToHtml` is pure and is what decides how a saved note looks when a
 * card opens. A note that renders as one flat paragraph every time it is
 * reopened is exactly the regression this pins.
 *
 * The source is imported directly, so these assert real output.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { markdownToHtml } = await import('../src/client/markdown.ts')

test('an empty note renders one empty paragraph, not nothing', () => {
  assert.equal(markdownToHtml(''), '<p><br></p>')
  assert.equal(markdownToHtml('   \n  '), '<p><br></p>')
})

test('a plain note renders as paragraphs with line breaks inside', () => {
  assert.equal(markdownToHtml('第一行'), '<p>第一行</p>')
  assert.equal(markdownToHtml('第一行\n第二行'), '<p>第一行\n第二行</p>')
  assert.equal(markdownToHtml('第一段\n\n第二段'), '<p>第一段</p><p>第二段</p>')
})

test('headings render at their level', () => {
  assert.equal(markdownToHtml('# 一'), '<h1>一</h1>')
  assert.equal(markdownToHtml('### 三'), '<h3>三</h3>')
  assert.equal(markdownToHtml('###### 六'), '<h6>六</h6>')
  assert.equal(markdownToHtml('####### 七'), '<p>####### 七</p>', 'seven hashes is not a heading')
})

test('lists render as real list elements', () => {
  assert.equal(markdownToHtml('- 一\n- 二'), '<ul><li>一</li><li>二</li></ul>')
  assert.equal(markdownToHtml('* 一'), '<ul><li>一</li></ul>')
  assert.equal(markdownToHtml('1. 一\n2. 二'), '<ol><li>一</li><li>二</li></ol>')
  assert.equal(markdownToHtml('3. 三'), '<ol start="3"><li>三</li></ol>', 'a custom start is kept')
})

test('a task list renders a checkbox with its state exposed', () => {
  const html = markdownToHtml('- [ ] 待办\n- [x] 完成')
  assert.match(html, /data-task="1"/)
  assert.match(html, /data-checked="false"[\s\S]*data-checked="true"/, 'the two states differ')
  assert.match(html, /role="checkbox"/)
  assert.match(html, /aria-checked="true"/)
  assert.match(html, /待办/)
  assert.match(html, /完成/)
})

test('a blockquote renders each line as a paragraph', () => {
  assert.equal(markdownToHtml('> 引用'), '<blockquote><p>引用</p></blockquote>')
  assert.equal(
    markdownToHtml('> 一\n> 二'),
    '<blockquote><p>一</p><p>二</p></blockquote>',
  )
})

test('a fenced block keeps its language and is not parsed as Markdown', () => {
  const html = markdownToHtml('```ts\nconst a = 1\n```')
  assert.match(html, /<pre data-lang="ts">/)
  assert.match(html, /<code>const a = 1<\/code>/)
  assert.doesNotMatch(html, /<em>/, 'an underscore in code is not emphasis')
})

test('an unfenced code block still terminates at the end of the note', () => {
  // A fence the user never closed must not swallow the rest of the library.
  const html = markdownToHtml('```\n未闭合')
  assert.match(html, /<pre/)
  assert.match(html, /未闭合/)
})

test('inline marks render as elements, not literal stars', () => {
  assert.equal(markdownToHtml('**粗**'), '<p><strong>粗</strong></p>')
  assert.equal(markdownToHtml('*斜*'), '<p><em>斜</em></p>')
  assert.equal(markdownToHtml('~~删~~'), '<p><s>删</s></p>')
  assert.equal(markdownToHtml('`码`'), '<p><code>码</code></p>')
})

test('inline marks do not fire mid-word', () => {
  assert.equal(markdownToHtml('a*b*c'), '<p>a*b*c</p>', 'a lone asterisk stays literal')
  assert.equal(markdownToHtml('2*3*4'), '<p>2*3*4</p>')
})

test('links and images render with their targets', () => {
  assert.equal(markdownToHtml('[标题](http://x)'), '<p><a href="http://x">标题</a></p>')
  const image = markdownToHtml('![说明](/quick-notes/attachment/img-1)')
  assert.match(image, /<img src="\/quick-notes\/attachment\/img-1"/)
  assert.match(image, /alt="说明"/)
  assert.match(image, /data-md-image="1"/, 'the serializer can find it again')
})

test('an image is preferred over a link when both could match', () => {
  // `![a](b)` must not render as a link containing "![".
  assert.doesNotMatch(markdownToHtml('![a](b)'), /<a /)
})

test('HTML in the source is escaped rather than injected', () => {
  const html = markdownToHtml('<script>alert(1)</script>')
  assert.doesNotMatch(html, /<script>/, 'a script tag cannot reach the surface')
  assert.match(html, /&lt;script&gt;/)
  assert.equal(markdownToHtml('`&amp;`'), '<p><code>&amp;amp;</code></p>', 'code is escaped too')
})

test('a thematic break renders as an hr', () => {
  assert.equal(markdownToHtml('---'), '<hr>')
  assert.equal(markdownToHtml('***'), '<hr>')
})

test('a whole note renders every block in order', () => {
  const html = markdownToHtml('# 标题\n\n正文一段\n\n- [x] 完成\n- [ ] 待办\n\n> 引用\n\n---\n\n结尾')
  // Tasks render as checkbox paragraphs (see the task test above), so the
  // opening order is heading, body, then the two task rows.
  const order = [...html.matchAll(/<(h1|p|ul|li|blockquote|hr)/g)].map(match => match[1])
  assert.deepEqual(order.slice(0, 3), ['h1', 'p', 'p'])
  assert.ok(html.includes('data-task="1"'), 'the tasks are checkboxes')
  assert.ok(html.includes('<blockquote>'))
  assert.ok(html.includes('<hr>'))
  assert.ok(html.includes('结尾'))
  assert.ok(html.indexOf('结尾') > html.indexOf('<hr>'), 'the tail comes after the rule')
})

test('a GFM table renders as a real table, not a pipe paragraph', () => {
  const html = markdownToHtml('| 维度 | 当前最高 |\n| --- | --- |\n| SWE-bench | 96% |')
  assert.match(html, /data-md-table="1"/)
  assert.match(html, /data-md-table-scroll="1"/)
  assert.match(html, /data-md-table-add="row"/)
  assert.match(html, /data-md-table-add="col"/)
  assert.match(html, /data-md-table-remove="row"/)
  assert.match(html, /data-md-table-remove="col"/)
  assert.match(html, /<table>/)
  assert.match(html, /<th>维度<\/th>/)
  assert.match(html, /<th>当前最高<\/th>/)
  assert.match(html, /<td>SWE-bench<\/td>/)
  assert.match(html, /<td>96%<\/td>/)
  assert.doesNotMatch(html, /<p>\| 维度/)
})

test('a table without outer pipes still renders and honors alignment', () => {
  const html = markdownToHtml('来源 | 工作区 | 会话\n:--- | :---: | ---:\n会话地图 | DSH-Plugs | 随手笔记')
  assert.match(html, /<th>来源<\/th>/)
  assert.match(html, /<th data-align="center">工作区<\/th>/)
  assert.match(html, /<th data-align="right">会话<\/th>/)
  assert.match(html, /<td>会话地图<\/td>/)
})

test('two pipe rows without a delimiter still become a table', () => {
  const html = markdownToHtml('| 来源 | 工作区 |\n| 会话地图 | DSH-Plugs |')
  assert.match(html, /<th>来源<\/th>/)
  assert.match(html, /<td>DSH-Plugs<\/td>/)
  assert.doesNotMatch(markdownToHtml('只是提到 A | B 这种写法'), /<table>/)
})

test('a table does not swallow the paragraph above it', () => {
  const html = markdownToHtml('说明如下\n| A | B |\n| --- | --- |\n| 1 | 2 |')
  assert.match(html, /<p>说明如下<\/p>/)
  assert.match(html, /<th>A<\/th>/)
  assert.ok(html.indexOf('<p>说明如下</p>') < html.indexOf('<table>'))
})

test('an empty table cell keeps a break so the caret has somewhere to sit', () => {
  const html = markdownToHtml('| A | B |\n| --- | --- |\n|  | x |')
  assert.match(html, /<td><br><\/td><td>x<\/td>/)
})

test('a phrasing tag in the source is restored; everything else stays escaped', () => {
  const footnote = '<small>*ARC-AGI-3 分数有出入：Engadget 报 98.6%，另一家报 99.9%。这正是我上一轮说的"看口径"的活案例。另外 Epoch AI 的 ECI 综合指数榜首是 GPT-6 Astra。</small>'
  const html = markdownToHtml(footnote)
  assert.match(html, /<p><small>\*ARC-AGI-3/)
  assert.match(html, /<\/small><\/p>/)
  assert.doesNotMatch(html, /&lt;small/)
  assert.doesNotMatch(html, /<em>/, 'a lone opening * is a footnote marker')

  assert.match(markdownToHtml('<small>*footnote*</small>'), /<small><em>footnote<\/em><\/small>/)
  assert.match(markdownToHtml('line<br>break'), /<p>line<br>break<\/p>/)
  assert.match(markdownToHtml('E = mc<sup>2</sup>'), /<sup>2<\/sup>/)

  assert.match(markdownToHtml('<small onclick="alert(1)">x</small>'), /&lt;small onclick=/)
  assert.match(markdownToHtml('<script>alert(1)</script>'), /&lt;script&gt;/)
  assert.doesNotMatch(markdownToHtml('<script>alert(1)</script>'), /<script>/)

  const code = markdownToHtml('`<small>x</small>`')
  assert.match(code, /<code>&lt;small&gt;x&lt;\/small&gt;<\/code>/)
  const fence = markdownToHtml('```\n<small>x</small>\n```')
  assert.match(fence, /<code>&lt;small&gt;x&lt;\/small&gt;<\/code>/)
})

test('a session-map style note keeps the table and the small footnote', () => {
  const html = markdownToHtml('| 维度 | 当前最高 |\n| --- | --- |\n| SWE-bench | 96% |\n\n<small>*ARC-AGI-3 分数有出入。</small>')
  assert.match(html, /data-md-table="1"/)
  assert.match(html, /<td>SWE-bench<\/td>/)
  assert.match(html, /<p><small>\*ARC-AGI-3/)
  assert.ok(html.indexOf('<table>') < html.indexOf('<small>'))
})

test('a table cell can hold inline marks and a small tag', () => {
  const html = markdownToHtml('| **粗** | <small>注</small> |\n| --- | --- |')
  assert.match(html, /<th><strong>粗<\/strong><\/th>/)
  assert.match(html, /<th><small>注<\/small><\/th>/)
})
