/**
 * Line-painting helpers shared by the code and diff views.
 *
 * Syntax spans arrive as flat `{ text, style }` runs; find matches overlay
 * them as marks without losing token colors. Both views truncate past
 * `STOP_RENDERING_LINE_AFTER` (VS Code's `editor.stopRenderingLineAfter`), so
 * the clipping rules live here rather than being duplicated per view.
 */
import type { CSSProperties, ReactNode } from 'react'
import type { HighlightSpan } from './highlight'

/**
 * VS Code `editor.stopRenderingLineAfter` default. Characters past this
 * stay in the source string but are not painted.
 */
export const STOP_RENDERING_LINE_AFTER = 10_000

export interface FindRange {
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
export function renderLineText(
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
export function splitSpansWithFind(
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
export function clipSpans(
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

/** Split file content into render lines (a trailing newline is not a line). */
export function splitLines(content: string): string[] {
  const body = content.endsWith('\n') ? content.slice(0, -1) : content
  return body.length === 0 ? [] : body.split('\n')
}

/** Gutter width in `ch` for the widest line number in the view. */
export function gutterWidthOf(maxLineNumber: number): string {
  return String(Math.max(maxLineNumber, 1)).length + 'ch'
}
