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

export interface DshCodexConfig {
  navigatorEnabled: boolean
  conversationCollapseEnabled: boolean
  terminalEnabled: boolean
  gitGraphEnabled: boolean
  filesEnabled: boolean
  fileLinksInPanel: boolean
  /** When true, the files tree lists gitignored paths (VS Code default). */
  filesShowGitIgnored: boolean
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

export const DEFAULT_CONFIG: DshCodexConfig = {
  navigatorEnabled: true,
  conversationCollapseEnabled: true,
  terminalEnabled: true,
  gitGraphEnabled: true,
  filesEnabled: true,
  fileLinksInPanel: true,
  filesShowGitIgnored: true,
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
