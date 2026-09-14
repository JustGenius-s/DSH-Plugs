// Markdown ↔ DOM for the sticky-note editor.
//
// The editor edits a real contenteditable surface (so typing, IME, selection,
// and undo behave like the platform's own), but every note is stored as plain
// Markdown on the Host. These two functions are that boundary.
//
// The supported set is deliberately the one that survives a round trip
// unchanged: paragraphs, ATX headings, bullet and ordered lists, task lists,
// blockquotes, fenced code, thematic breaks, GFM tables, links, images, a
// tight allowlist of phrasing HTML (`<small>`, `<br>`, `<sup>`…), and
// inline bold / italic / strike / inline code. Anything else a paste brings
// in is downgraded to text rather than smuggled into a note as HTML.

import { attachmentRef } from '../shared.ts'

/** One block in the parsed document. */
type Alignment = 'left' | 'center' | 'right'

type TableBlock = {
  kind: 'table'
  headers: string[]
  alignments: Alignment[]
  rows: string[][]
}

type Block =
  | { kind: 'p'; lines: string[]; task?: { checked: boolean; text: string } }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'ul'; items: string[]; ordered: false }
  | { kind: 'ol'; items: string[]; ordered: true; start: number }
  | TableBlock
  | { kind: 'hr' }
  | { kind: 'blank' }

const SAFE_PHRASING = new Set([
  'small', 'sub', 'sup', 'mark', 'kbd', 'cite', 'q', 'dfn', 'samp', 'var', 'abbr',
])
const VOID_PHRASING = new Set(['br', 'wbr'])

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
    case 'table':
      return tableToHtml(block)
    case 'hr':
      return '<hr>'
    case 'blank':
      return ''
  }
}

function tableToHtml(block: TableBlock): string {
  const alignAttr = (index: number): string => {
    const align = block.alignments[index] ?? 'left'
    return align === 'left' ? '' : ` data-align="${align}"`
  }
  const cell = (text: string, tag: 'th' | 'td', index: number): string => (
    `<${tag}${alignAttr(index)}>${inlineToHtml(text)}</${tag}>`
  )
  const head = block.headers.map((text, index) => cell(text, 'th', index)).join('')
  const body = block.rows.map(row => (
    `<tr>${row.map((text, index) => cell(text, 'td', index)).join('')}</tr>`
  )).join('')
  return `<div data-md-table="1"><div data-md-table-scroll="1"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${tableAddControlsHtml()}</div>`
}

/** Edge controls the editor clicks to grow or shrink a live table. */
export function tableAddControlsHtml(): string {
  return '<div data-md-table-edge="col">'
    + '<button type="button" contenteditable="false" data-md-table-add="col" tabindex="-1" aria-label="添加列">+</button>'
    + '<button type="button" contenteditable="false" data-md-table-remove="col" tabindex="-1" aria-label="删除列">−</button>'
    + '</div>'
    + '<div data-md-table-edge="row">'
    + '<button type="button" contenteditable="false" data-md-table-add="row" tabindex="-1" aria-label="添加行">+</button>'
    + '<button type="button" contenteditable="false" data-md-table-remove="row" tabindex="-1" aria-label="删除行">−</button>'
    + '</div>'
}

/** Map a chrome button to a grow or shrink axis. */
export function tableChromeKind(value: string | null | undefined): 'row' | 'col' | null {
  if (value === 'row' || value === 'col') return value
  return null
}

export type TableChromeCommand =
  | { op: 'add'; kind: 'row' | 'col' }
  | { op: 'remove'; kind: 'row' | 'col' }

/** Read add/remove from a chrome button. */
export function tableChromeCommand(target: { getAttribute(name: string): string | null }): TableChromeCommand | null {
  const add = tableChromeKind(target.getAttribute('data-md-table-add'))
  if (add !== null) return { op: 'add', kind: add }
  const remove = tableChromeKind(target.getAttribute('data-md-table-remove'))
  if (remove !== null) return { op: 'remove', kind: remove }
  return null
}

/**
 * Where a new body row lands in `<tbody>`.
 *
 * `afterRow` is an index in `table.rows` (header included). Inserting
 * through `HTMLTableElement.insertRow` can land in `<thead>` and the new
 * row never shows up as a body cell.
 */
