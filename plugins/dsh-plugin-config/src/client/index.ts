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
import {
  AGENT_ACTION_PATH,
  AGENT_AUTH_PATH,
  AGENT_CATALOG_PATH,
  AGENT_CONFIGURE_PATH,
  AGENT_INSTALL_PATH,
  AGENT_INSTALLED_PATH,
  AGENT_OAUTH_START_PATH,
  AGENT_OAUTH_STATUS_PATH,
  type AgentOAuthStartResult,
  type AgentOAuthStatusResult,
  type AgentOpResult,
} from '../agent/types.ts'
import type { AgentCatalogEntry, AgentInstalledEntry } from './AgentPacksSection.tsx'

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

  const loadAgentCatalog = async (): Promise<AgentCatalogEntry[]> => {
    const value = await requestJson<{ ok: boolean; plugins?: AgentCatalogEntry[]; error?: string }>(AGENT_CATALOG_PATH)
    if (!value.ok || !Array.isArray(value.plugins)) {
      throw new Error(value.error ?? 'agent catalog failed')
    }
    return value.plugins
  }

  const loadAgentInstalled = async (): Promise<AgentInstalledEntry[]> => {
    const value = await requestJson<{ ok: boolean; plugins?: AgentInstalledEntry[]; error?: string }>(AGENT_INSTALLED_PATH)
    if (!value.ok || !Array.isArray(value.plugins)) {
      throw new Error(value.error ?? 'agent installed failed')
    }
    return value.plugins
  }

  const installAgentPack = async (pluginId: string): Promise<AgentOpResult> => {
    try {
      return await postJson<AgentOpResult>(AGENT_INSTALL_PATH, { pluginId })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const runAgentAction = async (
    action: 'enable' | 'disable' | 'uninstall',
    pluginId: string,
  ): Promise<AgentOpResult> => {
    try {
      return await postJson<AgentOpResult>(AGENT_ACTION_PATH, { action, pluginId })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const configureAgentPack = async (
    pluginId: string,
    variables: Record<string, string | boolean | number>,
  ): Promise<AgentOpResult> => {
    try {
      return await postJson<AgentOpResult>(AGENT_CONFIGURE_PATH, { pluginId, variables })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const setAgentAuth = async (payload: {
    pluginId: string
    token?: string
    secrets?: Record<string, string>
    logout?: boolean
  }): Promise<AgentOpResult> => {
    try {
      return await postJson<AgentOpResult>(AGENT_AUTH_PATH, payload)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const startAgentOAuth = async (pluginId: string): Promise<AgentOAuthStartResult> => {
    try {
      return await postJson<AgentOAuthStartResult>(AGENT_OAUTH_START_PATH, { pluginId })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const pollAgentOAuth = async (pluginId: string): Promise<AgentOAuthStatusResult> => {
    try {
      return await postJson<AgentOAuthStatusResult>(AGENT_OAUTH_STATUS_PATH, { pluginId })
    } catch (error) {
      return {
        ok: false,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      }
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
    loadAgentCatalog,
    loadAgentInstalled,
    installAgentPack,
    runAgentAction,
    configureAgentPack,
    setAgentAuth,
    startAgentOAuth,
    pollAgentOAuth,
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
