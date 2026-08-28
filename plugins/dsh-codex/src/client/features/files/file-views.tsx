/**
 * Self-drawn code and diff surfaces for the files panel.
 *
 * The ui-primitives `CodeBlock`/`DiffBlock` are NOT used here: that package
 * stubs its CSS modules out of the built bundle and ships no stylesheet, so
 * in a plugin bundle those components render unstyled. These views draw with
 * the panel's own CSS (same `--dsw-*` tokens as the git-graph panel), which
 * keeps the files panel visually consistent with the rest of the sidebar.
 *
 * Performance gates mirror editor defaults:
 *  - `MAX_TOKENIZATION_LINE_LENGTH` (in highlight.ts): overlong lines skip
 *    the grammar entirely.
 *  - `STOP_RENDERING_LINE_AFTER`: DOM only paints the first N characters of
 *    a line (`editor.stopRenderingLineAfter`).
 * Rows stay in normal document flow so wrapped lines have their real height,
 * matching Codex Desktop's no-horizontal-scroll file and diff previews.
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
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import {
  Button,
  IconChevronDownOutline14,
  IconChevronUpOutline14,
  IconCloseOutline16,
  IconPlusOutline16,
} from '@just-genius/dsh-plugin-ui'
import {
  highlightLines,
  type HighlightSpan,
} from './highlight'
import { renderMarkdown } from './markdown'
import {
  collectFindMatches,
  type FindMatch,
  type FindOptions,
} from './find-model'
import type { FileReviewComment, FileReviewSide } from './review-comment'

/** Diff rows shown before a long patch collapses behind an expand row. */
const MAX_DIFF_ROWS = 240
/**
 * VS Code `editor.stopRenderingLineAfter` default. Characters past this
 * stay in the source string but are not painted.
 */
const STOP_RENDERING_LINE_AFTER = 10_000
export interface ViewLabels {
  /** Expand-row label; `{count}` is the hidden row count. */
  expand: (count: number) => string
  unmodifiedLines: (count: number) => string
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
  addComment: string
  commentPlaceholder: string
  commentCancel: string
  commentSubmit: string
  commentFailed: string
  commentAuthor: string
  commentLine: (side: FileReviewSide, line: number) => string
  commentLines: (side: FileReviewSide, start: number, end: number) => string
}

interface CommentTarget {
  startLine: number
  endLine: number
}

