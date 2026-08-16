export const SETTINGS_NAMESPACE = 'dash-codex' as const

export type TerminalShell = 'auto' | 'bash' | 'zsh'

export interface DashCodexConfig {
  navigatorEnabled: boolean
  terminalEnabled: boolean
  terminalShell: TerminalShell
  terminalScrollback: number
  terminalFontSize: number
  panelDefaultWidth: number
  panelRememberTabs: boolean
}

export const DEFAULT_CONFIG: DashCodexConfig = {
  navigatorEnabled: true,
  terminalEnabled: true,
  terminalShell: 'auto',
  terminalScrollback: 5000,
  terminalFontSize: 12,
  panelDefaultWidth: 360,
  panelRememberTabs: true,
}
