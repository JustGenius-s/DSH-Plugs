import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { createCodexFeatureManager } from './core/feature-manager'
import { createCodexSettingsStore } from './config/codex-settings-store'
import { createConversationCollapseFeature } from './features/conversation-collapse'
import { createFilesFeature } from './features/files'
import { createGitGraphFeature } from './features/git-graph'
import { createNavigatorFeature } from './features/navigator'
import { createSidePanelsFeature } from './features/side-panels'
import { createTerminalFeature } from './features/terminal'
import { CodexSettingsSection } from './settings/CodexSettingsSection'
import { installCodexSettingsIcon } from './settings/codex-settings-icon'
import { en, zh, type CodexKey } from './locales'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.codex': CodexKey
  }
}

const NS = 'settings.codex'

export const inject = ['slots', 'locale', 'connection', 'remote', 'sessions', 'conversationEvents'] as const

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

  const features = createCodexFeatureManager([
    createConversationCollapseFeature(ctx, scope, t),
    createNavigatorFeature(ctx, scope),
    createSidePanelsFeature(ctx, scope, t),
    createTerminalFeature(ctx, scope, t),
    createGitGraphFeature(ctx, scope, t),
    createFilesFeature(ctx, scope, t),
  ])
  ctx.effect(() => {
    features.activate()
    return () => features.dispose()
  }, 'dsh-codex: feature manager')
}
