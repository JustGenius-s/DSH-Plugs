import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { HOST_SERVICES } from '@just-genius/dsh-plugin-runtime/host'
import { installSettingsSection } from '@just-genius/dsh-plugin-runtime/host'
import { SETTINGS_NAMESPACE } from './shared/config'
import { createDshCodexGitGraphServer } from './host/git-graph/server'
import { createDshCodexFilesServer } from './host/files/server'
import { createDshCodexSideChatServer } from './host/side-chat/server'
import { createDshCodexTerminalServer } from './host/terminal/server'
import { createEnabledResourceGate } from './host/enabled-resource'
import { ConfigSchema, createCodexConfigSource, type CodexConfigInput } from './host/settings'

export { Config, ConfigSchema } from './host/settings'

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

export function apply(ctx: Context, config?: CodexConfigInput): void {
  const entrySource = createCodexConfigSource(config)
  const entry = entrySource()
  let currentConfig = entry
  let refreshFilesRoutes: (() => void) | undefined

  installSettingsSection(ctx, SETTINGS_NAMESPACE, ConfigSchema, entry, {
    entrySource,
    onChange: (next) => {
      currentConfig = next
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
