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
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  type UIEvent,
} from 'react'
import {
  IconChevronDownOutline14,
  IconChevronUpOutline14,
  IconCloseOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
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
  findPlaceholder: string
  findNoResults: string
  findInvalidRegex: string
  /** `{current}` / `{total}` — 1-based current index. */
  findMatchCount: (current: number, total: number) => string
  findPrev: string
  findNext: string
  findClose: string
  findMatchCase: string
  findWholeWord: string
  findRegex: string
}

/** VS Code find-widget toggles (Match Case / Whole Word / Regex). */
interface FindOptions {
  matchCase: boolean
  wholeWord: boolean
  regex: boolean
}

interface FindMatch {
  line: number
  start: number
  end: number
}

interface FindResult {
  matches: FindMatch[]
  /** True when regex mode is on and the pattern failed to compile. */
  invalidRegex: boolean
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
  // Expanding past the preview cap re-tokenizes the full buffer; keep the
  // already-painted prefix colored until that finishes (don't flash plain).
  const [highlighted, setHighlighted] = useState<HighlightSpan[][] | undefined>(undefined)
  useEffect(() => {
    setHighlighted(undefined)
  }, [content, lang])
  useEffect(() => {
    let cancelled = false
    const slice = list.join('\n')
    const handle = window.setTimeout(() => {
      let result: HighlightSpan[][] | undefined
      try {
        result = highlightLines(slice, lang)
      } catch {
        result = undefined
      }
      if (cancelled) return
      // Expand past the skip-cap: keep the already-painted prefix colored
      // instead of flashing the whole file back to plain text.
      setHighlighted((prev) => {
        if (result !== undefined) return result
        if (prev !== undefined && prev.length > 0) return prev
        return undefined
      })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [lang, list])

  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findOptions, setFindOptions] = useState<FindOptions>({
    matchCase: false,
    wholeWord: false,
    regex: false,
  })
  const [activeMatch, setActiveMatch] = useState(0)
  const findInputRef = useRef<HTMLInputElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)

  const findResult = useMemo(
    () => collectFindMatches(lines, findQuery, findOptions),
    [lines, findQuery, findOptions],
  )
  const matches = findResult.matches
  // Clamp active index when the query/file changes.
  useEffect(() => {
    setActiveMatch((current) => {
      if (matches.length === 0) return 0
      return Math.min(current, matches.length - 1)
    })
  }, [matches])

  // A match past the preview cap needs the full buffer painted.
  useEffect(() => {
    if (!findOpen || matches.length === 0) return
    const hit = matches[activeMatch]
    if (hit !== undefined && hit.line >= MAX_PREVIEW_LINES) {
      setExpanded(true)
    }
  }, [findOpen, matches, activeMatch])

  const gutterWidth = String(lines.length).length
  const {
    start, end, onScroll, totalHeight, offsetY, scrollerRef, scrollToLine,
  } = useVirtualWindow(list.length)

  const goToMatch = useCallback((index: number): void => {
    if (matches.length === 0) return
    const next = ((index % matches.length) + matches.length) % matches.length
    setActiveMatch(next)
    const hit = matches[next]
    if (hit === undefined) return
    if (hit.line >= MAX_PREVIEW_LINES) setExpanded(true)
    // Defer scroll until expand/list settle when needed.
    requestAnimationFrame(() => scrollToLine(hit.line))
  }, [matches, scrollToLine])

  const openFind = useCallback((): void => {
    setFindOpen(true)
    requestAnimationFrame(() => {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }, [])

  const closeFind = useCallback((): void => {
    setFindOpen(false)
    shellRef.current?.focus({ preventScroll: true })
  }, [])

  // Preview takes keyboard focus on mount / click so Cmd/Ctrl+F works like
  // VS Code's editor (find is scoped to the focused surface).
  useEffect(() => {
    shellRef.current?.focus({ preventScroll: true })
  }, [content])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const shell = shellRef.current
      if (shell === null) return
      const target = event.target as Node | null
      const focusedInside = target !== null && shell.contains(target)
      const shellFocused = document.activeElement === shell
      if (!focusedInside && !shellFocused) return
      const key = event.key.toLowerCase()
      if ((event.metaKey || event.ctrlKey) && key === 'f' && !event.altKey) {
        event.preventDefault()
        event.stopPropagation()
        openFind()
        return
      }
      if (!findOpen) return
      if (key === 'escape') {
        event.preventDefault()
        closeFind()
        return
      }
      // VS Code find-widget option shortcuts (Alt+C / Alt+W / Alt+R).
      if (event.altKey && !event.metaKey && !event.ctrlKey) {
        if (key === 'c') {
          event.preventDefault()
          setFindOptions((current) => ({ ...current, matchCase: !current.matchCase }))
          return
        }
        if (key === 'w') {
          event.preventDefault()
          setFindOptions((current) => ({ ...current, wholeWord: !current.wholeWord }))
          return
        }
        if (key === 'r') {
          event.preventDefault()
          setFindOptions((current) => ({ ...current, regex: !current.regex }))
          return
        }
      }
      if (key === 'f3' || ((event.metaKey || event.ctrlKey) && key === 'g')) {
        event.preventDefault()
        goToMatch(event.shiftKey ? activeMatch - 1 : activeMatch + 1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [findOpen, openFind, closeFind, goToMatch, activeMatch])

  // Keep the active match in view after expand / list length changes.
  useLayoutEffect(() => {
    if (!findOpen || matches.length === 0) return
    const hit = matches[activeMatch]
    if (hit === undefined) return
    if (hit.line < list.length) scrollToLine(hit.line)
  }, [findOpen, matches, activeMatch, list.length, scrollToLine])

  const matchesByLine = useMemo(() => {
    const map = new Map<number, FindMatch[]>()
    if (!findOpen || findQuery.length === 0) return map
    for (let i = 0; i < matches.length; i += 1) {
      const hit = matches[i]
      if (hit === undefined) continue
      const bucket = map.get(hit.line)
      if (bucket === undefined) map.set(hit.line, [hit])
      else bucket.push(hit)
    }
    return map
  }, [findOpen, findQuery, matches])

  const activeHit = matches[activeMatch]

  const onFindInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      goToMatch(event.shiftKey ? activeMatch - 1 : activeMatch + 1)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeFind()
    }
  }

  return (
    <div
      className="dsh-files-code-shell"
      ref={shellRef}
      tabIndex={-1}
      onMouseDown={(event) => {
        const tag = (event.target as HTMLElement).tagName
        if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA') return
        shellRef.current?.focus({ preventScroll: true })
      }}
    >
      {findOpen ? (
        <FindBar
          labels={labels}
          query={findQuery}
          options={findOptions}
          matchCount={matches.length}
          activeIndex={activeMatch}
          invalidRegex={findResult.invalidRegex}
          inputRef={findInputRef}
          onQueryChange={(value) => {
            setFindQuery(value)
            setActiveMatch(0)
          }}
          onOptionsChange={(patch) => {
            setFindOptions((current) => ({ ...current, ...patch }))
            setActiveMatch(0)
          }}
          onPrev={() => goToMatch(activeMatch - 1)}
          onNext={() => goToMatch(activeMatch + 1)}
          onClose={closeFind}
          onKeyDown={onFindInputKeyDown}
        />
      ) : null}
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
              const lineHits = matchesByLine.get(index)
              const findRanges = lineHits?.map((hit) => ({
                start: hit.start,
                end: hit.end,
                active: activeHit !== undefined
                  && hit.line === activeHit.line
                  && hit.start === activeHit.start
                  && hit.end === activeHit.end,
              }))
              return (
                <div
                  key={index}
                  className={
                    'dsh-files-code-line'
                    + (activeHit?.line === index ? ' is-find-active-line' : '')
                  }
                >
                  <span
                    className="dsh-files-code-ln"
                    style={{ width: gutterWidth + 'ch' }}
                  >
                    {index + 1}
                  </span>
                  <span className="dsh-files-code-text">
                    {renderLineText(line, highlighted?.[index], findRanges)}
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
    </div>
  )
}

function FindBar(props: {
  labels: ViewLabels
  query: string
  options: FindOptions
  matchCount: number
  activeIndex: number
  invalidRegex: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onQueryChange: (value: string) => void
  onOptionsChange: (patch: Partial<FindOptions>) => void
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void
}) {
  const {
    labels, query, options, matchCount, activeIndex, invalidRegex, inputRef,
    onQueryChange, onOptionsChange, onPrev, onNext, onClose, onKeyDown,
  } = props
  const countLabel = query.length === 0
    ? ''
    : invalidRegex
      ? labels.findInvalidRegex
      : matchCount === 0
        ? labels.findNoResults
        : labels.findMatchCount(activeIndex + 1, matchCount)
  return (
    <div className="dsh-files-find" role="search">
      <input
        ref={inputRef}
        className={
          'dsh-files-find-input'
          + (invalidRegex && query.length > 0 ? ' is-invalid' : '')
        }
        type="search"
        value={query}
        placeholder={labels.findPlaceholder}
        aria-label={labels.findPlaceholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <div className="dsh-files-find-toggles" role="group">
        <button
          type="button"
          className={
            'dsh-files-find-toggle'
            + (options.matchCase ? ' is-active' : '')
          }
          title={labels.findMatchCase}
          aria-label={labels.findMatchCase}
          aria-pressed={options.matchCase}
          onClick={() => onOptionsChange({ matchCase: !options.matchCase })}
        >
          Aa
        </button>
        <button
          type="button"
          className={
            'dsh-files-find-toggle'
            + (options.wholeWord ? ' is-active' : '')
          }
          title={labels.findWholeWord}
          aria-label={labels.findWholeWord}
          aria-pressed={options.wholeWord}
          onClick={() => onOptionsChange({ wholeWord: !options.wholeWord })}
        >
          <span className="dsh-files-find-whole" aria-hidden>
            <span className="dsh-files-find-whole-bar" />
            ab
            <span className="dsh-files-find-whole-bar" />
          </span>
        </button>
        <button
          type="button"
          className={
            'dsh-files-find-toggle'
            + (options.regex ? ' is-active' : '')
          }
          title={labels.findRegex}
          aria-label={labels.findRegex}
          aria-pressed={options.regex}
          onClick={() => onOptionsChange({ regex: !options.regex })}
        >
          .*
        </button>
      </div>
      <span
        className={
          'dsh-files-find-count'
          + (invalidRegex && query.length > 0 ? ' is-invalid' : '')
        }
        aria-live="polite"
      >
        {countLabel}
      </span>
      <button
        type="button"
        className="dsh-files-find-btn"
        title={labels.findPrev}
        aria-label={labels.findPrev}
        disabled={matchCount === 0}
        onClick={onPrev}
      >
        <IconChevronUpOutline14 size={14} />
      </button>
      <button
        type="button"
        className="dsh-files-find-btn"
        title={labels.findNext}
        aria-label={labels.findNext}
        disabled={matchCount === 0}
        onClick={onNext}
      >
        <IconChevronDownOutline14 size={14} />
      </button>
      <button
        type="button"
        className="dsh-files-find-btn"
        title={labels.findClose}
        aria-label={labels.findClose}
        onClick={onClose}
      >
        <IconCloseOutline16 size={14} />
      </button>
    </div>
  )
}

/**
 * Collect find matches for the preview buffer — same option set as VS Code's
 * find widget: Match Case, Match Whole Word, Use Regular Expression.
 */
function collectFindMatches(
  lines: readonly string[],
  query: string,
  options: FindOptions,
): FindResult {
  if (query.length === 0) return { matches: [], invalidRegex: false }

  let pattern: RegExp
  try {
    pattern = buildFindPattern(query, options)
  } catch {
    return { matches: [], invalidRegex: true }
  }

  const out: FindMatch[] = []
  for (let line = 0; line < lines.length; line += 1) {
    const hay = lines[line] ?? ''
    if (hay.length === 0 && !options.regex) continue
    pattern.lastIndex = 0
    let match = pattern.exec(hay)
    while (match !== null) {
      const text = match[0] ?? ''
      // Zero-width matches (e.g. `a*`) would loop forever — advance one char.
      if (text.length === 0) {
        if (pattern.lastIndex >= hay.length) break
        pattern.lastIndex += 1
        match = pattern.exec(hay)
        continue
      }
      out.push({ line, start: match.index, end: match.index + text.length })
      if (!pattern.global) break
      match = pattern.exec(hay)
    }
  }
  return { matches: out, invalidRegex: false }
}

/** Compile the find query into a sticky global RegExp for one line at a time. */
function buildFindPattern(query: string, options: FindOptions): RegExp {
  const flags = options.matchCase ? 'g' : 'gi'
  let source: string
  if (options.regex) {
    source = query
  } else {
    source = escapeRegExp(query)
  }
  if (options.wholeWord) {
    // Word-ish boundaries on both sides (letters/digits/underscore), same idea
    // as VS Code's "Match Whole Word" for typical code identifiers.
    source = `(?<![\\w])(?:${source})(?![\\w])`
  }
  return new RegExp(source, flags)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
  scrollToLine: (lineIndex: number) => void
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

  const scrollToLine = useCallback((lineIndex: number): void => {
    const el = scrollerRef.current
    if (el === null) return
    const top = Math.max(0, lineIndex) * ROW_HEIGHT
    const viewTop = el.scrollTop
    const viewBottom = viewTop + el.clientHeight
    const rowBottom = top + ROW_HEIGHT
    if (top < viewTop || rowBottom > viewBottom) {
      el.scrollTop = Math.max(0, top - Math.floor(el.clientHeight / 3))
      syncWindow(el.scrollTop, el.clientHeight)
    }
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
    scrollToLine,
  }
}

interface FindRange {
  start: number
  end: number
  active: boolean
}

/**
 * Paint one line's text, truncating past `STOP_RENDERING_LINE_AFTER` and
 * falling back to plain text when highlight spans are missing or empty
 * (overlong lines skipped by the tokenizer). Optional `findRanges` wraps
 * matching substrings in mark classes (VS Code find decorations).
 */
function renderLineText(
  line: string,
  spans: readonly HighlightSpan[] | undefined,
  findRanges?: readonly FindRange[],
): ReactNode {
  if (line.length === 0) return ' '
  const cut = line.length > STOP_RENDERING_LINE_AFTER
  const text = cut ? line.slice(0, STOP_RENDERING_LINE_AFTER) : line
  const hasFind = findRanges !== undefined && findRanges.length > 0
  if (!hasFind) {
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
  const baseSpans: HighlightSpan[] =
    spans === undefined || spans.length === 0
      ? [{ text, style: {} }]
      : clipSpans(spans, STOP_RENDERING_LINE_AFTER)
  const pieces = splitSpansWithFind(baseSpans, findRanges, text.length)
  return (
    <>
      {pieces.map((piece, spanIndex) => (
        <span
          key={spanIndex}
          className={
            piece.find === 'active'
              ? 'dsh-files-find-active'
              : piece.find === 'hit'
                ? 'dsh-files-find-hit'
                : undefined
          }
          style={piece.style as CSSProperties}
        >
          {piece.text}
        </span>
      ))}
      {cut ? '…' : null}
    </>
  )
}

/**
 * Walk syntax spans and overlay find ranges as nested mark segments without
 * losing token colors. Ranges outside `maxLen` (already clipped) are ignored.
 */
function splitSpansWithFind(
  spans: readonly HighlightSpan[],
  ranges: readonly FindRange[],
  maxLen: number,
): Array<{ text: string; style: CSSProperties; find?: 'hit' | 'active' }> {
  if (ranges.length === 0) {
    return spans.map((span) => ({ text: span.text, style: span.style }))
  }
  const sorted = [...ranges]
    .filter((range) => range.end > 0 && range.start < maxLen)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const out: Array<{ text: string; style: CSSProperties; find?: 'hit' | 'active' }> = []
  let cursor = 0
  for (const span of spans) {
    const spanStart = cursor
    const spanEnd = cursor + span.text.length
    cursor = spanEnd
    let local = 0
    while (local < span.text.length) {
      const abs = spanStart + local
      let nextBoundary = spanEnd
      let mark: 'hit' | 'active' | undefined
      for (const range of sorted) {
        const start = Math.max(0, range.start)
        const end = Math.min(maxLen, range.end)
        if (end <= abs || start >= spanEnd) continue
        if (start > abs && start < nextBoundary) nextBoundary = start
        if (start <= abs && end > abs) {
          mark = range.active ? 'active' : 'hit'
          if (end < nextBoundary) nextBoundary = end
          break
        }
      }
      const take = Math.max(1, nextBoundary - abs)
      out.push({
        text: span.text.slice(local, local + take),
        style: span.style,
        find: mark,
      })
      local += take
    }
  }
  return out
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
