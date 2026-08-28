import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import { CLIENT_SERVICES, getRemote } from '@just-genius/dsh-plugin-runtime/client'
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
import { requestJson, postJson } from '@just-genius/dsh-plugin-runtime/client'

declare module '@just-genius/dsh-plugin-runtime/client' {
  interface PluginLocaleNamespaceMap {
    'settings.pluginConfig': PluginsKey
  }
}

const NS = 'settings.pluginConfig'

export const inject = [
  CLIENT_SERVICES.slots,
  CLIENT_SERVICES.locale,
  CLIENT_SERVICES.remote,
  CLIENT_SERVICES.remotePluginInventory,
] as const

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plugin-config: dictionaries')
  const t = ctx.locale.bind(NS)
  const remote = getRemote(ctx)

  const loadInventory = async (): Promise<InventorySnapshot> => {
    const value = await requestJson<InventorySnapshot>(INVENTORY_PATH)
    if (!Array.isArray(value.plugins)) throw new Error('inventory failed: bad payload')
    return value
  }

  const runAction = async (action: PluginAction, plugin: ManagedPlugin): Promise<ActionResult> => {
    try {
      return await postJson<ActionResult>(ACTION_PATH, {
        action,
        entryId: plugin.entryId,
        packageName: plugin.packageName,
      })
    } catch (error) {
      return { ok: false, error: `${t('actionFail')}: ${error instanceof Error ? error.message : String(error)}` }
    }
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
    const result = await remote.pluginInventory.list()
    if (!result.ok) return []
    return result.value.entries.map((entry) => ({
      entryId: String(entry.entryId),
      moduleName: String(entry.moduleName),
      enabled: Boolean(entry.enabled),
    }))
  }

  const installPlugin = async (spec: string): Promise<InstallOutcome> => {
    try {
      return await postJson<InstallOutcome>(INSTALL_PATH, { spec })
    } catch (error) {
      return { ok: false, error: `install failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  const loadOutdated = async (): Promise<OutdatedSnapshot> => {
    const value = await requestJson<OutdatedSnapshot>(OUTDATED_PATH)
    if (!Array.isArray(value.updates)) throw new Error('outdated failed: bad payload')
    return value
  }

  const updatePackage = async (packageName: string): Promise<UpdateOutcome> => {
    try {
      return await postJson<UpdateOutcome>(UPDATE_PATH, { packageName })
    } catch (error) {
      return { ok: false, error: `update failed: ${error instanceof Error ? error.message : String(error)}` }
    }
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
