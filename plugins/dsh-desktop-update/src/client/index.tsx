// Browser half of @just-genius/dsh-desktop-update.
//
// Renders the sidebar update badge (`sidebar.footer.action`) and, when the
// desktop shell is present, uses the three-family `window.dshDesktop` API:
// `updates` for check/download/upgrade/relaunch, `seats` for applicationMenu
// + tray, `notify` for system notifications. A plain browser has no
// `dshDesktop` and this half stays inert.

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Declares the sidebar slot names (sidebar.footer.action among them).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

import { UpdateBadge } from './badge'
import { installDesktopSeats } from './seats'

/** Client services this plugin requires before `apply` runs. */
export const inject = ['slots', 'locale'] as const

/** Dictionary namespace owned by this plugin. */
const NS = 'desktop-update'

const zh = {
  'badge.title': '有可用更新',
  'badge.label': '更新',
  'badge.quiet.title': '版本与更新设置',
  'panel.title': '软件更新',
  'panel.app': 'DSH-Desktop',
  'panel.dsh': 'DSH 运行时',
  'action.update.to': '更新到',
  'action.updating': '正在更新…',
  'action.restart': '重启生效',
  'action.skip': '跳过',
  'gate.app': '自动检查桌面更新',
  'gate.dsh': '自动检查 DSH 更新',
  'state.failed': '更新失败，请稍后重试',
  'state.done': '更新完成，重启应用后生效',
}

const en: Record<keyof typeof zh, string> = {
  'badge.title': 'Update available',
  'badge.label': 'Update',
  'badge.quiet.title': 'Versions & update settings',
  'panel.title': 'Software updates',
  'panel.app': 'DSH-Desktop',
  'panel.dsh': 'DSH runtime',
  'action.update.to': 'Update to',
  'action.updating': 'Updating…',
  'action.restart': 'Restart to apply',
  'action.skip': 'Skip',
  'gate.app': 'Check for app updates',
  'gate.dsh': 'Check for DSH updates',
  'state.failed': 'Update failed, please retry later',
  'state.done': 'Update installed — restart the app to apply',
}

export function apply(ctx: Context) {
  // Free-form overload: our dictionary namespace is plugin-owned, not part of
  // the built-in LocaleNamespaceMap.
  ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'desktop-update: zh dictionary')
  ctx.effect(() => ctx.locale.register(NS, 'en', en), 'desktop-update: en dictionary')
  ctx.effect(() => installDesktopSeats(), 'desktop-update: native seats')
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      {
        name: 'sidebar.footer.action',
        id: 'desktop-update',
        order: 0,
        // Plugin-owned dictionary namespace; the upstream locale union only
        // lists built-in namespaces, so widen here (same escape hatch the
        // locale service's free-form register overload documents).
        locale: NS as never,
      },
      UpdateBadge as never,
    ),
  )
}
