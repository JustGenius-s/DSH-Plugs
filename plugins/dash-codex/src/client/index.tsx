import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SETTINGS_NAMESPACE, type DashCodexConfig } from '../shared/config'
import { createCodexFeatureManager } from './core/feature-manager'
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

export const inject = ['slots', 'locale', 'settingsScope', 'connection', 'remote', 'sessions'] as const

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dash-codex: dictionaries')

  const binder = ctx.get('settingsScope') as SettingsScopeBinder
  const scope = binder.bind<DashCodexConfig>({
    namespace: SETTINGS_NAMESPACE,
    decode: decodeConfig,
  })
  const t = ctx.locale.bind(NS) as (key: CodexKey) => string

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'codex',
    order: 30,
    label: () => t('nav'),
    inject: () => ({ scope, t }),
  }, CodexSettingsSection))
  ctx.effect(() => installCodexSettingsIcon(() => t('nav')), 'dash-codex: settings icon')

  const features = createCodexFeatureManager([
    createNavigatorFeature(ctx, scope),
    createSidePanelsFeature(ctx, scope, t),
    createTerminalFeature(ctx, scope, t),
  ])
  ctx.effect(() => {
    features.activate()
    return () => features.dispose()
  }, 'dash-codex: feature manager')
}

function decodeConfig(value: unknown): DashCodexConfig | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<DashCodexConfig>
  if (typeof candidate.navigatorEnabled !== 'boolean') return undefined
  if (typeof candidate.terminalEnabled !== 'boolean') return undefined
  if (candidate.terminalShell !== 'auto' && candidate.terminalShell !== 'bash' && candidate.terminalShell !== 'zsh') return undefined
  if (typeof candidate.terminalScrollback !== 'number' || !Number.isFinite(candidate.terminalScrollback)) return undefined
  if (typeof candidate.terminalFontSize !== 'number' || !Number.isFinite(candidate.terminalFontSize)) return undefined
  if (typeof candidate.panelDefaultWidth !== 'number' || !Number.isFinite(candidate.panelDefaultWidth)) return undefined
  if (typeof candidate.panelRememberTabs !== 'boolean') return undefined
  return {
    navigatorEnabled: candidate.navigatorEnabled,
    terminalEnabled: candidate.terminalEnabled,
    terminalShell: candidate.terminalShell,
    terminalScrollback: candidate.terminalScrollback,
    terminalFontSize: candidate.terminalFontSize,
    panelDefaultWidth: candidate.panelDefaultWidth,
    panelRememberTabs: candidate.panelRememberTabs,
  }
}