export function tableInsertBodyIndex(afterRow: number, headerCount: number, bodyCount: number): number {
  const afterBody = afterRow - headerCount
  return Math.min(bodyCount, Math.max(0, afterBody + 1))
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

    const voidHtml = /^<(br|wbr)\s*\/?>/i.exec(rest)
    if (voidHtml !== null) {
      out += `<${(voidHtml[1] ?? 'br').toLowerCase()}>`
      index += voidHtml[0].length
      continue
    }

    // Models wrap footnotes in <small> and drop <sup> into prose. Only a
    // matching, attributeless pair is restored — `<small onclick>` stays text.
    const openHtml = /^<(small|sub|sup|mark|kbd|cite|q|dfn|samp|var|abbr)>/i.exec(rest)
    if (openHtml !== null) {
      const name = (openHtml[1] ?? '').toLowerCase()
      const close = `</${name}>`
      const closeAt = text.toLowerCase().indexOf(close, index + openHtml[0].length)
      if (closeAt !== -1) {
        const inner = text.slice(index + openHtml[0].length, closeAt)
        out += `<${name}>${inner === '' ? '' : inlineToHtml(inner)}</${name}>`
        index = closeAt + close.length
        continue
      }
    }

    out += escapeHtml(text[index] ?? '')
    index += 1
  }
  return out === '' ? '<br>' : out
}

function tableCells(line: string): string[] {
  const trimmed = String(line ?? '').trim()
  if (trimmed === '' || !trimmed.includes('|')) return []
  return trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
}

function isTableDelimiter(line: string): boolean {
  const cells = tableCells(line)
  return cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell.replace(/\s+/g, '')))
}

function tableAlignments(line: string): Alignment[] {
  return tableCells(line).map(cell => {
    const mark = cell.replace(/\s+/g, '')
    const left = mark.startsWith(':')
    const right = mark.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    return 'left'
  })
}

function isTableRow(line: string): boolean {
  if (typeof line !== 'string') return false
  if (/^\s{0,3}#{1,6}\s+/.test(line)) return false
  if (/^\s{0,3}>\s?/.test(line)) return false
  if (/^\s{0,3}[-*+]\s+/.test(line)) return false
  if (/^\s{0,3}\d+[.)]\s+/.test(line)) return false
  return tableCells(line).length >= 2
}

function takeTable(lines: string[], index: number): { block: TableBlock; next: number } | null {
  const line = lines[index] ?? ''
  if (!isTableRow(line) || index + 1 >= lines.length) return null
  const next = lines[index + 1] ?? ''
  if (isTableDelimiter(next) && tableCells(next).length > 0) {
    const headers = tableCells(line)
    const alignments = tableAlignments(next)
    while (alignments.length < headers.length) alignments.push('left')
    const rows: string[][] = []
    let cursor = index + 2
    while (cursor < lines.length && isTableRow(lines[cursor] ?? '') && !isTableDelimiter(lines[cursor] ?? '')) {
      const cells = tableCells(lines[cursor] ?? '')
      rows.push(headers.map((_, column) => cells[column] ?? ''))
      cursor += 1
    }
    return { block: { kind: 'table', headers, alignments: alignments.slice(0, headers.length), rows }, next: cursor }
  }
  const columns = tableCells(line).length
  if (!isTableRow(next) || isTableDelimiter(next) || tableCells(next).length !== columns) return null
  const headers = tableCells(line)
  const rows: string[][] = [tableCells(next)]
  let cursor = index + 2
  while (
    cursor < lines.length
    && isTableRow(lines[cursor] ?? '')
    && !isTableDelimiter(lines[cursor] ?? '')
    && tableCells(lines[cursor] ?? '').length === columns
  ) {
    rows.push(tableCells(lines[cursor] ?? ''))
    cursor += 1
  }
  return { block: { kind: 'table', headers, alignments: headers.map(() => 'left' as const), rows }, next: cursor }
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

    const table = takeTable(lines, index)
    if (table !== null) {
      blocks.push(table.block)
      index = table.next
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
      if (takeTable(lines, index) !== null) break
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

  if (tag === 'table' || node.getAttribute('data-md-table') === '1') {
    return serializeTable(node)
  }

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
    if (VOID_PHRASING.has(tag)) {
      out += tag === 'br' ? '\n' : `<${tag}>`
      continue
    }
    if (SAFE_PHRASING.has(tag)) {
      out += `<${tag}>${inlineToMarkdown(element)}</${tag}>`
      continue
    }
    if (tag === 'span' && element.getAttribute('data-task-box') === '1') continue
    out += inlineToMarkdown(element)
  }
  return out
}

