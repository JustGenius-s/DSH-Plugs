import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { createCodexFeatureManager } from './core/feature-manager'
import { createCodexSettingsStore } from './config/codex-settings-store'
import { createConversationCollapseFeature } from './features/conversation-collapse'
import { createFileLinksFeature } from './features/file-links'
import { createFilesFeature } from './features/files'
import { createGitGraphFeature } from './features/git-graph'
import { createNavigatorFeature } from './features/navigator'
import { createSidePanelsFeature } from './features/side-panels'
import { createTerminalFeature } from './features/terminal'
import { createTerminalControllerStore, type TerminalControllerStore } from './features/terminal/controller'
import { CodexSettingsSection } from './settings/CodexSettingsSection'
import { installCodexSettingsIcon } from './settings/codex-settings-icon'
import { en, zh, type CodexKey } from './locales'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.codex': CodexKey
  }
}

const NS = 'settings.codex'

export const inject = ['slots', 'locale', 'connection', 'remote', 'sessions', 'workspaces', 'conversationEvents'] as const

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-codex: dictionaries')

  const scope = createCodexSettingsStore()
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

  const features = createCodexFeatureManager([
    createConversationCollapseFeature(ctx, scope, t),
    createNavigatorFeature(ctx, scope),
    createSidePanelsFeature(ctx, scope, t, terminalControllers),
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
      terminalControllers.dispose()
    }
  }, 'dsh-codex: feature manager')
}
