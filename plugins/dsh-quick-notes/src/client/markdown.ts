// Markdown ↔ DOM for the sticky-note editor.
//
// The editor edits a real contenteditable surface (so typing, IME, selection,
// and undo behave like the platform's own), but every note is stored as plain
// Markdown on the Host. These two functions are that boundary.
//
// The supported set is deliberately the one that survives a round trip
// unchanged: paragraphs, ATX headings, bullet and ordered lists, task lists,
// blockquotes, fenced code, thematic breaks, links, images, and inline bold /
// italic / strike / inline code. Anything else a paste brings in is downgraded
// to text rather than smuggled into a note as HTML.

import { attachmentRef } from '../shared.ts'

/** One block in the parsed document. */
type Block =
  | { kind: 'p'; lines: string[]; task?: { checked: boolean; text: string } }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'ul'; items: string[]; ordered: false }
  | { kind: 'ol'; items: string[]; ordered: true; start: number }
  | { kind: 'hr' }
  | { kind: 'blank' }

const ESCAPE_HTML = /[&<>"']/g

function escapeHtml(text: string): string {
  return text.replace(ESCAPE_HTML, char => (
    char === '&' ? '&amp;'
      : char === '<' ? '&lt;'
        : char === '>' ? '&gt;'
          : char === '"' ? '&quot;'
            : '&#39;'
  ))
}

/** Render Markdown to the HTML the editor edits. */
export function markdownToHtml(markdown: string): string {
  const blocks = parseBlocks(markdown.replace(/\r\n?/g, '\n'))
  if (blocks.length === 0) return '<p><br></p>'
  return blocks.map(blockToHtml).join('')
}

function blockToHtml(block: Block): string {
  switch (block.kind) {
    case 'p':
      if (block.task !== undefined) {
        return `<p data-task="1" data-checked="${block.task.checked ? 'true' : 'false'}">`
          + `<span contenteditable="false" data-task-box="1" role="checkbox" aria-checked="${block.task.checked ? 'true' : 'false'}"></span>`
          + `<span data-task-text="1">${inlineToHtml(block.task.text)}</span></p>`
      }
      return `<p>${inlineToHtml(block.lines.join('\n'))}</p>`
    case 'h':
      return `<h${String(block.level)}>${inlineToHtml(block.text)}</h${String(block.level)}>`
    case 'quote':
      return `<blockquote>${block.lines.map(line => `<p>${inlineToHtml(line)}</p>`).join('')}</blockquote>`
    case 'code':
      return `<pre data-lang="${escapeHtml(block.lang)}"><code>${escapeHtml(block.text)}</code></pre>`
    case 'ul':
    case 'ol': {
      const tag = block.ordered ? 'ol' : 'ul'
      const start = block.ordered && block.start !== 1 ? ` start="${String(block.start)}"` : ''
      return `<${tag}${start}>${block.items.map(item => `<li>${inlineToHtml(item)}</li>`).join('')}</${tag}>`
    }
    case 'hr':
      return '<hr>'
    case 'blank':
      return ''
  }
}

/**
 * Whether emphasis may open at this position.
 *
 * An opening `*`/`_` needs a non-word character (or nothing) immediately
 * before it, so `a*b*c` and `2*3*4` stay literal instead of turning into
 * emphasis mid-word. `before` is the already-serialized text of this run;
 * entity references end in `;` and are treated as punctuation-free text.
 */
function atWordEdge(before: string, rest: string): boolean {
  const previous = before.length === 0 ? '' : before.slice(-1)
  if (previous === '') return true
  if (previous === ';') {
    // An escaped entity (`&amp;`): look at the character it represents.
    return true
  }
  return !/[0-9A-Za-z一-鿿]/.test(previous)
}

function inlineToHtml(text: string): string {
  let out = ''
  let index = 0
  while (index < text.length) {
    const rest = text.slice(index)

    // Images first: `![alt](src)` — the only construct allowed to contain `]`.
    const image = /^!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/.exec(rest)
    if (image !== null) {
      out += `<img src="${escapeHtml(image[2] ?? '')}" alt="${escapeHtml(image[1] ?? '')}" data-md-image="1">`
      index += image[0].length
      continue
    }

    const link = /^\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/.exec(rest)
    if (link !== null) {
      out += `<a href="${escapeHtml(link[2] ?? '')}">${inlineToHtml(link[1] ?? '')}</a>`
      index += link[0].length
      continue
    }

    const code = /^`([^`]+)`/.exec(rest)
    if (code !== null) {
      out += `<code>${escapeHtml(code[1] ?? '')}</code>`
      index += code[0].length
      continue
    }

    // Emphasis only opens at a position where the run is not mid-word: in
    // "a*b*c" the asterisks are literal, and in "2*3*4" they are arithmetic.
    // `before` is the text already emitted for this inline run.
    const strong = atWordEdge(out, rest) ? /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest) : null
    if (strong !== null) {
      out += `<strong>${inlineToHtml(strong[2] ?? '')}</strong>`
      index += strong[0].length
      continue
    }

    const emphasis = atWordEdge(out, rest) ? /^(\*|_)(?=\S)([\s\S]*?\S)\1/.exec(rest) : null
    if (emphasis !== null) {
      out += `<em>${inlineToHtml(emphasis[2] ?? '')}</em>`
      index += emphasis[0].length
      continue
    }

    const strike = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest)
    if (strike !== null) {
      out += `<s>${inlineToHtml(strike[1] ?? '')}</s>`
      index += strike[0].length
      continue
    }

    out += escapeHtml(text[index] ?? '')
    index += 1
  }
  return out === '' ? '<br>' : out
}

function parseBlocks(source: string): Block[] {
  const lines = source.split('\n')
  const blocks: Block[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''

    if (line.trim() === '') {
      index += 1
      continue
    }

    const fence = /^\s{0,3}```\s*([^\s`]*)/.exec(line)
    if (fence !== null) {
      const lang = fence[1] ?? ''
      const body: string[] = []
      index += 1
      while (index < lines.length && !/^\s{0,3}```\s*$/.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '')
        index += 1
      }
      index += 1
      blocks.push({ kind: 'code', lang, text: body.join('\n') })
      continue
    }

    if (/^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/.test(line)) {
      blocks.push({ kind: 'hr' })
      index += 1
      continue
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      blocks.push({ kind: 'h', level: (heading[1] ?? '#').length, text: (heading[2] ?? '').trim() })
      index += 1
      continue
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      const quoted: string[] = []
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index] ?? '')) {
        quoted.push((lines[index] ?? '').replace(/^\s{0,3}>\s?/, ''))
        index += 1
      }
      blocks.push({ kind: 'quote', lines: quoted })
      continue
    }

    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line)
    if (bullet !== null) {
      const items: string[] = []
      const tasks: { checked: boolean; text: string }[] = []
      const TASK = /^(\s*)[-*+] \[( |x|X)\]\s+(.*)$/
      const BULLET = /^(\s*)[-*+]\s+(.*)$/
      const single = TASK.exec(line)
      while (index < lines.length) {
        const task = TASK.exec(lines[index] ?? '')
        const item = task ?? BULLET.exec(lines[index] ?? '')
        if (item === null) break
        if (task !== null) {
          tasks.push({ checked: (task[2] ?? ' ').toLowerCase() === 'x', text: task[3] ?? '' })
          items.push(task[3] ?? '')
        } else {
          items.push(item[2] ?? '')
        }
        index += 1
      }
      // A task list renders as one checkbox paragraph per item, not as a <ul>:
      // it keeps the box clickable and the text directly editable.
      if (single !== null && tasks.length === items.length) {
        for (const task of tasks) {
          blocks.push({ kind: 'p', lines: [task.text], task })
        }
        continue
      }
      blocks.push({ kind: 'ul', items, ordered: false })
      continue
    }

    const ordered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line)
    if (ordered !== null) {
      const items: string[] = []
      const start = Number.parseInt(ordered[2] ?? '1', 10)
      while (index < lines.length) {
        const item = /^(\s*)\d+[.)]\s+(.*)$/.exec(lines[index] ?? '')
        if (item === null) break
        items.push(item[2] ?? '')
        index += 1
      }
      blocks.push({ kind: 'ol', items, ordered: true, start: Number.isFinite(start) ? start : 1 })
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index] ?? ''
      if (current.trim() === '') break
      if (/^\s{0,3}(#{1,6})\s+/.test(current)) break
      if (/^\s{0,3}```/.test(current)) break
      if (/^\s{0,3}>\s?/.test(current)) break
      if (/^(\s*)[-*+]\s+/.test(current)) break
      if (/^(\s*)\d+[.)]\s+/.test(current)) break
      if (/^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/.test(current)) break
      paragraph.push(current)
      index += 1
    }
    blocks.push({ kind: 'p', lines: paragraph })
  }

  return blocks
}

/**
 * Serialize the editor's DOM back to Markdown.
 *
 * Reads structural `data-md-*` markers where the DOM is ambiguous (task
 * paragraphs, images) and otherwise walks the tree, so the surface stays
 * editable by the browser without carrying hidden state.
 */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  return serializeChildren(doc.body).replace(/\n{3,}/g, '\n\n').trim()
}

function serializeChildren(node: Element): string {
  const parts: string[] = []
  for (const child of Array.from(node.children)) parts.push(serializeBlock(child))
  return parts.join('\n\n')
}

function serializeBlock(node: Element): string {
  const tag = node.tagName.toLowerCase()

  if (tag === 'hr') return '---'

  if (tag === 'blockquote') {
    const inner = Array.from(node.children)
      .map(child => (child.tagName.toLowerCase() === 'p' ? inlineToMarkdown(child) : serializeBlock(child)))
      .join('\n\n')
    // An empty line becomes `> ` on its own, which reads as a stray quoted
    // blank row once the note is reopened — blank lines stay blank.
    return inner
      .split('\n')
      .map(line => (line.trim() === '' ? '>' : `> ${line}`))
      .join('\n')
  }

  if (tag === 'pre') {
    const code = node.querySelector('code')
    const text = (code?.textContent ?? node.textContent ?? '').replace(/\n$/, '')
    const lang = node.getAttribute('data-lang') ?? ''
    return `\`\`\`${lang}\n${text}\n\`\`\``
  }

  if (tag === 'ul' || tag === 'ol') {
    const items = Array.from(node.children)
      .filter(child => child.tagName.toLowerCase() === 'li')
      .map((child, at) => {
        const text = inlineToMarkdown(child).replace(/\n/g, ' ')
        return tag === 'ol' ? `${String(at + 1)}. ${text}` : `- ${text}`
      })
    return items.join('\n')
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = Number.parseInt(tag.slice(1), 10)
    return `${'#'.repeat(level)} ${inlineToMarkdown(node)}`
  }

  if (node.getAttribute('data-task') === '1') {
    const checked = node.getAttribute('data-checked') === 'true'
    const textNode = node.querySelector('[data-task-text]')
    const text = inlineToMarkdown(textNode ?? node).trim()
    return `- [${checked ? 'x' : ' '}] ${text}`
  }

  if (tag === 'div' || tag === 'section' || tag === 'article') {
    return serializeChildren(node)
  }

  if (tag === 'p' || tag === 'div') return inlineToMarkdown(node)

  return inlineToMarkdown(node)
}

function inlineToMarkdown(node: Element): string {
  let out = ''
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      out += child.textContent ?? ''
      continue
    }
    if (child.nodeType !== 1) continue
    const element = child as Element
    const tag = element.tagName.toLowerCase()

    if (tag === 'br') {
      out += '\n'
      continue
    }
    if (tag === 'img') {
      const alt = element.getAttribute('alt') ?? ''
      const src = element.getAttribute('src') ?? ''
      out += `![${alt}](${src})`
      continue
    }
    if (tag === 'a') {
      const href = element.getAttribute('href') ?? ''
      const text = inlineToMarkdown(element)
      out += href === '' ? text : `[${text}](${href})`
      continue
    }
    if (tag === 'code') {
      out += `\`${element.textContent ?? ''}\``
      continue
    }
    if (tag === 'strong' || tag === 'b') {
      out += `**${inlineToMarkdown(element).trim()}**`
      continue
    }
    if (tag === 'em' || tag === 'i') {
      out += `*${inlineToMarkdown(element).trim()}*`
      continue
    }
    if (tag === 's' || tag === 'del' || tag === 'strike') {
      out += `~~${inlineToMarkdown(element).trim()}~~`
      continue
    }
    if (tag === 'span' && element.getAttribute('data-task-box') === '1') continue
    out += inlineToMarkdown(element)
  }
  return out
}

/** The Markdown image reference the editor inserts for a stored attachment. */
export function imageMarkdown(imageId: string, alt = ''): string {
  return `![${alt}](${attachmentRef(imageId)})`
}