function tableRowsOf(node: Element): Element[] {
  const rows: Element[] = []
  const walk = (element: Element): void => {
    if (element.tagName.toLowerCase() === 'tr') {
      rows.push(element)
      return
    }
    for (const child of Array.from(element.children)) walk(child)
  }
  walk(node)
  return rows
}

function cellChildren(row: Element): Element[] {
  return Array.from(row.children).filter(child => {
    const tag = child.tagName.toLowerCase()
    return tag === 'th' || tag === 'td'
  })
}

function alignmentOf(cell: Element): Alignment {
  const data = cell.getAttribute('data-align')
  if (data === 'center' || data === 'right' || data === 'left') return data
  return 'left'
}

function alignmentMarker(align: Alignment): string {
  if (align === 'center') return ':---:'
  if (align === 'right') return '---:'
  return '---'
}

function cellToMarkdown(cell: Element): string {
  const text = inlineToMarkdown(cell).replace(/\n/g, '<br>').trim()
  return text === '<br>' ? '' : text
}

function serializeTable(node: Element): string {
  const rows = tableRowsOf(node)
  if (rows.length === 0) return ''
  const headerCells = cellChildren(rows[0] ?? node)
  const headers = headerCells.map(cellToMarkdown)
  if (headers.length === 0) return ''
  const alignments = headerCells.map(alignmentOf)
  const delimiter = headers.map((_, index) => alignmentMarker(alignments[index] ?? 'left'))
  const body = rows.slice(1).map(row => {
    const cells = cellChildren(row).map(cellToMarkdown)
    while (cells.length < headers.length) cells.push('')
    return cells.slice(0, headers.length)
  })
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`
  return [line(headers), line(delimiter), ...body.map(line)].join('\n')
}

/** True when the whole snippet is one GFM table and nothing else. */
export function isSingleTableMarkdown(text: string): boolean {
  const blocks = parseBlocks(String(text ?? '').replace(/\r\n?/g, '\n'))
  return blocks.length === 1 && blocks[0]?.kind === 'table'
}

/**
 * True when a typed paragraph should become a live table.
 *
 * The delimiter row is required so two poetic pipe lines are not promoted
 * mid-keystroke; a finished `| --- |` row is the commit.
 */
export function isTypedTableMarkdown(text: string): boolean {
  if (!isSingleTableMarkdown(text)) return false
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n').some(line => isTableDelimiter(line))
}

/** A 2×2 table the toolbar inserts. Empty cells keep a caret target. */
export const EMPTY_TABLE_MARKDOWN = '|  |  |\n| --- | --- |\n|  |  |'

/** A single line that can belong to a typed GFM table. */
export function looksLikeTableLine(text: string): boolean {
  const line = String(text ?? '').replace(/\u00a0/g, ' ').trim()
  if (isTableDelimiter(line)) return true
  return line.startsWith('|') && tableCells(line).length >= 2
}

/**
 * Join adjacent typed lines into one table document, or null if they are
 * not yet a finished GFM table (no delimiter row, or leftover prose).
 */
export function typedTableFromLines(lines: string[]): string | null {
  const text = lines
    .map(line => String(line ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+$/g, ''))
    .join('\n')
  return isTypedTableMarkdown(text) ? text : null
}

/**
 * A copied contenteditable table usually arrives as tab-separated rows.
 * Turn that back into GFM so a paste stays a live table.
 */
export function tsvToTableMarkdown(text: string): string | null {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim() !== '')
  if (lines.length < 2) return null
  const rows = lines.map(line => line.split('\t').map(cell => cell.trim()))
  const columns = rows[0]?.length ?? 0
  if (columns < 2) return null
  if (rows.some(row => row.length !== columns)) return null
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`
  const delimiter = rows[0]?.map(() => '---') ?? []
  return [line(rows[0] ?? []), line(delimiter), ...rows.slice(1).map(line)].join('\n')
}

/** Normalize a paste into Markdown the editor can render as elements. */
export function markdownFromPaste(text: string): string {
  return tsvToTableMarkdown(text) ?? String(text ?? '')
}

