/**
 * Self-drawn code and diff surfaces for the files panel.
 *
 * The ui-primitives `CodeBlock`/`DiffBlock` are NOT used here: that package
 * stubs its CSS modules out of the built bundle and ships no stylesheet, so
 * in a plugin bundle those components render unstyled. These views draw with
 * the panel's own CSS (same `--dsw-*` tokens as the git-graph panel), which
 * keeps the files panel visually consistent with the rest of the sidebar.
 *
 * Performance gates mirror VS Code's editor defaults:
 *  - `MAX_TOKENIZATION_LINE_LENGTH` (in highlight.ts): overlong lines skip
 *    the grammar entirely.
 *  - `STOP_RENDERING_LINE_AFTER`: DOM only paints the first N characters of
 *    a line (`editor.stopRenderingLineAfter`).
 *  - Viewport virtualization: only rows near the scroll window mount.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  type UIEvent,
} from 'react'
import {
  highlightLines,
  type HighlightSpan,
} from './highlight'
import { renderMarkdown } from './markdown'

/** Lines shown before a long file collapses behind an expand row. */
const MAX_PREVIEW_LINES = 400
/** Diff rows shown before a long patch collapses behind an expand row. */
const MAX_DIFF_ROWS = 240
/**
 * VS Code `editor.stopRenderingLineAfter` default. Characters past this
 * stay in the source string but are not painted.
 */
const STOP_RENDERING_LINE_AFTER = 10_000
/** Must match `.dsh-files-code-line` / `.dsh-files-diff-row` line-height. */
const ROW_HEIGHT = 21
/** Extra rows above/below the viewport so scroll feels continuous. */
const OVERSCAN_ROWS = 24

export interface ViewLabels {
  /** Expand-row label; `{count}` is the hidden row count. */
  expand: (count: number) => string
}

