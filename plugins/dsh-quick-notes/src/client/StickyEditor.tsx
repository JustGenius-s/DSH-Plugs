// The sticky-note editor: a contenteditable surface that stores Markdown.
//
// It is WYSIWYG — `# ` becomes a heading as you type, `- [ ]` becomes a real
// checkbox — while `htmlToMarkdown` keeps the note on disk plain Markdown.
// Pasting an image uploads it to the Host and inserts a reference; pasting
// anything richer is flattened to text so no stray HTML reaches storage.

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { htmlToMarkdown, imageMarkdown, markdownToHtml } from './markdown.ts'
import { IMAGE_MEDIA_TYPES, MAX_IMAGE_BYTES } from '../shared.ts'
import styles from './StickyEditor.module.css'

export interface StickyEditorProps {
  /** Markdown body to display; re-read only when `revision` changes. */
  markdown: string
  /**
   * Identity of the note currently loaded into the surface.
   *
   * Must stay stable while the user types. Binding this to `updatedAt` or the
   * live markdown string rewrites `innerHTML` on every keystroke and kills
   * the caret (and IME composition).
   */
  revision: string | number
  autoFocus?: boolean
  /** Bumped by the store to steal focus when the shortcut reuses this card. */
  focusTick?: number
  /** Hide the format bar and image row — used for a blank new card. */
  bare?: boolean
  placeholder?: string
  disabled?: boolean
  ariaLabel: string
  onChange: (markdown: string) => void
  onSaveNow: () => void
  onOpenSearch: () => void
  onToast: (message: string) => void
}

interface InputRule {
  pattern: RegExp
  tag: string
}

