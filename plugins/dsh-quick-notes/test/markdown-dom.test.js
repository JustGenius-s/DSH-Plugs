/**
 * The in-browser half of the round trip: editor DOM → Markdown.
 *
 * `htmlToMarkdown` needs DOMParser, which Node does not ship, so these build
 * the element tree directly. That is the right level anyway: it pins what the
 * serializer does with the shapes `markdownToHtml` emits, without dragging a
 * DOM implementation into the repo.
 *
 * A broken serializer is the worst failure in this plugin — it rewrites every
 * note on save — so the emphasis cases include the ones a naive walker gets
 * wrong (nested marks, mark inside a heading, text after an image).
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let home = ''
let htmlToMarkdown

before(async () => {
  home = mkdtempSync(join(tmpdir(), 'quick-notes-dom-'))
  process.env.DSH_HOME = home
  ;({ htmlToMarkdown } = await import('../src/client/markdown.ts'))
})

/** One element node, with the accessor surface the serializer walks. */
function el(tagName, attrs = {}, childNodes = []) {
  const node = {
    nodeType: 1,
    tagName,
    attrs,
    children: childNodes.filter(child => child.nodeType === 1),
    childNodes,
    getAttribute: key => (key in attrs ? attrs[key] : null),
    querySelector: selector => findIn(node, selector.trim().toLowerCase()),
  }
  Object.defineProperty(node, 'textContent', {
    get: () => childNodes.map(child => child.textContent).join(''),
  })
  return node
}

/** One text node. */
function text(value) {
  return { nodeType: 3, textContent: value }
}

function findIn(node, selector) {
  for (const child of node.children) {
    if (matches(child, selector)) return child
    const deeper = findIn(child, selector)
    if (deeper !== null) return deeper
  }
  return null
}

function matches(node, selector) {
  if (selector.startsWith('[') && selector.endsWith(']')) {
    return node.getAttribute(selector.slice(1, -1)) !== null
  }
  return node.tagName.toLowerCase() === selector
}

/** Serialize `children` as if they were the editor's top-level blocks. */
function serialize(children) {
  const body = el('BODY', {}, children)
  globalThis.DOMParser = class {
    parseFromString() {
      return { body }
    }
  }
  return htmlToMarkdown('')
}

test('a paragraph serializes to its text', () => {
  assert.equal(serialize([el('P', {}, [text('买咖啡豆')])]), '买咖啡豆')
})

test('consecutive paragraphs are separated by a blank line', () => {
  const out = serialize([el('P', {}, [text('第一段')]), el('P', {}, [text('第二段')])])
  assert.equal(out, '第一段\n\n第二段')
})

test('headings serialize to ATX markers at their level', () => {
  assert.equal(serialize([el('H1', {}, [text('一')])]), '# 一')
  assert.equal(serialize([el('H3', {}, [text('三')])]), '### 三')
})

test('inline marks keep their text instead of dropping it', () => {
  const p = el('P', {}, [
    el('STRONG', {}, [text('粗')]),
    text(' 和 '),
    el('EM', {}, [text('斜')]),
    text(' 和 '),
    el('CODE', {}, [text('码')]),
  ])
  assert.equal(serialize([p]), '**粗** 和 *斜* 和 `码`')
})

test('a mark inside a heading keeps both the marker and the text', () => {
  const h = el('H2', {}, [text('标题 '), el('STRONG', {}, [text('重点')])])
  assert.equal(serialize([h]), '## 标题 **重点**')
})

test('nested marks do not lose the inner text', () => {
  const p = el('P', {}, [el('STRONG', {}, [el('EM', {}, [text('又粗又斜')])])])
  assert.equal(serialize([p]), '***又粗又斜***')
})

test('a link keeps its href, and a link with no href keeps its text', () => {
  assert.equal(serialize([el('P', {}, [el('A', { href: 'http://x' }, [text('链接')])])]), '[链接](http://x)')
  assert.equal(serialize([el('P', {}, [el('A', {}, [text('无地址')])])]), '无地址')
})

