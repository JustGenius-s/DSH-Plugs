import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import {
  CATALOG_PATH,
  CATALOG_URL,
  INSTALL_PATH,
  dshPlugsRemotePlugins,
  emptyRemoteCatalog,
  ensureDshPlugs,
  mergeCatalogs,
  parseCatalog,
  type Catalog,
} from '../catalog.ts'
import { MarketplaceTab, type InstallOutcome, type MarketplaceTabInjected } from './MarketplaceTab.tsx'
import { en, zh, type MarketplaceKey } from './locales.ts'
import type { InventoryEntry } from './match.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.pluginMarketplace': MarketplaceKey
  }
}

const NS = 'settings.pluginMarketplace'

export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory'] as const

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plugin-marketplace: dictionaries')
  const t = ctx.locale.bind(NS)

  const loadCatalog = async (): Promise<Catalog> => {
    try {
      const response = await fetch(CATALOG_PATH, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      if (response.ok) return ensureDshPlugs(parseCatalog(await response.json()))
    } catch {
      // Fall through: merge this repo's GitHub entries with the public registry.
    }
    let remote = emptyRemoteCatalog()
    try {
      const response = await fetch(CATALOG_URL, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      if (response.ok) remote = parseCatalog(await response.json())
    } catch {
      // Local GitHub entries still render if awesome-dsh-plugin is unreachable.
    }
    return mergeCatalogs(dshPlugsRemotePlugins(), remote)
  }

  const listInstalled = async (): Promise<InventoryEntry[]> => {
    const result = await ctx.remote.pluginInventory.list()
    if (!result.ok) return []
    return result.value.entries.map((entry) => ({
      entryId: String(entry.entryId),
      moduleName: String(entry.moduleName),
      enabled: Boolean(entry.enabled),
    }))
  }

  const installPlugin = async (spec: string): Promise<InstallOutcome> => {
    const response = await fetch(INSTALL_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ spec }),
    })
    const value = await response.json() as InstallOutcome
    if (typeof value.ok !== 'boolean') {
      return { ok: false, error: `install failed: ${response.status}` }
    }
    return value
  }

  const injected = (): MarketplaceTabInjected => ({
    loadCatalog,
    listInstalled,
    installPlugin,
    getLocale: () => ctx.locale.getLocale().active,
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'marketplace',
    order: 5,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, MarketplaceTab as never))
}
