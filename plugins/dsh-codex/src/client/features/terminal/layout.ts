/** Ignore sub-pixel layout noise when deciding whether to expose a scrollbar. */
const SCROLL_OVERFLOW_EPSILON = 1

/** Whether the terminal transcript and editor genuinely exceed the viewport. */
export function terminalDocumentNeedsScroll(
  transcriptHeight: number,
  editorHeight: number,
  viewportHeight: number,
): boolean {
  const contentHeight = Math.max(0, transcriptHeight) + Math.max(0, editorHeight)
  return contentHeight > Math.max(0, viewportHeight) + SCROLL_OVERFLOW_EPSILON
}