export function pastedMarkdownLooksRich(text: string): boolean {
  const source = String(text ?? '')
  if (tsvToTableMarkdown(source) !== null) return true
  if (/<(small|br|wbr|sub|sup|mark|kbd|cite|q|dfn|samp|var|abbr)(\s*\/)?>/i.test(source)) return true
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  for (let index = 0; index < lines.length; index++) {
    if (takeTable(lines, index) !== null) return true
  }
  return false
}

export type TableKeyAction =
  | { type: 'move'; row: number; col: number }
  | { type: 'insert-row'; afterRow: number; focusCol: number }
  | { type: 'insert-col'; afterCol: number; focusRow: number }
  | { type: 'remove-row'; row: number; focusRow: number; focusCol: number }
  | { type: 'remove-col'; col: number; focusRow: number; focusCol: number }
  | { type: 'leave'; direction: -1 | 1 }
  | { type: 'break' }

/** Grow the table from a known cell, used by the 行/列 toolbar and the + chrome. */
export function tableGrowAction(
  kind: 'row' | 'col',
  input: { rowIndex: number; colIndex: number },
): TableKeyAction {
  if (kind === 'row') return { type: 'insert-row', afterRow: input.rowIndex, focusCol: input.colIndex }
  return { type: 'insert-col', afterCol: input.colIndex, focusRow: input.rowIndex }
}

/** Shrink the table from a known cell. The header and the last column stay. */
export function tableShrinkAction(
  kind: 'row' | 'col',
  input: { rowIndex: number; colIndex: number; rowCount: number; colCount: number },
): TableKeyAction | null {
  if (kind === 'row') {
    if (input.rowIndex <= 0) return null
    const focusRow = input.rowIndex === input.rowCount - 1 ? input.rowIndex - 1 : input.rowIndex
    return { type: 'remove-row', row: input.rowIndex, focusRow, focusCol: input.colIndex }
  }
  if (input.colCount <= 1) return null
  const focusCol = input.colIndex === input.colCount - 1 ? input.colIndex - 1 : input.colIndex
  return { type: 'remove-col', col: input.colIndex, focusRow: input.rowIndex, focusCol }
}

/**
 * What a key does inside a table cell.
 *
 * The surface never rewrites the table's innerHTML on a keystroke — it
 * applies this action to the live DOM so the caret stays put.
 */
export function tableKeyAction(input: {
  key: string
  shiftKey: boolean
  rowIndex: number
  colIndex: number
  rowCount: number
  colCount: number
  cellEmpty: boolean
  caretAtStart: boolean
  columnEmpty?: boolean
}): TableKeyAction | null {
  const { key, shiftKey, rowIndex, colIndex, rowCount, colCount, cellEmpty, caretAtStart, columnEmpty } = input
  if (key === 'Tab') {
    if (shiftKey) {
      if (rowIndex === 0 && colIndex === 0) return { type: 'leave', direction: -1 }
      if (colIndex > 0) return { type: 'move', row: rowIndex, col: colIndex - 1 }
      return { type: 'move', row: rowIndex - 1, col: colCount - 1 }
    }
    if (rowIndex === rowCount - 1 && colIndex === colCount - 1) {
      return { type: 'insert-row', afterRow: rowIndex, focusCol: 0 }
    }
    if (colIndex < colCount - 1) return { type: 'move', row: rowIndex, col: colIndex + 1 }
    return { type: 'move', row: rowIndex + 1, col: 0 }
  }
  if (key === 'Enter') {
    if (shiftKey) return { type: 'break' }
    if (rowIndex === rowCount - 1) return { type: 'insert-row', afterRow: rowIndex, focusCol: colIndex }
    return { type: 'move', row: rowIndex + 1, col: colIndex }
  }
  if (key === 'Backspace' && cellEmpty && caretAtStart) {
    if (rowIndex > 0 && rowIndex === rowCount - 1) {
      return { type: 'remove-row', row: rowIndex, focusRow: rowIndex - 1, focusCol: colIndex }
    }
    if (colIndex === colCount - 1 && colCount > 1 && columnEmpty === true) {
      return { type: 'remove-col', col: colIndex, focusRow: rowIndex, focusCol: colIndex - 1 }
    }
  }
  return null
}

/** The Markdown image reference the editor inserts for a stored attachment. */
export function imageMarkdown(imageId: string, alt = ''): string {
  return `![${alt}](${attachmentRef(imageId)})`
}
