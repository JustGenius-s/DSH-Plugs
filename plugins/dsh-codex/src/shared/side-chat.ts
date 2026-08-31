/**
 * Shared protocol for the dsh-codex side-chat feature.
 *
 * A side chat is a BLANK session that shares the current session's world but
 * not its history: it runs under the same working directory (so the sandbox is
 * identical) and never loads or writes the parent session's history. The host
 * owns the side-chat lifecycle over the `/dsh-codex/side-chat/*` routes and
 * the `/side` slash command; the client renders each side chat's live
 * conversation in a side-panel tab.
 */

export const SIDE_CHAT_ROUTE_PREFIX = '/dsh-codex/side-chat'
export const SIDE_CHAT_OPEN_PATH = `${SIDE_CHAT_ROUTE_PREFIX}/open`
export const SIDE_CHAT_LIST_PATH = `${SIDE_CHAT_ROUTE_PREFIX}/list`
export const SIDE_CHAT_CLOSE_PATH = `${SIDE_CHAT_ROUTE_PREFIX}/close`

/** The slash command that opens a side chat from the composer. */
export const SIDE_COMMAND = 'side'

/** One side chat as the host registry reports it. */
export interface SideChatSummary {
  readonly sideSessionId: string
  readonly parentSessionId: string
  readonly createdAt: number
  readonly running: boolean
  /** Short display title derived from the side chat's first own user message; '' when none yet. */
  readonly title: string
}
