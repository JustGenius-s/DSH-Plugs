import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { HOST_SERVICES, Schema } from '@just-genius/dsh-plugin-runtime/host'
import { installSettingsSection } from '@just-genius/dsh-plugin-runtime/host'
import {
  DEFAULT_CONFIG,
  PANEL_LAUNCHER_WIDTH_MAX,
  PANEL_LAUNCHER_WIDTH_MIN,
  SETTINGS_NAMESPACE,
  type DshCodexConfig,
} from './shared/config'
import { createDshCodexGitGraphServer } from './host/git-graph/server'
import { createDshCodexTerminalServer } from './host/terminal/server'

export const name = 'dsh-codex'
export const inject = [
  HOST_SERVICES.subprocess,
  HOST_SERVICES.webServer,
  HOST_SERVICES.settings,
  HOST_SERVICES.llm,
  HOST_SERVICES.agentDefaultModel,
  HOST_SERVICES.fs,
] as const

/** Host-side schema for the one durable Codex configuration namespace. */
export const ConfigSchema: Schema<DshCodexConfig> = Schema.object({
  navigatorEnabled: Schema.boolean().default(DEFAULT_CONFIG.navigatorEnabled),
  conversationCollapseEnabled: Schema.boolean().default(DEFAULT_CONFIG.conversationCollapseEnabled),
  terminalEnabled: Schema.boolean().default(DEFAULT_CONFIG.terminalEnabled),
  gitGraphEnabled: Schema.boolean().default(DEFAULT_CONFIG.gitGraphEnabled),
  filesEnabled: Schema.boolean().default(DEFAULT_CONFIG.filesEnabled),
  fileLinksInPanel: Schema.boolean().default(DEFAULT_CONFIG.fileLinksInPanel),
  filesShowGitIgnored: Schema.boolean().default(DEFAULT_CONFIG.filesShowGitIgnored),
  highlightThemeLight: Schema.string().default(DEFAULT_CONFIG.highlightThemeLight),
  highlightThemeDark: Schema.string().default(DEFAULT_CONFIG.highlightThemeDark),
  terminalShell: Schema.union([
    Schema.const('auto'),
    Schema.const('bash'),
    Schema.const('zsh'),
  ]).default(DEFAULT_CONFIG.terminalShell),
  terminalScrollback: Schema.number().min(500).max(20_000).default(DEFAULT_CONFIG.terminalScrollback),
  terminalFontSize: Schema.number().min(10).max(24).default(DEFAULT_CONFIG.terminalFontSize),
  panelDefaultWidth: Schema.number().min(300).max(1080).default(DEFAULT_CONFIG.panelDefaultWidth),
  panelMaxWidth: Schema.number().min(300).max(1080).default(DEFAULT_CONFIG.panelMaxWidth),
  panelLauncherWidth: Schema.number().min(PANEL_LAUNCHER_WIDTH_MIN).max(PANEL_LAUNCHER_WIDTH_MAX).default(DEFAULT_CONFIG.panelLauncherWidth),
  panelRememberTabs: Schema.boolean().default(DEFAULT_CONFIG.panelRememberTabs),
  quickActions: Schema.array(Schema.object({
    id: Schema.string(),
    name: Schema.string(),
    steps: Schema.array(Schema.object({
      command: Schema.string(),
      target: Schema.union([Schema.const('current'), Schema.const('new')]),
    })),
  })).default([]),
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