const INPUT_RULES: InputRule[] = [
  { pattern: /^#\s$/, tag: 'h1' },
  { pattern: /^##\s$/, tag: 'h2' },
  { pattern: /^###\s$/, tag: 'h3' },
  { pattern: /^>\s$/, tag: 'blockquote' },
  { pattern: /^[-*+]\s$/, tag: 'ul' },
  { pattern: /^1\.\s$/, tag: 'ol' },
]

export function StickyEditor(props: StickyEditorProps): JSX.Element {
  const surface = useRef<HTMLDivElement | null>(null)
  const lastEmitted = useRef<string>(props.markdown)
  const file = useRef<{ name: string; data: string }>({ name: '', data: '' })

  const emit = useCallback(() => {
    const node = surface.current
    if (node === null) return
    const next = htmlToMarkdown(node.innerHTML)
    if (next === lastEmitted.current) return
    lastEmitted.current = next
    props.onChange(next)
  }, [props])

  // Load a note into the surface only when `revision` changes. The live
  // markdown string is the echo of what we just typed — writing it back
  // here is what made the card feel like it "couldn't accept input".
  useEffect(() => {
    const node = surface.current
    if (node === null) return
    const html = markdownToHtml(props.markdown)
    if (node.innerHTML !== html) node.innerHTML = html
    lastEmitted.current = props.markdown
    if (props.autoFocus === true) {
      node.focus()
      placeCaretAtEnd(node)
    }
  }, [props.revision])

  useEffect(() => {
    if (props.focusTick === undefined || props.focusTick <= 0) return
    const node = surface.current
    if (node === null) return
    node.focus()
    placeCaretAtEnd(node)
  }, [props.focusTick])

  const command = useCallback((name: 'bold' | 'italic' | 'strike' | 'code' | 'h1' | 'h2' | 'quote' | 'ul' | 'ol' | 'task') => {
    const node = surface.current
    if (node === null) return
    node.focus()
    applyCommand(node, name)
    emit()
    props.onSaveNow()
  }, [emit, props])

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const node = surface.current
    if (node === null) return

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      emit()
      props.onSaveNow()
      return
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      const block = currentBlock(node)
      if (block !== null && block.getAttribute('data-task') === '1') {
        // Enter inside a task makes the next sibling a task; leaving an
        // emptied task ends the run, which is what a checklist should do.
        event.preventDefault()
        const empty = (block.querySelector('[data-task-text]')?.textContent ?? '').trim() === ''
        if (empty) {
          const paragraph = document.createElement('p')
          paragraph.innerHTML = '<br>'
          block.replaceWith(paragraph)
          placeCaretAtEnd(paragraph)
        } else {
          const next = makeTask(false, '')
          block.after(next)
          placeCaretAtEnd(next.querySelector('[data-task-text]') ?? next)
        }
        emit()
        return
      }
      if (block !== null && block.tagName.toLowerCase() === 'li' && (block.textContent ?? '').trim() === '') {
        event.preventDefault()
        const paragraph = document.createElement('p')
        paragraph.innerHTML = '<br>'
        const list = block.parentElement
        list?.after(paragraph)
        block.remove()
        if (list !== null && list.children.length === 0) list.remove()
        placeCaretAtEnd(paragraph)
        emit()
        return
      }
    }

    if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      document.execCommand(event.shiftKey ? 'outdent' : 'indent')
      emit()
    }
  }, [emit, props])

  const onInput = useCallback(() => {
    const node = surface.current
    if (node === null) return
    applyInputRules(node)
    emit()
  }, [emit])

  const onPaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    const images = Array.from(event.clipboardData.files).filter(item => item.type.startsWith('image/'))
    if (images.length === 0) {
      // Plain text keeps the surface clean: no foreign HTML, no styles.
      const text = event.clipboardData.getData('text/plain')
      if (text !== '') {
        event.preventDefault()
        document.execCommand('insertText', false, text)
      }
      return
    }

    event.preventDefault()
    for (const image of images) {
      if (!(IMAGE_MEDIA_TYPES as readonly string[]).includes(image.type)) {
        props.onToast(`不支持的图片格式：${image.type || '未知'}`)
        continue
      }
      if (image.size > MAX_IMAGE_BYTES) {
        props.onToast('图片超过 10MB，已跳过')
        continue
      }
      void insertImage(image, surface.current, emit, props.onToast)
    }
  }, [emit, props])

  const toolbar = useMemo(() => (
    <div className={styles.toolbar} role="toolbar" aria-label="格式">
      <button type="button" className={styles.tool} title="加粗" onClick={() => command('bold')}>B</button>
      <button type="button" className={styles.tool} title="斜体" onClick={() => command('italic')}><em>I</em></button>
      <button type="button" className={styles.tool} title="删除线" onClick={() => command('strike')}><s>S</s></button>
      <button type="button" className={styles.tool} title="行内代码" onClick={() => command('code')}>{'</>'}</button>
      <span className={styles.divider} aria-hidden="true" />
      <button type="button" className={styles.tool} title="标题 1" onClick={() => command('h1')}>H1</button>
      <button type="button" className={styles.tool} title="标题 2" onClick={() => command('h2')}>H2</button>
      <button type="button" className={styles.tool} title="引用" onClick={() => command('quote')}>❝</button>
      <span className={styles.divider} aria-hidden="true" />
      <button type="button" className={styles.tool} title="无序列表" onClick={() => command('ul')}>•</button>
      <button type="button" className={styles.tool} title="有序列表" onClick={() => command('ol')}>1.</button>
      <button type="button" className={styles.tool} title="待办" onClick={() => command('task')}>☑</button>
    </div>
  ), [command, styles])

  return (
    <div className={styles.editor} data-bare={props.bare === true ? 'true' : undefined}>
      {toolbar}
      <div
        ref={surface}
        className={styles.surface}
        contentEditable={props.disabled !== true}
        suppressContentEditableWarning
        tabIndex={0}
        role="textbox"
        aria-multiline="true"
        aria-label={props.ariaLabel}
        data-placeholder={props.placeholder ?? ''}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => { emit(); props.onSaveNow() }}
        onClick={handleTaskClick}
      />
      <label className={styles.upload}>
        <input
          type="file"
          accept={(IMAGE_MEDIA_TYPES as readonly string[]).join(',')}
          className={styles.fileInput}
          onChange={(event) => {
            const picked = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (picked !== undefined) void insertImage(picked, surface.current, emit, props.onToast)
          }}
        />
        插入图片
      </label>
    </div>
  )
}

/** Upload one image and drop its Markdown reference at the caret. */
async function insertImage(
  image: File,
  surface: HTMLDivElement | null,
  emit: () => void,
  onToast: (message: string) => void,
): Promise<void> {
  if (surface === null) return
  const data = await readAsBase64(image)
  try {
    const response = await fetch('/quick-notes/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mediaType: image.type, data }),
    })
    const payload = await response.json() as { ok: boolean; value?: { id: string }; message?: string }
    if (!response.ok || payload.ok !== true || payload.value === undefined) {
      onToast(payload.message ?? '图片保存失败')
      return
    }
    surface.focus()
    document.execCommand('insertHTML', false, `<img src="/quick-notes/attachment/${payload.value.id}" alt="${escapeAttribute(image.name)}" data-md-image="1">`)
    emit()
  } catch (error) {
    onToast(error instanceof Error ? error.message : '图片保存失败')
  }
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = String(reader.result ?? '')
      const comma = value.indexOf(',')
      resolve(comma < 0 ? value : value.slice(comma + 1))
    }
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Markdown shortcuts: `# `, `> `, `- `, `1. ` at the start of a block. */
function applyInputRules(root: HTMLElement): void {
  const block = currentBlock(root)
  if (block === null) return
  const text = block.textContent ?? ''
  const rule = INPUT_RULES.find(candidate => candidate.pattern.test(text))
  if (rule === undefined) return

  if (rule.tag === 'ul' || rule.tag === 'ol') {
    block.innerHTML = '<br>'
    const list = document.createElement(rule.tag)
    const item = document.createElement('li')
    list.append(item)
    block.replaceWith(list)
    placeCaretAtEnd(item)
    return
  }

  if (rule.tag === 'blockquote') {
    const inner = document.createElement('p')
    inner.innerHTML = '<br>'
    const quote = document.createElement('blockquote')
    quote.append(inner)
    block.replaceWith(quote)
    placeCaretAtEnd(inner)
    return
  }

  const heading = document.createElement(rule.tag)
  heading.innerHTML = '<br>'
  block.replaceWith(heading)
  placeCaretAtEnd(heading)
}