test('an image serializes with its attachment reference and alt text', () => {
  const p = el('P', {}, [
    el('IMG', { src: '/quick-notes/attachment/img-1', alt: '图', 'data-md-image': '1' }),
  ])
  assert.equal(serialize([p]), '![图](/quick-notes/attachment/img-1)')
})

test('text after an image is preserved', () => {
  // A naive walker stops at the first child element and drops the rest.
  const p = el('P', {}, [
    text('看图：'),
    el('IMG', { src: '/quick-notes/attachment/img-1', alt: '', 'data-md-image': '1' }),
    text(' 这是注释'),
  ])
  assert.equal(serialize([p]), '看图：![](/quick-notes/attachment/img-1) 这是注释')
})

test('lists serialize to markers with one item per line', () => {
  const ul = el('UL', {}, [el('LI', {}, [text('一')]), el('LI', {}, [text('二')])])
  assert.equal(serialize([ul]), '- 一\n- 二')
  const ol = el('OL', {}, [el('LI', {}, [text('一')]), el('LI', {}, [text('二')])])
  assert.equal(serialize([ol]), '1. 一\n2. 二', 'ordered items are renumbered from the DOM')
})

test('a task paragraph serializes as a checkbox item', () => {
  const task = (checked, label) => el('P', { 'data-task': '1', 'data-checked': checked }, [
    el('SPAN', { 'data-task-box': '1' }),
    el('SPAN', { 'data-task-text': '1' }, [text(label)]),
  ])
  assert.equal(serialize([task('false', '待办')]), '- [ ] 待办')
  assert.equal(serialize([task('true', '完成')]), '- [x] 完成')
})

test('the task checkbox itself contributes no text', () => {
  // The box is a separate span; without this guard every task gains a stray
  // glyph and the note rewrites itself on every save.
  const task = el('P', { 'data-task': '1', 'data-checked': 'false' }, [
    el('SPAN', { 'data-task-box': '1' }, [text('☐')]),
    el('SPAN', { 'data-task-text': '1' }, [text('待办')]),
  ])
  assert.equal(serialize([task]), '- [ ] 待办')
})

test('a blockquote re-prefixes every line', () => {
  const quote = el('BLOCKQUOTE', {}, [
    el('P', {}, [text('一')]),
    el('P', {}, [text('二')]),
  ])
  // The separator between two quoted paragraphs is a bare `>` line, not `> `
  // with a trailing space: a stray space there shows up as an empty quoted row
  // every time the note is reopened.
  assert.equal(serialize([quote]), '> 一\n>\n> 二')
})

test('a code block keeps its fence and language', () => {
  const pre = el('PRE', { 'data-lang': 'ts' }, [el('CODE', {}, [text('const a = 1')])])
  assert.equal(serialize([pre]), '```ts\nconst a = 1\n```')
})

test('a hard break becomes a newline inside its block', () => {
  const p = el('P', {}, [text('第一行'), el('BR'), text('第二行')])
  assert.equal(serialize([p]), '第一行\n第二行')
})

test('a rule serializes to a thematic break', () => {
  assert.equal(serialize([el('HR')]), '---')
})

test('an unknown wrapper still yields its content', () => {
  // The browser can hand back a stray <div> after a paste; the text must not
  // disappear with it.
  const div = el('DIV', {}, [el('P', {}, [text('包一层')])])
  assert.equal(serialize([div]), '包一层')
})

test('runaway blank lines are collapsed', () => {
  const out = serialize([
    el('P', {}, [text('一')]),
    el('P', {}, [text('')]),
    el('P', {}, [text('二')]),
  ])
  assert.doesNotMatch(out, /\n{3,}/, 'no more than one blank line in a row')
  assert.match(out, /一[\s\S]*二/)
})
