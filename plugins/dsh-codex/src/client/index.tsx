import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import { getSettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import { createCodexFeatureManager } from './core/feature-manager'
import { createFileMentionsFeature } from './features/file-mentions'
import { createFilesFeature } from './features/files'
import { createLongMessageCollapseFeature } from './features/long-message-collapse'
import { createFullSessionLoadFeature } from './features/full-session-load'
import { createGitGraphFeature } from './features/git-graph'
import { createSideChatFeature } from './features/side-chat'
import { createStickyUserBubbleFeature } from './features/sticky-user-bubble'
import { createTerminalFeature } from './features/terminal'
import { createTerminalControllerStore } from './features/terminal/controller'
import { createQuickActionsContribution } from './features/quick-actions/contribution'
import { CodexSettingsSection } from './settings/CodexSettingsSection'
import { installCodexSettingsIcon } from './settings/codex-settings-icon'
import { en, zh, type CodexKey } from './locales'
import {
  SETTINGS_NAMESPACE,
  type DshCodexConfig,
} from '../shared/config'
import { CODEX_CLIENT_INJECT } from './inject'

declare module '@just-genius/dsh-plugin-runtime/client' {
  interface PluginLocaleNamespaceMap {
    'settings.codex': CodexKey
  }
}

const NS = 'settings.codex'

export const inject = CODEX_CLIENT_INJECT

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

  // A single terminal-controller registry shared by quick actions and the
  // terminal feature. Both receive the SAME store — the
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
    createLongMessageCollapseFeature(ctx, scope, t),
    createFullSessionLoadFeature(ctx, scope),
    createStickyUserBubbleFeature(ctx, scope, t),
    createSideChatFeature(ctx, scope, t),
    createTerminalFeature(ctx, scope, t, terminalControllers, quickActions),
    createGitGraphFeature(ctx, scope, t),
    createFilesFeature(ctx, scope, t),
    createFileMentionsFeature(ctx),
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