function currentBlock(root: HTMLElement): HTMLElement | null {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) return null
  let node: Node | null = selection.getRangeAt(0).startContainer
  if (node.nodeType === 3) node = node.parentNode
  while (node !== null && node !== root) {
    if (node.nodeType === 1) {
      const element = node as HTMLElement
      const tag = element.tagName.toLowerCase()
      if (tag === 'p' || tag === 'li' || /^h[1-6]$/.test(tag) || tag === 'blockquote' || tag === 'pre') return element
    }
    node = node.parentNode
  }
  return null
}

function applyCommand(root: HTMLElement, name: string): void {
  switch (name) {
    case 'bold':
    case 'italic':
    case 'strike':
      document.execCommand(name === 'bold' ? 'bold' : name === 'italic' ? 'italic' : 'strikeThrough')
      return
    case 'code':
      wrapInline(root, 'code')
      return
    case 'h1':
    case 'h2': {
      const block = currentBlock(root)
      if (block === null) return
      const heading = document.createElement(name)
      heading.textContent = block.textContent ?? ''
      if (block.tagName.toLowerCase() === name) block.replaceWith(paragraphOf(block.textContent ?? ''))
      else block.replaceWith(heading)
      return
    }
    case 'quote': {
      const block = currentBlock(root)
      if (block === null) return
      if (block.parentElement?.tagName.toLowerCase() === 'blockquote') {
        block.parentElement.replaceWith(block)
        return
      }
      const quote = document.createElement('blockquote')
      const inner = document.createElement('p')
      inner.textContent = block.textContent ?? ''
      quote.append(inner)
      block.replaceWith(quote)
      return
    }
    case 'ul':
      document.execCommand('insertUnorderedList')
      return
    case 'ol':
      document.execCommand('insertOrderedList')
      return
    case 'task': {
      const block = currentBlock(root)
      if (block === null) return
      if (block.getAttribute('data-task') === '1') {
        block.replaceWith(listItemOf(block))
        return
      }
      const task = makeTask(false, block.textContent ?? '')
      block.replaceWith(task)
      placeCaretAtEnd(task.querySelector('[data-task-text]') ?? task)
      return
    }
  }
}

function makeTask(checked: boolean, text: string): HTMLElement {
  const paragraph = document.createElement('p')
  paragraph.setAttribute('data-task', '1')
  paragraph.setAttribute('data-checked', checked ? 'true' : 'false')
  const box = document.createElement('span')
  box.setAttribute('contenteditable', 'false')
  box.setAttribute('data-task-box', '1')
  box.setAttribute('role', 'checkbox')
  box.setAttribute('aria-checked', checked ? 'true' : 'false')
  const body = document.createElement('span')
  body.setAttribute('data-task-text', '1')
  body.textContent = text
  paragraph.append(box, body)
  return paragraph
}

function listItemOf(block: Element): HTMLElement {
  const item = document.createElement('li')
  item.textContent = block.querySelector('[data-task-text]')?.textContent ?? block.textContent ?? ''
  const list = document.createElement('ul')
  list.append(item)
  return list
}

function paragraphOf(text: string): HTMLElement {
  const paragraph = document.createElement('p')
  paragraph.textContent = text
  return paragraph
}

function wrapInline(root: HTMLElement, tag: string): void {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) return
  const range = selection.getRangeAt(0)
  if (range.collapsed) return
  const wrapper = document.createElement(tag)
  wrapper.append(range.extractContents())
  range.insertNode(wrapper)
  selection.removeAllRanges()
  const next = document.createRange()
  next.selectNodeContents(wrapper)
  selection.addRange(next)
  void root
}

/** Toggle a task checkbox when its box is clicked. */
function handleTaskClick(event: React.MouseEvent<HTMLDivElement>): void {
  const target = event.target as HTMLElement | null
  const box = target?.closest('[data-task-box]') as HTMLElement | null
  if (box === null) return
  const paragraph = box.closest('[data-task]') as HTMLElement | null
  if (paragraph === null) return
  const checked = paragraph.getAttribute('data-checked') !== 'true'
  paragraph.setAttribute('data-checked', checked ? 'true' : 'false')
  box.setAttribute('aria-checked', checked ? 'true' : 'false')
}

function placeCaretAtEnd(node: Node): void {
  const range = document.createRange()
  range.selectNodeContents(node)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}
