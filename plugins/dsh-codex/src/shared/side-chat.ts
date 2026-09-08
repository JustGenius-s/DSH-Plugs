/**
 * Shared protocol for the dsh-codex side-chat feature.
 *
 * A side chat is a session that shares the current session's world: it runs
 * under the same working directory (so the sandbox is identical) and never
 * loads or writes the parent session's history. What it DOES inherit is a
 * recall digest of the parent's recent conversation, injected as model-facing
 * context at creation, so the side agent answers with the main task in mind
 * while the side chat's own transcript stays blank. The host owns the
 * side-chat lifecycle over the `/dsh-codex/side-chat/*` routes and the `/side`
 * slash command; the client renders each side chat's live conversation in a
 * side-panel tab.
 */

export const SIDE_CHAT_ROUTE_PREFIX = '/dsh-codex/side-chat'
export const SIDE_CHAT_OPEN_PATH = `${SIDE_CHAT_ROUTE_PREFIX}/open`
export const SIDE_CHAT_LIST_PATH = `${SIDE_CHAT_ROUTE_PREFIX}/list`
export const SIDE_CHAT_CLOSE_PATH = `${SIDE_CHAT_ROUTE_PREFIX}/close`

/** The slash command that opens a side chat from the composer. */
export const SIDE_COMMAND = 'side'

/** The host's answer to an open request. */
export interface SideChatOpenResult {
  readonly sideSessionId: string
  /**
   * Whether the parent's conversation context reached the new side chat.
   *
   * Reported here rather than read off the transcript because the injected
   * context only enters the durable log when the first turn claims it — the
   * client would otherwise see an empty chat with no sign of what came along.
   */
  readonly context: SideChatContextState
}

/** One side chat as the host registry reports it. */
export interface SideChatSummary {
  readonly sideSessionId: string
  readonly parentSessionId: string
  readonly createdAt: number
  readonly running: boolean
  /** Short display title derived from the side chat's first own user message; '' when none yet. */
  readonly title: string
  /** Whether the parent's conversation context reached this side chat. */
  readonly context: SideChatContextState
}

/**
 * How much of the parent conversation a side chat received at creation.
 *
 * `inherited` — a recall digest of the parent's recent turns was injected as
 * model-facing context, so the side agent answers with the main task in mind.
 * `none` — the parent had nothing usable to inherit (a blank parent, or the
 * digest could not be built).
 */
export type SideChatContextState = 'inherited' | 'none'
