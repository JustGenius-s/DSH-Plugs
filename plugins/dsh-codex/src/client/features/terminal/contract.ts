import {
  createTerminalResourceAddress,
  isTerminalResourceAddress,
  terminalResourceAddress,
} from '../../../shared/terminal-open'

// Sharing the built-in kind lets DSH select our extension and its guide entry.
export const TERMINAL_TAB_KIND = 'terminal'
export const TERMINAL_TAB_ID = '@just-genius/dsh-codex/terminal'
// Saved layouts from before the takeover still carry this kind.
export const LEGACY_TERMINAL_TAB_KIND = 'dsh-codex-terminal'
export const LEGACY_TERMINAL_TAB_ID = '@just-genius/dsh-codex/terminal/legacy'
export const TERMINAL_RESOURCE_PATTERN = 'dsh-resource://dsh-codex-terminal/**'

export {
  createTerminalResourceAddress,
  isTerminalResourceAddress,
  terminalResourceAddress,
}

/** Convert a guide-opened page tab once; real terminal resources pass through. */
export function terminalResourceAddressForTab(address: string, tabId: string): string {
  return isTerminalResourceAddress(address) ? address : terminalResourceAddress(tabId)
}

/** Identity shared by the controller registry, PTY reconnect token and close lifecycle. */
export function terminalControllerId(sessionId: string, tabId: string): string {
  return `${sessionId}:${tabId}`
}

/**
 * Registry key for a terminal's command controller, derived from its resource
 * address instead of its tab id.
 *
 * `sidebarRight.openResource()` applies navigation asynchronously, so the
 * newly created tab id is not readable from `sidebarRight.active()` on the
 * next line. A caller that opens a terminal therefore cannot know the tab id
 * it should wait on. The resource address is different: the caller mints it
 * before opening, and the tab that mounts from it reports the same address, so
 * both sides agree on one key without reading any post-navigation state.
 */
export function terminalResourceControllerId(sessionId: string, address: string): string {
  return `${sessionId}:${address}`
}

export function terminalCwd(
  params: Readonly<Record<string, unknown>> | undefined,
  fallback: string | undefined,
): string | undefined {
  return typeof params?.cwd === 'string' && params.cwd.trim() !== ''
    ? params.cwd
    : fallback
}
