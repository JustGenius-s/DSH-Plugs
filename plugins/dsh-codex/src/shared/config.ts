export const SETTINGS_NAMESPACE = 'dsh-codex' as const

export type TerminalShell = 'auto' | 'bash' | 'zsh'

export type QuickActionTarget = 'current' | 'new'

export interface QuickActionStep {
  command: string
  target: QuickActionTarget
}

export interface QuickAction {
  id: string
  name: string
  steps: QuickActionStep[]
}

/** When the pinned user bubble is shown: only while a turn is running, or always. */
export type StickyUserBubbleMode = 'running' | 'always'

export interface DshCodexConfig {
  /** Clamp a single oversized chat message behind an expand control. */
  longMessageCollapseEnabled: boolean
  /** Pin the newest user message to the top of the conversation while scrolling. */
  stickyUserBubbleEnabled: boolean
  stickyUserBubbleMode: StickyUserBubbleMode
  /** Drain the history window until the session has no older pages. */
  fullSessionLoadEnabled: boolean
  /** Cap on in-window user messages while full-session load is on (inclusive). */
  fullSessionLoadLimit: number
  terminalEnabled: boolean
  gitGraphEnabled: boolean
  /** Prefer the retained Codex file tree and previews over DSH's built-ins. */
  customFilesEnabled: boolean
  /** Offer the side-chat panel: a blank conversation beside the current session. */
  sideChatEnabled: boolean
  /**
   * Hand a new side chat a digest of the parent conversation as context.
   *
   * Context, not history: the side chat's own transcript still starts empty —
   * the digest only tells the side agent what the main task is about.
   */
  sideChatContextEnabled: boolean
  /** Light syntax-highlight theme id for the files panel (see client catalog). */
  highlightThemeLight: string
  /** Dark syntax-highlight theme id for the files panel (see client catalog). */
  highlightThemeDark: string
  terminalShell: TerminalShell
  terminalScrollback: number
  terminalFontSize: number
  quickActions: QuickAction[]
}

/** Inclusive bounds for full-session-load's user-message cap. */
export const FULL_SESSION_LOAD_LIMIT_MIN = 5
export const FULL_SESSION_LOAD_LIMIT_MAX = 200
export const FULL_SESSION_LOAD_LIMIT_PRESETS = [10, 15, 25, 50] as const

export const DEFAULT_CONFIG: DshCodexConfig = {
  longMessageCollapseEnabled: true,
  stickyUserBubbleEnabled: false,
  stickyUserBubbleMode: 'running',
  fullSessionLoadEnabled: false,
  fullSessionLoadLimit: 25,
  terminalEnabled: true,
  gitGraphEnabled: true,
  customFilesEnabled: false,
  sideChatEnabled: true,
  sideChatContextEnabled: true,
  highlightThemeLight: 'codex-light',
  highlightThemeDark: 'codex-dark',
  terminalShell: 'auto',
  terminalScrollback: 5000,
  terminalFontSize: 12,
  quickActions: [],
}

export function clampFullSessionLoadLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CONFIG.fullSessionLoadLimit
  return Math.min(
    FULL_SESSION_LOAD_LIMIT_MAX,
    Math.max(FULL_SESSION_LOAD_LIMIT_MIN, Math.round(value)),
  )
}
