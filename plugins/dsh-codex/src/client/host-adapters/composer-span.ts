/**
 * Detect-coordinate span math for the composer.
 *
 * The input machine publishes two projections of the same document:
 * `InputState.draft` is the CLIPBOARD text, where a reference chip is spelled
 * out as its mention (`@src/a.ts`), while the editor's internal DETECT text
 * spells the same chip as ONE object-replacement character. The
 * `slash/input-insert-*` events are span-CAS'd against the detect projection
 * (`selectSpan` rejects `end > detectLength`), so "append at the end of the
 * draft" has to collapse every chip's extra characters. Passing
 * `draft.length` verbatim stays in bounds only while the draft holds no chip
 * — which is exactly why the second "add to chat" was silently dropped.
 */

/** One chip occurrence, in clipboard-projection coordinates. */
export interface OccurrenceSpan {
  /** Length in the clipboard projection (`InputState.occurrences[].length`). */
  readonly length: number
}

/** Characters one reference chip occupies in the detect projection. */
const CHIP_DETECT_LENGTH = 1

/**
 * The end of the draft in detect coordinates.
 *
 * @param draft - clipboard projection (`InputState.draft`).
 * @param occurrences - chip occurrences in that same projection.
 */
export function detectEndOf(
  draft: string,
  occurrences: readonly OccurrenceSpan[],
): number {
  let end = draft.length
  for (const occurrence of occurrences) {
    const extra = occurrence.length - CHIP_DETECT_LENGTH
    if (extra > 0) end -= extra
  }
  return Math.max(0, end)
}
