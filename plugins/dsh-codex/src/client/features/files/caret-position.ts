/**
 * Geometry for the preview's read-only caret.
 *
 * The code surface is not editable, so the caret is a marker rather than a
 * browser text cursor: a click resolves to a column in the line's plain text,
 * and every render re-measures that column against the DOM. Keeping the
 * arithmetic here — and the DOM access in `caret-dom.ts` — is what makes the
 * clamping rules testable: an empty line, a click past the end of the text and
 * a column left over after a re-highlight all have to land somewhere sane.
 */

/** A `DOMRect`'s fields, narrowed to what caret placement reads. */
export interface RectLike {
  left: number
  top: number
  width: number
  height: number
}

/** Caret offset inside the line's text box, in CSS pixels. */
export interface CaretBox {
  left: number
  top: number
  height: number
}

/** Caret height used when the measured range reports none. */
export const MIN_CARET_HEIGHT = 16

/**
 * Clamp a click-derived column to the line.
 *
 * Columns come from DOM hit-testing, so they can exceed the source line (the
 * renderer appends an ellipsis past `stopRenderingLineAfter`, and an empty
 * line paints a placeholder space) or arrive as `NaN` from a detached node.
 */
export function clampColumn(column: number, length: number): number {
  if (!Number.isFinite(column)) return 0
  const limit = Math.max(0, length)
  return Math.max(0, Math.min(Math.floor(column), limit))
}

/**
 * The text node and offset holding `column`.
 *
 * @param lengths - text-node lengths in document order (a highlighted line is
 *   many nodes, a plain one is a single node).
 * @returns `undefined` when the line paints no text at all, otherwise a
 *   position clamped to the last node — a column past the end parks the caret
 *   at the end of the line rather than dropping it.
 */
export function positionOfColumn(
  lengths: readonly number[],
  column: number,
): { index: number; offset: number } | undefined {
  if (lengths.length === 0) return undefined
  let remaining = Math.max(0, Math.floor(column))
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index] ?? 0
    if (remaining <= length) return { index, offset: remaining }
    remaining -= length
  }
  const last = lengths.length - 1
  return { index: last, offset: lengths[last] ?? 0 }
}

/**
 * The caret's box relative to the line's text box.
 *
 * A collapsed range measures zero-width but keeps the line's height, and on a
 * wrapped line its top puts the caret on the visual row it belongs to. When a
 * browser reports no height at all, `MIN_CARET_HEIGHT` keeps the caret
 * visible instead of painting a zero-pixel sliver.
 */
export function caretBoxInLine(caret: RectLike, line: RectLike): CaretBox {
  return {
    left: Math.max(0, caret.left - line.left),
    top: Math.max(0, caret.top - line.top),
    height: caret.height > 0 ? caret.height : MIN_CARET_HEIGHT,
  }
}
