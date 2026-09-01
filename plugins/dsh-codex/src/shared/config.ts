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
  navigatorEnabled: boolean
  conversationCollapseEnabled: boolean
  /** Pin the newest user message to the top of the conversation while scrolling. */
  stickyUserBubbleEnabled: boolean
  stickyUserBubbleMode: StickyUserBubbleMode
  /** Drain the history window until the session has no older pages. */
  fullSessionLoadEnabled: boolean
  /** Cap on in-window user messages while full-session load is on (inclusive). */
  fullSessionLoadLimit: number
  terminalEnabled: boolean
  gitGraphEnabled: boolean
  filesEnabled: boolean
  fileLinksInPanel: boolean
  /** When true, the files tree lists gitignored paths (VS Code default). */
  filesShowGitIgnored: boolean
  /** Light syntax-highlight theme id for the files panel (see client catalog). */
  highlightThemeLight: string
  /** Dark syntax-highlight theme id for the files panel (see client catalog). */
  highlightThemeDark: string
  terminalShell: TerminalShell
  terminalScrollback: number
  terminalFontSize: number
  panelDefaultWidth: number
  panelMaxWidth: number
  panelLauncherWidth: number
  panelRememberTabs: boolean
  quickActions: QuickAction[]
}

/** Inclusive bounds for the collapsed floating launcher card. */
export const PANEL_LAUNCHER_WIDTH_MIN = 140
export const PANEL_LAUNCHER_WIDTH_MAX = 400

/** Inclusive bounds for full-session-load's user-message cap. */
export const FULL_SESSION_LOAD_LIMIT_MIN = 5
export const FULL_SESSION_LOAD_LIMIT_MAX = 200
export const FULL_SESSION_LOAD_LIMIT_PRESETS = [10, 15, 25, 50] as const

export const DEFAULT_CONFIG: DshCodexConfig = {
  navigatorEnabled: true,
  conversationCollapseEnabled: true,
  stickyUserBubbleEnabled: false,
  stickyUserBubbleMode: 'running',
  fullSessionLoadEnabled: false,
  fullSessionLoadLimit: 25,
  terminalEnabled: true,
  gitGraphEnabled: true,
  filesEnabled: true,
  fileLinksInPanel: true,
  filesShowGitIgnored: true,
  highlightThemeLight: 'codex-light',
  highlightThemeDark: 'codex-dark',
  terminalShell: 'auto',
  terminalScrollback: 5000,
  terminalFontSize: 12,
  panelDefaultWidth: 360,
  panelMaxWidth: 720,
  panelLauncherWidth: 220,
  panelRememberTabs: true,
  quickActions: [],
}

export function clampPanelLauncherWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CONFIG.panelLauncherWidth
  return Math.min(
    PANEL_LAUNCHER_WIDTH_MAX,
    Math.max(PANEL_LAUNCHER_WIDTH_MIN, Math.round(value)),
  )
}

export function clampFullSessionLoadLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CONFIG.fullSessionLoadLimit
  return Math.min(
    FULL_SESSION_LOAD_LIMIT_MAX,
    Math.max(FULL_SESSION_LOAD_LIMIT_MIN, Math.round(value)),
  )
}
