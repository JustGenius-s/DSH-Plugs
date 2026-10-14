import type { SideChatReferenceCandidate } from '../../../shared/side-chat'

export interface MentionQuery {
  start: number
  end: number
  query: string
}

/** Only an unselected, standalone @ token at the caret opens completion. */
export function mentionQuery(text: string, start: number, end = start): MentionQuery | undefined {
  if (start !== end || start < 0 || start > text.length) return undefined
  const match = /(?:^|\s)@([^\s@\[\]()]*$)/u.exec(text.slice(0, start))
  if (match === null) return undefined
  return { start: start - match[1]!.length - 1, end: start, query: match[1]! }
}

export function filterReferenceCandidates(
  rows: readonly SideChatReferenceCandidate[], query: string,
): SideChatReferenceCandidate[] {
  const needle = query.trim().toLocaleLowerCase()
  return rows.filter(row => [row.label, row.displayTitle ?? '', row.sessionId, row.cwd ?? '']
    .some(value => value.toLocaleLowerCase().includes(needle)))
}

export function insertSessionMention(text: string, range: MentionQuery, mention: string): { text: string; caret: number } {
  const insertion = `${mention} `
  return { text: text.slice(0, range.start) + insertion + text.slice(range.end), caret: range.start + insertion.length }
}

export function moveMentionSelection(index: number, delta: number, count: number): number {
  return count === 0 ? 0 : (index + delta + count) % count
}

export function mentionKeyAction(key: string, shift: boolean, composing: boolean): 'previous' | 'next' | 'pick' | 'dismiss' | undefined {
  if (composing) return undefined
  if (key === 'Escape') return 'dismiss'
  if (key === 'ArrowUp') return 'previous'
  if (key === 'ArrowDown') return 'next'
  if ((key === 'Enter' || key === 'Tab') && !shift) return 'pick'
  return undefined
}
