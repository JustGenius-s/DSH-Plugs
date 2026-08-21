import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import {
  ACTION_PATH,
  INVENTORY_PATH,
  OUTDATED_PATH,
  UPDATE_PATH,
  type ActionResult,
  type InventorySnapshot,
  type ManagedPlugin,
  type OutdatedSnapshot,
  type PluginAction,
  type UpdateOutcome,
} from '../types.ts'
import { CATALOG_PATH, CATALOG_URL, INSTALL_PATH, type Catalog, type InstallOutcome } from '../market/types.ts'
import { emptyCatalog, parseCatalog } from '../market/catalog.ts'
import { PluginsTab, type PluginsTabInjected } from './PluginsTab.tsx'
import { en, zh, type PluginsKey } from './locales.ts'
import type { InventoryEntry } from './match.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.pluginConfig': PluginsKey
  }
}

const NS = 'settings.pluginConfig'

export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory'] as const

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plugin-config: dictionaries')
  const t = ctx.locale.bind(NS)

  const loadInventory = async (): Promise<InventorySnapshot> => {
    const response = await fetch(INVENTORY_PATH, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`inventory failed: ${response.status}`)
    const value = await response.json() as InventorySnapshot
    if (!Array.isArray(value.plugins)) throw new Error('inventory failed: bad payload')
    return value
  }

  const runAction = async (action: PluginAction, plugin: ManagedPlugin): Promise<ActionResult> => {
    const response = await fetch(ACTION_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        action,
        entryId: plugin.entryId,
        packageName: plugin.packageName,
      }),
    })
    const value = await response.json() as ActionResult
    if (typeof value.ok !== 'boolean') {
      return { ok: false, error: `${t('actionFail')}: ${response.status}` }
    }
    return value
  }

  const loadCatalog = async (): Promise<Catalog> => {
    try {
      const response = await fetch(CATALOG_PATH, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      if (response.ok) return parseCatalog(await response.json())
    } catch {
      // Fall through to direct registry fetch.
    }
    try {
      const response = await fetch(CATALOG_URL, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      if (response.ok) return parseCatalog(await response.json())
    } catch {
      // Empty catalog below.
    }
    return emptyCatalog()
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

  const loadOutdated = async (): Promise<OutdatedSnapshot> => {
    const response = await fetch(OUTDATED_PATH, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) {
      let detail = `outdated failed: ${response.status}`
      try {
        const body = await response.json() as { detail?: unknown; error?: unknown }
        const parts = [body.error, body.detail].filter((value) => typeof value === 'string')
        if (parts.length > 0) detail = parts.join('\n')
      } catch {
        // keep status text
      }
      throw new Error(detail)
    }
    const value = await response.json() as OutdatedSnapshot
    if (!Array.isArray(value.updates)) throw new Error('outdated failed: bad payload')
    return value
  }

  const updatePackage = async (packageName: string): Promise<UpdateOutcome> => {
    const response = await fetch(UPDATE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ packageName }),
    })
    const value = await response.json() as UpdateOutcome
    if (typeof value.ok !== 'boolean') {
      return { ok: false, error: `update failed: ${response.status}` }
    }
    return value
  }

  const injected = (): PluginsTabInjected => ({
    loadInventory,
    runAction,
    loadOutdated,
    updatePackage,
    loadCatalog,
    listInstalled,
    installPlugin,
    getLocale: () => ctx.locale.getLocale().active,
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'all',
    order: 10,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, PluginsTab as never))
}
