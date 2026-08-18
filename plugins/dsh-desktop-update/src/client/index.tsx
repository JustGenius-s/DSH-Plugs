// Browser half of @just-genius/dsh-desktop-update.
//
// Registers the `desktop-update` settings card into the Plugins section's
// configurable tab (rc.7+ keyed `settings.plugin.item`; on older hosts the
// card simply never dispatches) and, when the desktop shell is present, uses
// the three-family `window.dshDesktop` API: `seats` for applicationMenu +
// tray, `notify` for system notifications. A plain browser has no
// `dshDesktop` and the native half stays inert.

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.settingsScope Context merge (the implementation lives
// in the Settings surface; binding happens on this plugin's fiber).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the keyed `settings.plugin.item` slot declaration (rc.7+).
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'

import { UpdateCard, type DesktopUpdateConfig } from './card'
import { installDesktopSeats } from './seats'

/** Client services this plugin requires before `apply` runs. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope'] as const

/** Dictionary namespace owned by this plugin. */
const NS = 'desktop-update'

/** Settings namespace this card edits (mirrors SETTINGS_NS in src/index.ts). */
const SETTINGS_NS = 'desktop-update'

const zh = {
  'card.title': '软件更新',
  'card.description': 'DSH-Desktop 与 DSH 运行时的版本与自动检查。',
  'card.expand': '展开',
  'card.collapse': '折叠',
  'card.unsaved': '未保存',
  'card.readOnly': '当前设置文档为只读，无法保存修改。',
  'card.save': '保存',
  'card.saving': '保存中…',
  'card.discard': '放弃',
  'card.saveFailed': '保存失败，请重试。',
  'gate.app': '自动检查桌面更新',
  'gate.appHint': '定期检查 DSH-Desktop 新版本（GitHub Releases）。',
  'gate.dsh': '自动检查 DSH 更新',
  'gate.dshHint': '定期检查 DSH 运行时新版本（npm registry）。',
  'version.app': 'DSH-Desktop',
  'version.dsh': 'DSH 运行时',
  'action.check': '检查更新',
  'action.checking': '检查中…',
}

const en: Record<keyof typeof zh, string> = {
  'card.title': 'Software updates',
  'card.description': 'Versions and automatic checks for DSH-Desktop and the DSH runtime.',
  'card.expand': 'Expand',
  'card.collapse': 'Collapse',
  'card.unsaved': 'Unsaved',
  'card.readOnly': 'The settings document is read-only; changes cannot be saved.',
  'card.save': 'Save',
  'card.saving': 'Saving…',
  'card.discard': 'Discard',
  'card.saveFailed': 'Save failed, please retry.',
  'gate.app': 'Check for app updates',
  'gate.appHint': 'Periodically check GitHub Releases for a newer DSH-Desktop.',
  'gate.dsh': 'Check for DSH updates',
  'gate.dshHint': 'Periodically check the npm registry for a newer DSH runtime.',
  'version.app': 'DSH-Desktop',
  'version.dsh': 'DSH runtime',
  'action.check': 'Check now',
  'action.checking': 'Checking…',
}

export function apply(ctx: ClientContext): void {
  // Free-form overload: our dictionary namespace is plugin-owned, not part of
  // the built-in LocaleNamespaceMap.
  ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'desktop-update: zh dictionary')
  ctx.effect(() => ctx.locale.register(NS, 'en', en), 'desktop-update: en dictionary')
  ctx.effect(() => installDesktopSeats(), 'desktop-update: native seats')

  // Bound on this fiber: disposal, invalidation subscriptions, and the
  // initial Host read are owned by the binder's ctx.effect.
  const scope = ctx.settingsScope.bind<DesktopUpdateConfig>({ namespace: SETTINGS_NS })
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register(
      {
        name: 'settings.plugin.item',
        key: SETTINGS_NS,
        // Plugin-owned dictionary namespace; widen as with the free-form
        // locale register overload above.
        locale: NS as never,
        inject: () => ({ scope }),
      },
      UpdateCard as never,
    ),
  )
}
