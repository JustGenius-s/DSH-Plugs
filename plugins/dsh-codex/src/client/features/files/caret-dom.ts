/**
 * The DOM half of the preview's read-only caret: resolving a click to a plain
 * text column, and a column back to a box to paint.
 *
 * All arithmetic lives in `caret-position.ts`; this module only touches the
 * document. Columns are expressed in the line's plain text — not in text-node
 * offsets — so a caret survives the async re-highlight that replaces every
 * span under it.
 */
import {
  caretBoxInLine,
  clampColumn,
  positionOfColumn,
  type CaretBox,
} from './caret-position'

/** `caretRangeFromPoint` is WebKit-only and absent from the DOM typings. */
type CaretPointDocument = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}

/** Text nodes of a line's text span, in document order. */
function textNodesOf(span: Element): Text[] {
  const walker = span.ownerDocument.createTreeWalker(span, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    nodes.push(node as Text)
  }
  return nodes
}

/** Where the browser says a pointer at (x, y) would put a text caret. */
function caretPointAt(span: HTMLElement, x: number, y: number): { node: Node; offset: number } | undefined {
  const doc = span.ownerDocument
  const position = doc.caretPositionFromPoint(x, y)
  if (position !== null) return { node: position.offsetNode, offset: position.offset }
  const range = (doc as CaretPointDocument).caretRangeFromPoint?.(x, y)
  if (range === undefined || range === null) return undefined
  return { node: range.startContainer, offset: range.startOffset }
}

/**
 * The plain-text column a click at (x, y) lands on inside `span`.
 *
 * Measuring the text between the line's start and the hit-tested position
 * (rather than counting nodes by hand) is what makes the result independent of
 * how the line happens to be split into spans.
 *
 * @param length - the source line's length; the result is clamped to it, since
 *   the painted text can differ (truncation, empty-line placeholder).
 */
export function columnAtPoint(
  span: HTMLElement,
  x: number,
  y: number,
  length: number,
): number {
  const point = caretPointAt(span, x, y)
  if (point === undefined || !span.contains(point.node)) {
    // Clicked in the blank tail of a short line, or on the gutter beside it:
    // the nearest end of the line is the honest caret position.
    const rect = span.getBoundingClientRect()
    return x >= rect.right ? clampColumn(length, length) : 0
  }
  const range = span.ownerDocument.createRange()
  range.selectNodeContents(span)
  range.setEnd(point.node, point.offset)
  return clampColumn(range.toString().length, length)
}

/**
 * Where to paint the caret for `column`, relative to the line's text box.
 *
 * @returns `undefined` when the line paints no text to attach the caret to.
 */
export function measureCaretBox(span: HTMLElement, column: number): CaretBox | undefined {
  const nodes = textNodesOf(span)
  const at = positionOfColumn(nodes.map((node) => node.data.length), column)
  if (at === undefined) return undefined
  const node = nodes[at.index]
  if (node === undefined) return undefined
  const range = span.ownerDocument.createRange()
  const offset = Math.min(at.offset, node.data.length)
  range.setStart(node, offset)
  range.setEnd(node, offset)
  return caretBoxInLine(range.getBoundingClientRect(), span.getBoundingClientRect())
}
