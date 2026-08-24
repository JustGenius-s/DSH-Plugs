import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SyncSection } from './SyncSection.tsx'
import type { SyncSectionInjected } from './SyncSection.tsx'
import { installSyncSettingsIcon } from './sync-settings-icon.ts'
import { en, zh, type SyncKey } from './locales.ts'
import { SyncController } from './sync-controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    sync: SyncKey
  }
}

const NS = 'sync'

export const inject = ['slots', 'locale'] as const

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-sync: dictionaries')

  const t = ctx.locale.bind(NS) as SyncSectionInjected['t']
  const controller = new SyncController(t)
  ctx.effect(() => () => controller.dispose(), 'dsh-sync: controller')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'sync',
    order: 46,
    label: () => t('nav'),
    inject: () => ({ t, controller }),
  }, SyncSection))
  ctx.effect(() => installSyncSettingsIcon(() => t('nav')), 'dsh-sync: settings icon')
}
