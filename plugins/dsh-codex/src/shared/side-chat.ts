/**
 * Shared protocol for the dsh-codex side-chat feature.
 *
 * A side chat is a session that shares the current session's world: it runs
 * under the same working directory (so the sandbox is identical) and never
 * loads or writes the parent session's history. When enabled, it receives a
 * lightweight main-session link and can read recent turns on demand. The host
 * owns the side-chat lifecycle over the `/dsh-codex/side-chat/*` routes and
 * the `/side` slash command; the client renders each side chat's live
 * conversation in a side-panel tab.
 */

export const SIDE_CHAT_ROUTE_PREFIX = '/dsh-codex/side-chat'
export const SIDE_CHAT_OPEN_PATH = `${SIDE_CHAT_ROUTE_PREFIX}/open`
export const SIDE_CHAT_LIST_PATH = `${SIDE_CHAT_ROUTE_PREFIX}/list`
export const SIDE_CHAT_CLOSE_PATH = `${SIDE_CHAT_ROUTE_PREFIX}/close`
export const SIDE_CHAT_DEBUG_PATH = `${SIDE_CHAT_ROUTE_PREFIX}/debug`
export const SIDE_CHAT_REFERENCES_PATH = `${SIDE_CHAT_ROUTE_PREFIX}/references`

export interface SideChatReferenceCandidate {
  sessionId: string
  label: string
  displayTitle?: string
  cwd?: string
  sameWorkspace?: boolean
  updatedAt?: number
  mention: string
}

/** The slash command that opens a side chat from the composer. */
export const SIDE_COMMAND = 'side'

/** The host's answer to an open request. */
export interface SideChatOpenResult {
  readonly sideSessionId: string
  /**
   * Whether the main-session link reached the new side chat.
   *
   * Reported here rather than read off the transcript because the injected
   * link only enters the durable log when the first turn claims it — the
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
  /** Whether the main-session link reached this side chat. */
  readonly context: SideChatContextState
}

/**
 * Whether a side chat can consult its main session.
 *
 * `linked` — an identity-only link was injected and a scoped read tool exists.
 * `inherited` — legacy host attached a parent digest (client compatibility).
 * `none` — the link could not be injected.
 * `off` — the setting disabled parent linking and reads.
 */
export type SideChatContextState = 'linked' | 'inherited' | 'none' | 'off'

/** Why the host refused to open a side chat. */
export const SIDE_CHAT_DISABLED_REASON = 'side-chat-disabled' as const
export type SideChatDisabledReason = typeof SIDE_CHAT_DISABLED_REASON

/** The host's answer when side chat is switched off. */
export interface SideChatDisabled {
  readonly disabled: true
  readonly reason: SideChatDisabledReason
}
