// Browser half of @just-genius/dsh-desktop-update.
//
// Registers the `desktop-update` settings card into the Plugins section's
// configurable tab (`settings.plugin.item`; on older hosts the
// card simply never dispatches) and, when the desktop shell is present, uses
// the three-family `window.dshDesktop` API: `seats` for applicationMenu +
// tray, `notify` for system notifications. A plain browser has no
// `dshDesktop` and the native half stays inert.

import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import { CLIENT_SERVICES, getSettingsScope } from '@just-genius/dsh-plugin-runtime/client'

import { UpdateCard, type DesktopUpdateConfig } from './card'
import { installDesktopSeats } from './seats'

/** Client services this plugin requires before `apply` runs. */
export const inject = [
  CLIENT_SERVICES.slots,
  CLIENT_SERVICES.locale,
  CLIENT_SERVICES.connection,
  CLIENT_SERVICES.remote,
  CLIENT_SERVICES.settingsScope,
] as const

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
  'channel.dsh': 'DSH 更新渠道',
  'channel.dshHint': '选择匹配 DSH 运行时的版本来源。',
  'channel.latest': '稳定版（latest）',
  'channel.next': '预发布（next）',
  'channel.custom': '指定版本',
  'channel.note': '保存后立即按所选渠道重新检测一次。',
  'version.custom': '目标版本',
  'version.customHint': '精确匹配的 npm 版本，例如 0.1.0-rc.8。',
  'version.app': 'DSH-Desktop',
  'version.dsh': 'DSH 运行时',
  'action.check': '检查更新',
  'action.checking': '检查中…',
  'action.testNotify': '测试通知',
  'action.testNotifyBody': '这是一条来自 DSH-Desktop 的测试通知。',
  'action.testNotifyDone': '已发送测试通知 ✓',
  'action.testNotifySuppressed': '通知被系统拦截（shown=false），请检查系统通知权限。',
  'action.testNotifyFailed': '发送测试通知失败。',
  'action.updateDsh': '更新运行时',
  'action.updatingDsh': '更新中…',
  'action.relaunch': '立即重启',
  'status.updating': '正在更新 DSH 运行时…',
  'status.needsRelaunch': '新运行时已安装，重启后生效。',
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
  'channel.dsh': 'DSH update channel',
  'channel.dshHint': 'Choose where DSH runtime versions are matched from.',
  'channel.latest': 'Stable (latest)',
  'channel.next': 'Prerelease (next)',
  'channel.custom': 'Pin version',
  'channel.note': 'Saving re-checks immediately on the chosen channel.',
  'version.custom': 'Target version',
  'version.customHint': 'Exact npm version to match, e.g. 0.1.0-rc.8.',
  'version.app': 'DSH-Desktop',
  'version.dsh': 'DSH runtime',
  'action.check': 'Check now',
  'action.checking': 'Checking…',
  'action.testNotify': 'Test notification',
  'action.testNotifyBody': 'This is a test notification from DSH-Desktop.',
  'action.testNotifyDone': 'Test notification sent ✓',
  'action.testNotifySuppressed': 'Notification was suppressed (shown=false). Check notification permission.',
  'action.testNotifyFailed': 'Failed to send test notification.',
  'action.updateDsh': 'Update runtime',
  'action.updatingDsh': 'Updating…',
  'action.relaunch': 'Restart now',
  'status.updating': 'Updating DSH runtime…',
  'status.needsRelaunch': 'New runtime installed. Restart to apply.',
}

export function apply(ctx: ClientContext): void {
  // Free-form overload: our dictionary namespace is plugin-owned, not part of
  // the built-in LocaleNamespaceMap.
  ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'desktop-update: zh dictionary')
  ctx.effect(() => ctx.locale.register(NS, 'en', en), 'desktop-update: en dictionary')
  ctx.effect(() => installDesktopSeats(), 'desktop-update: native seats')

  // Bound on this fiber: disposal, invalidation subscriptions, and the
  // initial Host read are owned by the binder's ctx.effect.
  const scope = getSettingsScope(ctx).bind<DesktopUpdateConfig>({ namespace: SETTINGS_NS })
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
