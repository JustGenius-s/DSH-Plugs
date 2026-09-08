/**
 * One file's contents with a line-number gutter and syntax highlighting.
 *
 * Highlighting runs after the first plain-text paint: sync Shiki on render
 * blocked open for 0.5–2s+. Oversized buffers skip (see highlight.ts caps);
 * the source view still renders the full file as plain text.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { IconPlusOutline16 } from '@just-genius/dsh-plugin-ui'
import { highlightLines, type HighlightSpan } from './highlight'
import { collectFindMatches, type FindMatch, type FindOptions } from './find-model'
import { FindBar } from './find-bar'
import { InlineReviewCommentEditor } from './review-comment-editor'
import { gutterWidthOf, renderLineText, splitLines, type FindRange } from './code-text'
import type { ViewLabels } from './view-labels'
import type { FileReviewComment } from './review-comment'
import { columnAtPoint, measureCaretBox } from './caret-dom'
import type { CaretBox } from './caret-position'

interface CommentTarget {
  startLine: number
  endLine: number
}

/** A clicked caret: 1-based line plus a column in that line's plain text. */
interface CaretTarget {
  line: number
  column: number
}

/**
 * Scroll `lineIndex` into view only when it is outside the viewport, offset a
 * third of the height down so the target is not glued to the top edge.
 */
function useScrollToLine(scrollerRef: React.RefObject<HTMLDivElement | null>) {
  return useCallback((lineIndex: number): void => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    const row = scroller.querySelector<HTMLElement>(`[data-line="${lineIndex}"]`)
    if (row === null) return
    const top = row.offsetTop
    const bottom = top + row.offsetHeight
    if (top < scroller.scrollTop || bottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = Math.max(0, top - Math.floor(scroller.clientHeight / 3))
    }
  }, [scrollerRef])
}

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
  // The caret is a marker, not a browser cursor: the clicked column is
  // re-measured against the DOM after every layout change, so it survives a
  // re-highlight and a rewrap.
  const [caret, setCaret] = useState<CaretTarget | null>(null)
  const [caretBox, setCaretBox] = useState<CaretBox | undefined>(undefined)
  const [layoutTick, setLayoutTick] = useState(0)
  useEffect(() => {
    setCommentTarget(null)
    setCaret(null)
  }, [content, props.path])

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

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const scrollToLine = useScrollToLine(scrollerRef)

  // Re-measure the caret whenever something that can move it changes: the
  // async highlight rewrites the line's spans, and a width change rewraps the
  // line. A ResizeObserver on the scrollport covers the panel splitter too,
  // which never fires a window resize.
  useEffect(() => {
    if (caret === null) return
    const scroller = scrollerRef.current
    if (scroller === null) return
    const observer = new ResizeObserver(() => setLayoutTick((tick) => tick + 1))
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [caret])

  useLayoutEffect(() => {
    if (caret === null) {
      setCaretBox(undefined)
      return
    }
    const row = scrollerRef.current?.querySelector<HTMLElement>(`[data-line="${caret.line - 1}"]`)
    const span = row?.querySelector<HTMLElement>('.dsh-files-code-text') ?? null
    setCaretBox(span === null ? undefined : measureCaretBox(span, caret.column))
  }, [caret, highlighted, themeKey, content, props.path, layoutTick])

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

  /** A click drops the read-only caret where it landed. */
  const placeCaret = useCallback((index: number, event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement
    if (target.closest('button, input, textarea') !== null) return
    // A drag that selected text is not a click-to-place: keep the selection.
    const selection = window.getSelection()
    if (selection !== null && !selection.isCollapsed) return
    const line = lines[index] ?? ''
    const span = event.currentTarget.querySelector<HTMLElement>('.dsh-files-code-text')
    const inGutter = target.closest('.dsh-files-code-ln') !== null
    const column = span === null || inGutter
      ? 0
      : columnAtPoint(span, event.clientX, event.clientY, line.length)
    setCaret({ line: index + 1, column })
  }, [lines])

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

  const gutterWidth = gutterWidthOf(lines.length)

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
            const findRanges: FindRange[] | undefined = lineHits?.map((hit) => ({
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
                    + (caret?.line === lineNumber ? ' is-caret-line' : '')
                  }
                  onClick={(event) => placeCaret(index, event)}
                >
                  <span
                    className="dsh-files-code-ln"
                    style={{ width: gutterWidth }}
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
                    {caret !== null && caret.line === lineNumber && caretBox !== undefined ? (
                      <span
                        className="dsh-files-caret"
                        aria-hidden
                        style={{ left: caretBox.left, top: caretBox.top, height: caretBox.height }}
                      />
                    ) : null}
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