/** One file's contents with a line-number gutter and syntax highlighting. */
export function FileCodeView(props: {
  content: string
  /** File-extension language hint; unknown ids render plain. */
  lang?: string
  labels: ViewLabels
  /** Light/dark theme pair, so a settings change re-highlights this view. */
  themeKey?: string
  path?: string
  onAddComment?: (comment: FileReviewComment) => boolean
}) {
  const { content, lang, labels, themeKey = '' } = props
  const lines = useMemo(() => splitLines(content), [content])
  const [commentTarget, setCommentTarget] = useState<CommentTarget | null>(null)
  useEffect(() => setCommentTarget(null), [content, props.path])
  // Highlight after the first plain-text paint — sync Shiki on render blocked
  // open for 0.5–2s+. Oversized buffers skip (see highlight.ts caps); the
  // source view still renders the full file as plain text.
  const [highlighted, setHighlighted] = useState<HighlightSpan[][] | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    setHighlighted(undefined)
    const handle = window.setTimeout(() => {
      let result: HighlightSpan[][] | undefined
      try {
        result = highlightLines(content, lang)
      } catch {
        result = undefined
      }
      if (!cancelled) setHighlighted(result)
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [content, lang, themeKey])

  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findOptions, setFindOptions] = useState<FindOptions>({
    matchCase: false,
    wholeWord: false,
    regex: false,
  })
  const [activeMatch, setActiveMatch] = useState(0)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)

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

  const gutterWidth = String(lines.length).length
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const scrollToLine = useCallback((lineIndex: number): void => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    const row = scroller.querySelector<HTMLElement>(`[data-line="${lineIndex}"]`)
    if (row === null) return
    const top = row.offsetTop
    const bottom = top + row.offsetHeight
    if (top < scroller.scrollTop || bottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = Math.max(0, top - Math.floor(scroller.clientHeight / 3))
    }
  }, [])

  const goToMatch = useCallback((index: number): void => {
    if (matches.length === 0) return
    const next = ((index % matches.length) + matches.length) % matches.length
    setActiveMatch(next)
    const hit = matches[next]
    if (hit === undefined) return
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

  // Keep the active match in view when navigating.
  useLayoutEffect(() => {
    if (!findOpen || matches.length === 0) return
    const hit = matches[activeMatch]
    if (hit === undefined) return
    scrollToLine(hit.line)
  }, [findOpen, matches, activeMatch, scrollToLine])

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

  const beginComment = useCallback((line: number, event: ReactMouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    setCommentTarget((current) => {
      if (!event.shiftKey || current === null) return { startLine: line, endLine: line }
      return {
        startLine: Math.min(current.startLine, line),
        endLine: Math.max(current.endLine, line),
      }
    })
  }, [])

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
      ref={(node) => { shellRef.current = node }}
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
      <div className="dsh-files-view" ref={scrollerRef}>
        <div className="dsh-files-code">
          {lines.map((line, index) => {
            const lineNumber = index + 1
            const lineHits = matchesByLine.get(index)
            const findRanges = lineHits?.map((hit) => ({
              start: hit.start,
              end: hit.end,
              active: activeHit !== undefined
                && hit.line === activeHit.line
                && hit.start === activeHit.start
                && hit.end === activeHit.end,
            }))
            const commentSelected = commentTarget !== null
              && lineNumber >= commentTarget.startLine
              && lineNumber <= commentTarget.endLine
            return (
              <div key={index} className="dsh-files-code-entry">
                <div
                  data-line={index}
                  className={
                    'dsh-files-code-line'
                    + (activeHit?.line === index ? ' is-find-active-line' : '')
                    + (commentSelected ? ' is-comment-selected' : '')
                  }
                >
                  <span
                    className="dsh-files-code-ln"
                    style={{ width: gutterWidth + 'ch' }}
                  >
                    {lineNumber}
                    {props.onAddComment !== undefined && props.path !== undefined ? (
                      <button
                        type="button"
                        className="dsh-files-comment-add"
                        title={props.labels.addComment}
                        aria-label={`${props.labels.addComment}, ${props.labels.commentLine('file', lineNumber)}`}
                        onClick={(event) => beginComment(lineNumber, event)}
                      >
                        <IconPlusOutline16 size={12} />
                      </button>
                    ) : null}
                  </span>
                  <span className="dsh-files-code-text">
                    {renderLineText(line, highlighted?.[index], findRanges)}
                  </span>
                </div>
                {commentTarget !== null
                  && lineNumber === commentTarget.endLine
                  && props.path !== undefined
                  && props.onAddComment !== undefined ? (
                    <InlineReviewCommentEditor
                      key={`${commentTarget.startLine}:${commentTarget.endLine}`}
                      label={commentTarget.startLine === commentTarget.endLine
                        ? props.labels.commentLine('file', commentTarget.endLine)
                        : props.labels.commentLines(
                            'file',
                            commentTarget.startLine,
                            commentTarget.endLine,
                          )}
                      labels={props.labels}
                      onCancel={() => setCommentTarget(null)}
                      onSubmit={(body) => {
                        const applied = props.onAddComment?.({
                          path: props.path ?? '',
                          side: 'file',
                          startLine: commentTarget.startLine,
                          endLine: commentTarget.endLine,
                          body,
                          code: lines
                            .slice(commentTarget.startLine - 1, commentTarget.endLine)
                            .join('\n'),
                        }) === true
                        if (applied) setCommentTarget(null)
                        return applied
                      }}
                    />
                  ) : null}
              </div>
            )
          })}
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
  inputRef: MutableRefObject<HTMLInputElement | null>
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
        ref={(node) => { inputRef.current = node }}
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

type DiffRowKind = 'hunk' | 'add' | 'del' | 'ctx' | 'note'

interface DiffRow {
  kind: DiffRowKind
  /** Line number on the old side (del/ctx rows only). */
  oldLn?: number
  /** Line number on the new side (add/ctx rows only). */
  newLn?: number
  /** Unchanged source lines omitted before this hunk. */
  unmodifiedLines?: number
  text: string
}

interface DiffCommentTarget {
  startIndex: number
  endIndex: number
  side: Exclude<FileReviewSide, 'file'>
}

/** One file's unified patch with dual line-number gutters. */
export function FileDiffView(props: {
  patch: string
  /** File-extension language hint; unknown ids render plain. */
  lang?: string
  labels: ViewLabels
  /** Light/dark theme pair, so a settings change re-highlights this view. */
  themeKey?: string
  path?: string
  onAddComment?: (comment: FileReviewComment) => boolean
}) {
  const { patch, lang, labels, themeKey = '' } = props
  const rows = useMemo(() => parsePatch(patch), [patch])
  const highlighted = useMemo(() => highlightDiffRows(rows, lang), [rows, lang, themeKey])
  const [expanded, setExpanded] = useState(false)
  const [commentTarget, setCommentTarget] = useState<DiffCommentTarget | null>(null)
  useEffect(() => setCommentTarget(null), [patch, props.path])
  const capped = !expanded && rows.length > MAX_DIFF_ROWS
  const list = capped ? rows.slice(0, MAX_DIFF_ROWS) : rows
  let maxLn = 0
  for (const row of rows) {
    maxLn = Math.max(maxLn, row.oldLn ?? 0, row.newLn ?? 0)
  }
  const gutterWidth = String(Math.max(maxLn, 1)).length
  const commentInfo = commentTarget === null ? undefined : diffCommentInfo(rows, commentTarget)
  const beginComment = (rowIndex: number, side: Exclude<FileReviewSide, 'file'>, event: ReactMouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    setCommentTarget((current) => {
      if (!event.shiftKey || current === null || current.side !== side) {
        return { startIndex: rowIndex, endIndex: rowIndex, side }
      }
      return {
        startIndex: Math.min(current.startIndex, rowIndex),
        endIndex: Math.max(current.endIndex, rowIndex),
        side,
      }
    })
  }
  return (
    <div className="dsh-files-view">
      <div className="dsh-files-diff-body">
        {list.map((row, index) => {
          const commentSide = commentSideForRow(row)
          const lineNumber = unifiedLineNumber(row)
          const commentSelected = commentTarget !== null
            && index >= commentTarget.startIndex
            && index <= commentTarget.endIndex
            && rowLineForSide(row, commentTarget.side) !== undefined
          return (
            <div key={index} className="dsh-files-diff-entry">
              <div
                className={
                  'dsh-files-diff-row is-' + row.kind
                  + (commentSelected ? ' is-comment-selected' : '')
                }
                role={row.kind === 'hunk' ? 'separator' : undefined}
                aria-label={row.kind === 'hunk' ? row.text : undefined}
                title={row.kind === 'hunk' ? row.text : undefined}
              >
                {/* Codex/Pierre unified view: indicator left, one active-side line number. */}
                <span className="dsh-files-diff-gutter">
                  <span className="dsh-files-diff-mark" aria-hidden />
                  <span
                    className="dsh-files-diff-ln"
                    style={{ width: gutterWidth + 'ch' }}
                  >
                    {lineNumber ?? ''}
                    {commentSide !== undefined
                      && props.path !== undefined
                      && props.onAddComment !== undefined ? (
                      <button
                        type="button"
                        className="dsh-files-comment-add"
                        title={labels.addComment}
                        aria-label={`${labels.addComment}, ${labels.commentLine(
                          commentSide,
                          rowLineForSide(row, commentSide) ?? 0,
                        )}`}
                        onClick={(event) => beginComment(index, commentSide, event)}
                      >
                        <IconPlusOutline16 size={12} />
                      </button>
                      ) : null}
                  </span>
                </span>
                <span className="dsh-files-diff-text">
                  {row.kind === 'hunk' && row.unmodifiedLines !== undefined
                    ? labels.unmodifiedLines(row.unmodifiedLines)
                    : renderLineText(row.text, highlighted[index])}
                </span>
              </div>
              {commentTarget !== null
                && index === commentTarget.endIndex
                && commentInfo !== undefined
                && props.path !== undefined
                && props.onAddComment !== undefined ? (
                  <InlineReviewCommentEditor
                    key={`${commentTarget.side}:${commentTarget.startIndex}:${commentTarget.endIndex}`}
                    label={commentInfo.startLine === commentInfo.endLine
                      ? labels.commentLine(commentTarget.side, commentInfo.endLine)
                      : labels.commentLines(
                          commentTarget.side,
                          commentInfo.startLine,
                          commentInfo.endLine,
                        )}
                    labels={labels}
                    onCancel={() => setCommentTarget(null)}
                    onSubmit={(body) => {
                      const applied = props.onAddComment?.({
                        path: props.path ?? '',
                        side: commentTarget.side,
                        startLine: commentInfo.startLine,
                        endLine: commentInfo.endLine,
                        body,
                        code: commentInfo.code,
                      }) === true
                      if (applied) setCommentTarget(null)
                      return applied
                    }}
                  />
                ) : null}
            </div>
          )
        })}
        {capped ? (
          <div className="dsh-files-expand-slot">
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

function commentSideForRow(row: DiffRow): Exclude<FileReviewSide, 'file'> | undefined {
  if (row.kind === 'del') return 'old'
  if (row.kind === 'add' || row.kind === 'ctx') return 'new'
  return undefined
}

/** Unified Codex view shows the line number for the side this row belongs to. */
function unifiedLineNumber(row: DiffRow): number | undefined {
  return row.kind === 'del' ? row.oldLn : row.newLn ?? row.oldLn
}

function rowLineForSide(
  row: DiffRow,
  side: Exclude<FileReviewSide, 'file'>,
): number | undefined {
  return side === 'old' ? row.oldLn : row.newLn
}

function diffCommentInfo(
  rows: readonly DiffRow[],
  target: DiffCommentTarget,
): { startLine: number; endLine: number; code: string } | undefined {
  const selected: Array<{ line: number; text: string }> = []
  for (let index = target.startIndex; index <= target.endIndex; index += 1) {
    const row = rows[index]
    if (row === undefined) continue
    const line = rowLineForSide(row, target.side)
    if (line !== undefined) selected.push({ line, text: row.text })
  }
  if (selected.length === 0) return undefined
  return {
    startLine: selected[0]?.line ?? 0,
    endLine: selected[selected.length - 1]?.line ?? 0,
    code: selected.map(item => item.text).join('\n'),
  }
}

/** Codex-style inline review composer rendered as a diff/file annotation. */
function InlineReviewCommentEditor(props: {
  label: string
  labels: ViewLabels
  onCancel: () => void
  onSubmit: (body: string) => boolean
}) {
  const [body, setBody] = useState('')
  const [failed, setFailed] = useState(false)
  const submit = (): void => {
    const value = body.trim()
    if (value.length === 0) return
    const applied = props.onSubmit(value)
    setFailed(!applied)
  }
  return (
    <div className="dsh-files-comment-annotation">
      <div className="dsh-files-comment-surface">
        <div className="dsh-files-comment-header">
          <span className="dsh-files-comment-author">{props.labels.commentAuthor}</span>
          <span className="dsh-files-comment-location">{props.label}</span>
        </div>
        <textarea
          autoFocus
          className="dsh-files-comment-input"
          value={body}
          placeholder={props.labels.commentPlaceholder}
          aria-label={props.labels.commentPlaceholder}
          rows={3}
          onChange={(event) => {
            setBody(event.currentTarget.value)
            setFailed(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              props.onCancel()
              return
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              submit()
            }
          }}
        />
        {failed ? (
          <div className="dsh-files-comment-error" role="alert">
            {props.labels.commentFailed}
          </div>
        ) : null}
        <div className="dsh-files-comment-actions">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={props.onCancel}
          >
            {props.labels.commentCancel}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="primary"
            disabled={body.trim().length === 0}
            onClick={submit}
          >
            {props.labels.commentSubmit}
          </Button>
        </div>
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
export function FileMarkdownView(props: { content: string; themeKey?: string }) {
  const html = useMemo(
    () => renderMarkdown(props.content),
    [props.content, props.themeKey ?? ''],
  )
  return (
    <div
      className="dsh-files-md-body"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
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
      <span className="dsh-files-expand-control" aria-hidden>
        <IconChevronDownOutline14 size={14} />
      </span>
      <span className="dsh-files-expand-label">
        {props.labels.expand(props.count)}
      </span>
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
  let seenHunk = false
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (match !== null) {
        const nextOldLn = Number.parseInt(match[1] ?? '0', 10)
        const nextNewLn = Number.parseInt(match[2] ?? '0', 10)
        const oldGap = seenHunk ? nextOldLn - oldLn : nextOldLn - 1
        const newGap = seenHunk ? nextNewLn - newLn : nextNewLn - 1
        const unmodifiedLines = Math.max(0, Math.min(oldGap, newGap))
        if (unmodifiedLines > 0) {
          rows.push({ kind: 'hunk', text: line, unmodifiedLines })
        }
        oldLn = nextOldLn
        newLn = nextNewLn
        seenHunk = true
        continue
      }
      rows.push({ kind: 'hunk', text: line, unmodifiedLines: 0 })
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
