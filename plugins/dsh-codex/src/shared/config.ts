export const SETTINGS_NAMESPACE = 'dsh-codex' as const

export type TerminalShell = 'auto' | 'bash' | 'zsh'

export interface DshCodexConfig {
  navigatorEnabled: boolean
  terminalEnabled: boolean
  terminalShell: TerminalShell
  terminalScrollback: number
  terminalFontSize: number
  panelDefaultWidth: number
  panelRememberTabs: boolean
}

export const DEFAULT_CONFIG: DshCodexConfig = {
  navigatorEnabled: true,
  terminalEnabled: true,
  terminalShell: 'auto',
  terminalScrollback: 5000,
  terminalFontSize: 12,
  panelDefaultWidth: 360,
  panelRememberTabs: true,
}
