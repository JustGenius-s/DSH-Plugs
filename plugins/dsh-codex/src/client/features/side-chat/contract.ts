/**
 * Side-chat tab identity and its per-instance resource address.
 *
 * A side chat is opened from the guide by KIND, and a kind opens the tab at
 * `sidebar://<kind>` — the store's page address. Pages are deduplicated to one
 * per pane (a page tab is never copied, and re-opening it focuses the existing
 * record), so a second side chat was unopenable. Each side chat therefore
 * carries its own RESOURCE address, exactly like a terminal: the store only
 * deduplicates a resource when the caller asks it to.
 *
 * The address is always DERIVED from the tab's own id rather than minted
 * randomly, and that is deliberate: a remount, a StrictMode double-invoke or an
 * HMR reload must land on the same record. A random mint would produce a new
 * address each time and multiply tabs instead.
 */

export const SIDE_CHAT_TAB_KIND = 'dsh-codex-side-chat'
export const SIDE_CHAT_TAB_ID = '@just-genius/dsh-codex/side-chat'
export const SIDE_CHAT_RESOURCE_PATTERN = 'dsh-resource://dsh-codex-side-chat/**'

const SIDE_CHAT_RESOURCE_PREFIX = 'dsh-resource://dsh-codex-side-chat/'

/** Give one side chat a resource identity so it owns a tab instead of a page seat. */
export function sideChatResourceAddress(instanceId: string): string {
  return `${SIDE_CHAT_RESOURCE_PREFIX}${encodeURIComponent(instanceId)}`
}

export function isSideChatResourceAddress(address: string): boolean {
  return address.startsWith(SIDE_CHAT_RESOURCE_PREFIX)
    && address.length > SIDE_CHAT_RESOURCE_PREFIX.length
}

/**
 * Convert a guide-opened page tab once; a real side-chat resource passes through.
 *
 * The page address is derived from the tab's own id, so the body that mounts
 * from it always re-opens the SAME resource: a remount cannot multiply tabs.
 */
export function sideChatResourceAddressForTab(address: string, tabId: string): string {
  return isSideChatResourceAddress(address) ? address : sideChatResourceAddress(tabId)
}
