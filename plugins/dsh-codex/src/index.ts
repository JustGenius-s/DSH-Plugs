import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import { DEFAULT_CONFIG, SETTINGS_NAMESPACE, type DshCodexConfig } from './shared/config'
import { createDshCodexGitGraphServer } from './host/git-graph/server'
import { createDshCodexTerminalServer } from './host/terminal/server'

export const name = 'dsh-codex'
export const inject = ['subprocess', 'webServer'] as const

/** Host-side schema for the one durable Codex configuration namespace. */
export const ConfigSchema = Schema.object({
  navigatorEnabled: Schema.boolean().default(DEFAULT_CONFIG.navigatorEnabled),
  terminalEnabled: Schema.boolean().default(DEFAULT_CONFIG.terminalEnabled),
  gitGraphEnabled: Schema.boolean().default(DEFAULT_CONFIG.gitGraphEnabled),
  terminalShell: Schema.union([
    Schema.const('auto'),
    Schema.const('bash'),
    Schema.const('zsh'),
  ]).default(DEFAULT_CONFIG.terminalShell),
  terminalScrollback: Schema.number().min(500).max(20_000).default(DEFAULT_CONFIG.terminalScrollback),
  terminalFontSize: Schema.number().min(10).max(24).default(DEFAULT_CONFIG.terminalFontSize),
  panelDefaultWidth: Schema.number().min(300).max(720).default(DEFAULT_CONFIG.panelDefaultWidth),
  panelMaxWidth: Schema.number().min(300).max(720).default(DEFAULT_CONFIG.panelMaxWidth),
  panelRememberTabs: Schema.boolean().default(DEFAULT_CONFIG.panelRememberTabs),
})

export function apply(ctx: Context, config?: Partial<DshCodexConfig>): void {
  const entry = { ...DEFAULT_CONFIG, ...config }
  let source = (): DshCodexConfig => entry
  let currentConfig = entry

  installSettingsSection(ctx, SETTINGS_NAMESPACE as never, ConfigSchema, entry, {
    setSource: (nextSource) => { source = nextSource },
    onChange: () => { currentConfig = source() },
  })

  ctx.effect(() => {
    const server = createDshCodexTerminalServer(ctx, () => currentConfig)
    return () => server.dispose()
  }, 'dsh-codex: terminal websocket route')

  ctx.effect(() => {
    const server = createDshCodexGitGraphServer(ctx)
    return () => server.dispose()
  }, 'dsh-codex: git-graph routes')
}
