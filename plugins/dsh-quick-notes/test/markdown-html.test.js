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
