import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import { CLIENT_SERVICES } from '@just-genius/dsh-plugin-runtime/client'

import { ArchiveSection } from './ArchiveSection'
import type { ArchiveSectionInjected } from './ArchiveSection'
import { installArchiveSettingsIcon } from './archive-settings-icon'
import { installSidebarArchiveNoConfirm } from './sidebar-archive'
import { en, zh, type ArchiveKey } from './locales'

declare module '@just-genius/dsh-plugin-runtime/client' {
  interface PluginLocaleNamespaceMap {
    'session.archive': ArchiveKey
  }
}

const NS = 'session.archive'

export const inject = [CLIENT_SERVICES.slots, CLIENT_SERVICES.locale] as const

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-archive: dictionaries')

  const t = ctx.locale.bind(NS) as ArchiveSectionInjected['t']

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'session-archive',
    order: 47,
    label: () => t('nav'),
    inject: () => ({ t }),
  }, ArchiveSection))
  ctx.effect(() => installArchiveSettingsIcon(() => t('nav')), 'dsh-session-archive: settings icon')
  ctx.effect(() => installSidebarArchiveNoConfirm(), 'dsh-session-archive: sidebar archive without confirm')
}
