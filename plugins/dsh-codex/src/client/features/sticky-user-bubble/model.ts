/** Transcript bottom that is not covered by the sticky composer card. */
function visibleBottom(scrollport: HTMLElement, portBottom: number): number {
  const seat = scrollport.querySelector('[data-composer-seat]')
  if (!(seat instanceof HTMLElement)) return portBottom
  const top = seat.getBoundingClientRect().top
  return top > 0 ? Math.min(portBottom, top) : portBottom
}

/**
 * User prompt that owns the transcript top.
 *
 * Pins the last user row that has fully left the top. If any later user
 * prompt is still visible in the transcript (not under the composer), that
 * is the current question — do not keep the previous turn pinned.
 */
export function pinnedUserKey(
  scrollport: HTMLElement,
  keys: readonly string[],
  port: DOMRectReadOnly,
): string | null {
  const floor = visibleBottom(scrollport, port.bottom)
  let lastFullyAbove: string | null = null
  for (const key of keys) {
    const row = userRowOf(scrollport, key)
    if (row === null) continue
    const rect = row.getBoundingClientRect()
    if (rect.bottom <= port.top + 1) {
      lastFullyAbove = key
      continue
    }
    if (rect.top < floor) return null
  }
  return lastFullyAbove
}

export function userRowOf(root: ParentNode, key: string): HTMLElement | null {
  for (const row of root.querySelectorAll('[data-chat-anchor-key]')) {
    if (row instanceof HTMLElement && row.dataset.chatAnchorKey === key) return row
  }
  return null
}

/** Image count on a user prompt (gallery blocks sit above the text bubble). */
export function promptImageCount(data: unknown): number {
  if (data === null || typeof data !== 'object') return 0
  const content = (data as { content?: unknown }).content
  if (!Array.isArray(content)) return 0
  let count = 0
  for (const block of content) {
    if (block !== null && typeof block === 'object' && (block as { type?: unknown }).type === 'image') {
      count += 1
    }
  }
  return count
}

/** Already-resolved thumbnail URLs from the live transcript row. */
export function promptImageSrcs(row: HTMLElement | null): string[] {
  if (row === null) return []
  const srcs: string[] = []
  const seen = new Set<string>()
  for (const img of row.querySelectorAll('img')) {
    if (!(img instanceof HTMLImageElement)) continue
    const src = img.currentSrc || img.src
    if (src === '' || seen.has(src)) continue
    seen.add(src)
    srcs.push(src)
  }
  return srcs
}

/** Full user-prompt text from a chat node or history event payload. */
export function promptTextOf(data: unknown, empty: string): string {
  if (data && typeof data === 'object') {
    const content = (data as { content?: unknown }).content
    if (Array.isArray(content)) {
      const text = content
        .filter((block: unknown) => (
          block !== null
          && typeof block === 'object'
          && (block as { type?: unknown }).type === 'text'
        ))
        .map((block: { text?: unknown }) => String(block.text ?? ''))
        .join('\n')
        .replace(/\s+\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .trim()
      if (text.length > 0) return text
    }
  }
  return empty
}
