// Browser half of 随手笔记.
//
// Two surfaces, one store:
// - `shell.overlay` — the floating cards plus the search overlay;
// - `settings.section` — switches, shortcuts, and the library list.
//
// The floating card is the editor. Settings only manages the library.

import type { ClientContext, SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import { CLIENT_SERVICES, getSettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import { NotesSection, type NotesSectionInjected } from './NotesSection.tsx'
import { StickyLayer, type StickyLayerInjected } from './StickyLayer.tsx'
import { NotesStore } from './store.ts'
import { en, zh, type QuickNoteKey } from './locales.ts'
import { DEFAULT_CONFIG, SETTINGS_NAMESPACE, type NotesSnapshot, type QuickNotesConfig } from '../shared.ts'

declare module '@just-genius/dsh-plugin-runtime/client' {
  interface PluginLocaleNamespaceMap {
    'quick-notes': QuickNoteKey
  }
}

const NS = 'quick-notes'

export const inject = [
  CLIENT_SERVICES.slots,
  CLIENT_SERVICES.locale,
  CLIENT_SERVICES.settingsScope,
  CLIENT_SERVICES.remote,
  CLIENT_SERVICES.remoteSession,
] as const

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'quick-notes: dictionaries')
  const t = ctx.locale.bind(NS) as (key: QuickNoteKey) => string

  const store = new NotesStore(ctx)
  ctx.effect(() => () => store.dispose(), 'quick-notes: store')
  const onImport = (event: Event) => {
    const detail = (event as CustomEvent<{ createdId?: string; snapshot?: NotesSnapshot }>).detail
    const createdId = typeof detail?.createdId === 'string' ? detail.createdId : ''
    const snapshot = detail?.snapshot
    if (createdId === '' || snapshot == null || !Array.isArray(snapshot.notes)) return
    store.adoptImportedNote(snapshot, createdId)
  }
  window.addEventListener('dsh-quick-notes:import', onImport)
  ctx.effect(() => () => window.removeEventListener('dsh-quick-notes:import', onImport), 'quick-notes: import')

  const scope: SettingsScope<QuickNotesConfig> = getSettingsScope(ctx)
    .bind<QuickNotesConfig>({ namespace: SETTINGS_NAMESPACE })

  const configOf = (): QuickNotesConfig => ({ ...DEFAULT_CONFIG, ...scope.getSnapshot().value })

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'quick-notes',
    order: 90,
    locale: NS as never,
    inject: (): StickyLayerInjected => ({ store, t, scope, config: configOf() }),
  }, StickyLayer as never))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'quick-notes',
    order: 46,
    label: () => t('nav'),
    inject: (): NotesSectionInjected => ({ store, t, scope }),
  }, NotesSection as never))
}
