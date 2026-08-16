import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import { DEFAULT_CONFIG, SETTINGS_NAMESPACE, type DashCodexConfig } from './shared/config'
import { createDashCodexTerminalServer } from './host/terminal/server'

export const name = 'dash-codex'
export const inject = ['subprocess', 'webServer'] as const

/** Host-side schema for the one durable Codex configuration namespace. */
export const ConfigSchema = Schema.object({
  navigatorEnabled: Schema.boolean().default(DEFAULT_CONFIG.navigatorEnabled),
  terminalEnabled: Schema.boolean().default(DEFAULT_CONFIG.terminalEnabled),
  terminalShell: Schema.union([
    Schema.const('auto'),
    Schema.const('bash'),
    Schema.const('zsh'),
  ]).default(DEFAULT_CONFIG.terminalShell),
  terminalScrollback: Schema.number().min(500).max(20_000).default(DEFAULT_CONFIG.terminalScrollback),
  terminalFontSize: Schema.number().min(10).max(24).default(DEFAULT_CONFIG.terminalFontSize),
  panelDefaultWidth: Schema.number().min(300).max(520).default(DEFAULT_CONFIG.panelDefaultWidth),
  panelRememberTabs: Schema.boolean().default(DEFAULT_CONFIG.panelRememberTabs),
})

export function apply(ctx: Context, config?: Partial<DashCodexConfig>): void {
  const entry = { ...DEFAULT_CONFIG, ...config }
  let source = (): DashCodexConfig => entry
  let currentConfig = entry

  installSettingsSection(ctx, SETTINGS_NAMESPACE as never, ConfigSchema, entry, {
    setSource: (nextSource) => { source = nextSource },
    onChange: () => { currentConfig = source() },
  })

  ctx.effect(() => {
    const server = createDashCodexTerminalServer(ctx, () => currentConfig)
    return () => server.dispose()
  }, 'dash-codex: terminal websocket route')
}
