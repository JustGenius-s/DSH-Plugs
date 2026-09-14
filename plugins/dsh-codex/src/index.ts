import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { HOST_SERVICES, Schema } from '@just-genius/dsh-plugin-runtime/host'
import { installSettingsSection } from '@just-genius/dsh-plugin-runtime/host'
import {
  DEFAULT_CONFIG,
  FULL_SESSION_LOAD_LIMIT_MAX,
  FULL_SESSION_LOAD_LIMIT_MIN,
  SETTINGS_NAMESPACE,
  type DshCodexConfig,
} from './shared/config'
import { createDshCodexGitGraphServer } from './host/git-graph/server'
import { createDshCodexFilesServer } from './host/files/server'
import { createDshCodexSideChatServer } from './host/side-chat/server'
import { createDshCodexTerminalServer } from './host/terminal/server'
import { createEnabledResourceGate } from './host/enabled-resource'

export const name = 'dsh-codex'
export const inject = [
  HOST_SERVICES.subprocess,
  HOST_SERVICES.webServer,
  HOST_SERVICES.settings,
  HOST_SERVICES.llm,
  HOST_SERVICES.agentDefaultModel,
  HOST_SERVICES.fs,
  HOST_SERVICES.agents,
  HOST_SERVICES.sessions,
  HOST_SERVICES.agentPresets,
  HOST_SERVICES.commands,
] as const

/** Host-side schema for the one durable Codex configuration namespace. */
export const ConfigSchema: Schema<DshCodexConfig> = Schema.object({
  longMessageCollapseEnabled: Schema.boolean().default(DEFAULT_CONFIG.longMessageCollapseEnabled),
  stickyUserBubbleEnabled: Schema.boolean().default(DEFAULT_CONFIG.stickyUserBubbleEnabled),
  stickyUserBubbleMode: Schema.union([
    Schema.const('running'),
    Schema.const('always'),
  ]).default(DEFAULT_CONFIG.stickyUserBubbleMode),
  fullSessionLoadEnabled: Schema.boolean().default(DEFAULT_CONFIG.fullSessionLoadEnabled),
  fullSessionLoadLimit: Schema.number().min(FULL_SESSION_LOAD_LIMIT_MIN).max(FULL_SESSION_LOAD_LIMIT_MAX).default(DEFAULT_CONFIG.fullSessionLoadLimit),
  terminalEnabled: Schema.boolean().default(DEFAULT_CONFIG.terminalEnabled),
  gitGraphEnabled: Schema.boolean().default(DEFAULT_CONFIG.gitGraphEnabled),
  customFilesEnabled: Schema.boolean().default(DEFAULT_CONFIG.customFilesEnabled),
  sideChatEnabled: Schema.boolean().default(DEFAULT_CONFIG.sideChatEnabled),
  sideChatContextEnabled: Schema.boolean().default(DEFAULT_CONFIG.sideChatContextEnabled),
  highlightThemeLight: Schema.string().default(DEFAULT_CONFIG.highlightThemeLight),
  highlightThemeDark: Schema.string().default(DEFAULT_CONFIG.highlightThemeDark),
  terminalShell: Schema.union([
    Schema.const('auto'),
    Schema.const('bash'),
    Schema.const('zsh'),
  ]).default(DEFAULT_CONFIG.terminalShell),
  terminalScrollback: Schema.number().min(500).max(20_000).default(DEFAULT_CONFIG.terminalScrollback),
  terminalFontSize: Schema.number().min(10).max(24).default(DEFAULT_CONFIG.terminalFontSize),
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
  let refreshFilesRoutes: (() => void) | undefined

  installSettingsSection(ctx, SETTINGS_NAMESPACE as never, ConfigSchema, entry, {
    setSource: (nextSource) => { source = nextSource },
    onChange: () => {
      currentConfig = source()
      refreshFilesRoutes?.()
    },
  })

  ctx.effect(() => {
    const server = createDshCodexTerminalServer(ctx, () => currentConfig)
    return () => server.dispose()
  }, 'dsh-codex: terminal websocket route')

  ctx.effect(() => {
    const server = createDshCodexGitGraphServer(ctx)
    return () => server.dispose()
  }, 'dsh-codex: git-graph routes')

  ctx.effect(() => {
    // Live config, not a boot snapshot: both side-chat switches are read per
    // open request, so a settings change lands on the next side chat with no
    // plugin restart.
    const server = createDshCodexSideChatServer(ctx, () => currentConfig)
    return () => server.dispose()
  }, 'dsh-codex: side-chat routes')

  ctx.effect(() => {
    const routes = createEnabledResourceGate(() => {
      const server = createDshCodexFilesServer(ctx)
      return () => server.dispose()
    })
    const refresh = (): void => routes.setEnabled(currentConfig.customFilesEnabled)
    refreshFilesRoutes = refresh
    refresh()
    return () => {
      if (refreshFilesRoutes === refresh) refreshFilesRoutes = undefined
      routes.dispose()
    }
  }, 'dsh-codex: settings-gated files routes')
}
