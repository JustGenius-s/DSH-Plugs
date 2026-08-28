import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import { CLIENT_SERVICES, getSettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import { createCodexFeatureManager } from './core/feature-manager'
import { createConversationCollapseFeature } from './features/conversation-collapse'
import { createFileLinksFeature } from './features/file-links'
import { createFilesFeature } from './features/files'
import { createGitGraphFeature } from './features/git-graph'
import { createNavigatorFeature } from './features/navigator'
import { createSidePanelsFeature } from './features/side-panels'
import { createTerminalFeature } from './features/terminal'
import { createTerminalControllerStore } from './features/terminal/controller'
import { createQuickActionsContribution } from './features/quick-actions/contribution'
import { CodexSettingsSection } from './settings/CodexSettingsSection'
import { installCodexSettingsIcon } from './settings/codex-settings-icon'
import { en, zh, type CodexKey } from './locales'
import { SETTINGS_NAMESPACE, type DshCodexConfig } from '../shared/config'

declare module '@just-genius/dsh-plugin-runtime/client' {
  interface PluginLocaleNamespaceMap {
    'settings.codex': CodexKey
  }
}

const NS = 'settings.codex'

export const inject = [
  CLIENT_SERVICES.slots,
  CLIENT_SERVICES.locale,
  CLIENT_SERVICES.connection,
  CLIENT_SERVICES.remote,
  CLIENT_SERVICES.sessions,
  CLIENT_SERVICES.workspaces,
  CLIENT_SERVICES.conversationEvents,
  // Terminal selections and file review comments register `@` reference codecs here.
  CLIENT_SERVICES.inputTriggers,
  CLIENT_SERVICES.settingsScope,
] as const

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-codex: dictionaries')

  const scope = getSettingsScope(ctx).bind<DshCodexConfig>({ namespace: SETTINGS_NAMESPACE })
  const t = ctx.locale.bind(NS) as (key: CodexKey) => string

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'codex',
    order: 30,
    label: () => t('nav'),
    inject: () => ({ scope, t }),
  }, CodexSettingsSection))
  ctx.effect(() => installCodexSettingsIcon(() => t('nav')), 'dsh-codex: settings icon')

  // A single terminal-controller registry shared by the side-panels quick
  // actions and the terminal feature. Both receive the SAME store — the
  // quick-action executor resolves a terminal it opened against it, and the
  // terminal panel registers each PTY into it — so ownership lives here and
  // dispose is single-sourced (never per-feature).
  const terminalControllers = createTerminalControllerStore()
  const quickActions = createQuickActionsContribution(
    ctx,
    scope,
    terminalControllers,
    key => t(key as CodexKey),
  )

  const features = createCodexFeatureManager([
    createConversationCollapseFeature(ctx, scope, t),
    createNavigatorFeature(ctx, scope),
    createSidePanelsFeature(ctx, scope, t, quickActions),
    createTerminalFeature(ctx, scope, t, terminalControllers),
    createGitGraphFeature(ctx, scope, t),
    createFilesFeature(ctx, scope, t),
    // After side-panels/files: the patch reroutes chat file links into the
    // panel those features provide.
    createFileLinksFeature(ctx, scope),
  ])
  ctx.effect(() => {
    features.activate()
    return () => {
      features.dispose()
      quickActions.dispose()
      terminalControllers.dispose()
    }
  }, 'dsh-codex: feature manager')
}
