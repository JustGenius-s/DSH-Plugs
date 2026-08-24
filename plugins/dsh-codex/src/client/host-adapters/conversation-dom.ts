/**
 * Compatibility boundary for ui-conversation DOM affordances.
 *
 * `data-conversation-scroll` is a documented host hook. The chat flow and
 * anchor attributes are compatibility probes: features must use this module
 * rather than spreading knowledge of the host's private DOM across views.
 */

const CONVERSATION_SCROLL = '[data-conversation-scroll]'
const CHAT_FLOW = '[data-chat-flow]'
const CHAT_ANCHOR = '[data-chat-anchor-key]'

export function conversationScroll(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(CONVERSATION_SCROLL)
}

export function closestConversationScroll(node: Element): HTMLElement | null {
  return node.closest<HTMLElement>(CONVERSATION_SCROLL)
}

export function chatFlow(scroll: ParentNode): HTMLElement | null {
  return scroll.querySelector<HTMLElement>(CHAT_FLOW)
}

export function chatAnchorRows(scroll: ParentNode): readonly HTMLElement[] {
  return Array.from(scroll.querySelectorAll<HTMLElement>(CHAT_ANCHOR))
}

export function chatAnchorRow(scroll: ParentNode, key: string): HTMLElement | null {
  return scroll.querySelector<HTMLElement>(`[data-chat-anchor-key="${escapeSelectorValue(key)}"]`)
}

/**
 * ui-conversation does not expose the active view to root-scoped overlays.
 * Keep its header-layout compatibility rule isolated here until the host adds
 * a public active-view source.
 */
export function isChatViewActive(root: ParentNode = document): boolean {
  const scroll = conversationScroll(root)
  const header = scroll?.previousElementSibling ?? null
  const tablist = header?.querySelector('[role="tablist"]') ?? null
  if (tablist === null) return true
  const selected = tablist.querySelector('[role="tab"][aria-selected="true"]')
  if (selected === null) return true
  return selected === tablist.firstElementChild
}

function escapeSelectorValue(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/["'\\\0-\x1f]/g, character => `\\${character}`)
}
