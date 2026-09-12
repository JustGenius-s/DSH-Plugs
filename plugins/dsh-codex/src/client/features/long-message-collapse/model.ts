/** How tall a single message may stay before it is clamped. ~12 lines at 24px. */
export const LONG_MESSAGE_COLLAPSE_MAX_PX = 288
/** Extra height required so a near-threshold message is not clamped for a sliver. */
export const LONG_MESSAGE_COLLAPSE_SLACK_PX = 48

export const LONG_MESSAGE_ATTR = 'data-dsh-codex-long-msg'
export const LONG_MESSAGE_BODY_CLASS = 'dsh-codex-long-msg-body'
export const LONG_MESSAGE_CHROME_ATTR = 'data-dsh-codex-long-msg-chrome'

const LONG_MESSAGE_ROW_KINDS = new Set(['user', 'steering', 'assistant-step'])

export type LongMessagePresentation = 'none' | 'collapsed' | 'expanded'

export function isLongMessageRowKind(kind: string | undefined): boolean {
  return kind !== undefined && LONG_MESSAGE_ROW_KINDS.has(kind)
}

export function longMessagePresentation(input: {
  contentHeight: number
  streaming: boolean
  expanded: boolean
  maxHeight?: number
  slack?: number
}): LongMessagePresentation {
  if (input.streaming) return 'none'
  const max = input.maxHeight ?? LONG_MESSAGE_COLLAPSE_MAX_PX
  const slack = input.slack ?? LONG_MESSAGE_COLLAPSE_SLACK_PX
  if (input.contentHeight <= max + slack) return 'none'
  return input.expanded ? 'expanded' : 'collapsed'
}

export function isStreamingMessageRow(row: HTMLElement): boolean {
  return row.querySelector('[data-streaming]') !== null
}

/**
 * The host-owned node whose height we clamp. User rows keep attachments
 * outside the clamp; assistant rows clamp the markdown root.
 */
export function findLongMessageClampTarget(row: HTMLElement): HTMLElement | null {
  if (!isLongMessageRowKind(row.dataset.chatFlowKind)) return null
  const root = row.firstElementChild
  if (!(root instanceof HTMLElement)) return null
  if (row.dataset.chatFlowKind === 'assistant-step') return root
  const stack = root.firstElementChild
  if (!(stack instanceof HTMLElement)) return root
  for (const child of stack.children) {
    if (!(child instanceof HTMLElement)) continue
    if (child.hasAttribute('data-message-attachments')) continue
    if (child.hasAttribute(LONG_MESSAGE_CHROME_ATTR)) continue
    return child
  }
  return null
}

export function contentHeightOf(target: HTMLElement): number {
  return target.scrollHeight
}