/** One file's contents with a line-number gutter and syntax highlighting. */
export function FileCodeView(props: {
  content: string
  /** File-extension language hint; unknown ids render plain. */
  lang?: string
  labels: ViewLabels
}) {
  const { content, lang, labels } = props
  const lines = useMemo(() => splitLines(content), [content])
  const [expanded, setExpanded] = useState(false)
  const capped = !expanded && lines.length > MAX_PREVIEW_LINES
  const list = useMemo(
    () => (capped ? lines.slice(0, MAX_PREVIEW_LINES) : lines),
    [capped, lines],
  )
  // Highlight only the painted slice (not the whole buffer), and after the
  // first plain-text paint — sync Shiki on render blocked open for 0.5–2s+.
  const [highlighted, setHighlighted] = useState<HighlightSpan[][] | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    setHighlighted(undefined)
    const slice = list.join('\n')
    const handle = window.setTimeout(() => {
      const result = highlightLines(slice, lang)
      if (!cancelled) setHighlighted(result)
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [lang, list])
  const gutterWidth = String(lines.length).length
  const { start, end, onScroll, totalHeight, offsetY, scrollerRef } = useVirtualWindow(list.length)

  return (
    <div className="dsh-files-view" ref={scrollerRef} onScroll={onScroll}>
      <div
        className="dsh-files-code"
        style={{ height: totalHeight + (capped ? 28 : 0) }}
      >
        <div
          className="dsh-files-virt-window"
          style={{ top: offsetY }}
        >
          {list.slice(start, end).map((line, offset) => {
            const index = start + offset
            return (
              <div key={index} className="dsh-files-code-line">
                <span
                  className="dsh-files-code-ln"
                  style={{ width: gutterWidth + 'ch' }}
                >
                  {index + 1}
                </span>
                <span className="dsh-files-code-text">
                  {renderLineText(line, highlighted?.[index])}
                </span>
              </div>
            )
          })}
        </div>
        {capped ? (
          <div
            className="dsh-files-expand-slot"
            style={{ top: list.length * ROW_HEIGHT }}
          >
            <ExpandRow
              count={lines.length - MAX_PREVIEW_LINES}
              labels={labels}
              onExpand={() => setExpanded(true)}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

type DiffRowKind = 'hunk' | 'add' | 'del' | 'ctx' | 'note'

interface DiffRow {
  kind: DiffRowKind
  /** Line number on the old side (del/ctx rows only). */
  oldLn?: number
  /** Line number on the new side (add/ctx rows only). */
  newLn?: number
  text: string
}

/** One file's unified patch with dual line-number gutters. */
export function FileDiffView(props: {
  patch: string
  /** File-extension language hint; unknown ids render plain. */
  lang?: string
  labels: ViewLabels
}) {
  const { patch, lang, labels } = props
  const rows = useMemo(() => parsePatch(patch), [patch])
  const highlighted = useMemo(() => highlightDiffRows(rows, lang), [rows, lang])
  const [expanded, setExpanded] = useState(false)
  const capped = !expanded && rows.length > MAX_DIFF_ROWS
  const list = capped ? rows.slice(0, MAX_DIFF_ROWS) : rows
  let maxLn = 0
  for (const row of rows) {
    maxLn = Math.max(maxLn, row.oldLn ?? 0, row.newLn ?? 0)
  }
  const gutterWidth = String(Math.max(maxLn, 1)).length
  const { start, end, onScroll, totalHeight, offsetY, scrollerRef } = useVirtualWindow(list.length)

  return (
    <div className="dsh-files-view" ref={scrollerRef} onScroll={onScroll}>
      <div
        className="dsh-files-diff-body"
        style={{ height: totalHeight + (capped ? 28 : 0) }}
      >
        <div
          className="dsh-files-virt-window"
          style={{ top: offsetY }}
        >
          {list.slice(start, end).map((row, offset) => {
            const index = start + offset
            return (
              <div key={index} className={'dsh-files-diff-row is-' + row.kind}>
                {/* One sticky gutter: both line numbers and the sign stay pinned
                    while the text scrolls horizontally under them. */}
                <span className="dsh-files-diff-gutter">
                  <span
                    className="dsh-files-diff-ln"
                    style={{ width: gutterWidth + 'ch' }}
                  >
                    {row.oldLn ?? ''}
                  </span>
                  <span
                    className="dsh-files-diff-ln"
                    style={{ width: gutterWidth + 'ch' }}
                  >
                    {row.newLn ?? ''}
                  </span>
                  <span className="dsh-files-diff-sign">{signFor(row.kind)}</span>
                </span>
                <span className="dsh-files-diff-text">
                  {renderLineText(row.text, highlighted[index])}
                </span>
              </div>
            )
          })}
        </div>
        {capped ? (
          <div
            className="dsh-files-expand-slot"
            style={{ top: list.length * ROW_HEIGHT }}
          >
            <ExpandRow
              count={rows.length - MAX_DIFF_ROWS}
              labels={labels}
              onExpand={() => setExpanded(true)}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * One markdown file rendered for preview. `renderMarkdown` is memoized so
 * re-renders of the same mounted preview (e.g. a parent state change) don't
 * re-parse the source; the toggle-back to preview re-parses once, which is
 * cheap for typical documents. The container scrolls (no virtualization —
 * markdown blocks have no fixed row height) and `.dsh-files-md-body` carries
 * the prose styling.
 */
export function FileMarkdownView(props: { content: string }) {
  const html = useMemo(() => renderMarkdown(props.content), [props.content])
  return (
    <div
      className="dsh-files-md-body"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/**
 * Track the visible row window inside a vertically scrolling `.dsh-files-view`.
 * Horizontal scroll is unchanged (sticky gutters still pin to `left: 0`).
 */
function useVirtualWindow(count: number): {
  start: number
  end: number
  offsetY: number
  totalHeight: number
  scrollerRef: RefObject<HTMLDivElement | null>
  onScroll: (event: UIEvent<HTMLDivElement>) => void
} {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [window, setWindow] = useState({ start: 0, end: Math.min(count, 60) })
  const raf = useRef(0)

  const syncWindow = useCallback((top: number, height: number): void => {
    const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN_ROWS)
    const last = Math.min(
      count,
      Math.ceil((top + height) / ROW_HEIGHT) + OVERSCAN_ROWS,
    )
    setWindow((current) => (
      current.start === first && current.end === last
        ? current
        : { start: first, end: last }
    ))
  }, [count])

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (el === null) {
      setWindow({ start: 0, end: Math.min(count, 60) })
      return
    }
    syncWindow(el.scrollTop, el.clientHeight)
  }, [count, syncWindow])

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>): void => {
    const top = event.currentTarget.scrollTop
    const height = event.currentTarget.clientHeight
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      syncWindow(top, height)
    })
  }, [syncWindow])

  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const start = Math.min(window.start, count)
  const end = Math.min(Math.max(window.end, start), count)
  return {
    start,
    end,
    offsetY: start * ROW_HEIGHT,
    totalHeight: count * ROW_HEIGHT,
    scrollerRef,
    onScroll,
  }
}

/**
 * Paint one line's text, truncating past `STOP_RENDERING_LINE_AFTER` and
 * falling back to plain text when highlight spans are missing or empty
 * (overlong lines skipped by the tokenizer).
 */
function renderLineText(
  line: string,
  spans: readonly HighlightSpan[] | undefined,
): ReactNode {
  if (line.length === 0) return ' '
  const cut = line.length > STOP_RENDERING_LINE_AFTER
  const text = cut ? line.slice(0, STOP_RENDERING_LINE_AFTER) : line
  if (spans === undefined || spans.length === 0) {
    return cut ? text + '…' : text
  }
  const clipped = clipSpans(spans, STOP_RENDERING_LINE_AFTER)
  return (
    <>
      {clipped.map((span, spanIndex) => (
        <span key={spanIndex} style={span.style as CSSProperties}>
          {span.text}
        </span>
      ))}
      {cut ? '…' : null}
    </>
  )
}

/** Keep spans whose cumulative length stays within `max` characters. */
function clipSpans(
  spans: readonly HighlightSpan[],
  max: number,
): HighlightSpan[] {
  const out: HighlightSpan[] = []
  let used = 0
  for (const span of spans) {
    if (used >= max) break
    const room = max - used
    if (span.text.length <= room) {
      out.push(span)
      used += span.text.length
      continue
    }
    out.push({ text: span.text.slice(0, room), style: span.style })
    break
  }
  return out
}

function ExpandRow(props: {
  count: number
  labels: ViewLabels
  onExpand: () => void
}) {
  return (
    <button
      type="button"
      className="dsh-files-expand"
      onClick={props.onExpand}
    >
      {props.labels.expand(props.count)}
    </button>
  )
}

function splitLines(content: string): string[] {
  const body = content.endsWith('\n') ? content.slice(0, -1) : content
  return body.length === 0 ? [] : body.split('\n')
}

/**
 * Parse a unified patch into render rows. File headers (`diff --git`,
 * `index`, `---`, `+++`, mode lines) are dropped — the panel header already
 * names the file. Hunk headers reset the line-number counters; `\ No newline
 * at end of file` and binary notes render as dimmed note rows.
 */
function parsePatch(patch: string): DiffRow[] {
  const rows: DiffRow[] = []
  let oldLn = 0
  let newLn = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (match !== null) {
        oldLn = Number.parseInt(match[1] ?? '0', 10)
        newLn = Number.parseInt(match[2] ?? '0', 10)
      }
      rows.push({ kind: 'hunk', text: line })
      continue
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      rows.push({ kind: 'add', newLn, text: line.slice(1) })
      newLn += 1
      continue
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      rows.push({ kind: 'del', oldLn, text: line.slice(1) })
      oldLn += 1
      continue
    }
    if (line.startsWith(' ')) {
      rows.push({ kind: 'ctx', oldLn, newLn, text: line.slice(1) })
      oldLn += 1
      newLn += 1
      continue
    }
    if (line.startsWith('\\') || line.startsWith('Binary files')) {
      rows.push({ kind: 'note', text: line })
      continue
    }
    // Anything else is a file-header/meta line — hidden by design.
  }
  return rows
}

function signFor(kind: DiffRowKind): string {
  if (kind === 'add') return '+'
  if (kind === 'del') return '−'
  return ''
}

/**
 * Syntax-highlight diff content lines, aligned with `rows` (undefined entry =
 * render plain). Each hunk is rebuilt into its old-side (ctx+del) and new-side
 * (ctx+add) fragments and tokenized separately, so multi-line constructs
 * inside one hunk highlight correctly; constructs spanning a hunk gap (block
 * comments, template literals) are approximate, same as GitHub. Context rows
 * prefer the new-side tokenization.
 */
function highlightDiffRows(
  rows: DiffRow[],
  lang: string | undefined,
): (HighlightSpan[] | undefined)[] {
  const out: (HighlightSpan[] | undefined)[] = rows.map(() => undefined)
  if (lang === undefined) return out
  let index = 0
  while (index < rows.length) {
    const kind = rows[index]?.kind
    if (kind === 'hunk' || kind === 'note' || kind === undefined) {
      index += 1
      continue
    }
    const start = index
    while (index < rows.length) {
      const k = rows[index]?.kind
      if (k === 'hunk' || k === 'note' || k === undefined) break
      index += 1
    }
    const newSide: number[] = []
    const oldSide: number[] = []
    for (let i = start; i < index; i += 1) {
      const k = rows[i]?.kind
      if (k === 'ctx' || k === 'add') newSide.push(i)
      if (k === 'ctx' || k === 'del') oldSide.push(i)
    }
    const newHl = highlightLines(
      newSide.map((i) => rows[i]?.text ?? '').join('\n'),
      lang,
    )
    const oldHl = highlightLines(
      oldSide.map((i) => rows[i]?.text ?? '').join('\n'),
      lang,
    )
    newSide.forEach((rowIndex, line) => {
      out[rowIndex] = newHl?.[line]
    })
    oldSide.forEach((rowIndex, line) => {
      if (out[rowIndex] === undefined) out[rowIndex] = oldHl?.[line]
    })
  }
  return out
}
