export const SETTINGS_NAMESPACE = 'dsh-codex' as const

export type TerminalShell = 'auto' | 'bash' | 'zsh'

export interface DshCodexConfig {
  navigatorEnabled: boolean
  terminalEnabled: boolean
  gitGraphEnabled: boolean
  terminalShell: TerminalShell
  terminalScrollback: number
  terminalFontSize: number
  panelDefaultWidth: number
  panelMaxWidth: number
  panelRememberTabs: boolean
}

export const DEFAULT_CONFIG: DshCodexConfig = {
  navigatorEnabled: true,
  terminalEnabled: true,
  gitGraphEnabled: true,
  terminalShell: 'auto',
  terminalScrollback: 5000,
  terminalFontSize: 12,
  panelDefaultWidth: 360,
  panelMaxWidth: 720,
  panelRememberTabs: true,
}
