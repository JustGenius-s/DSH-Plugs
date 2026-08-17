import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ACTION_PATH, INVENTORY_PATH, type ActionResult, type InventorySnapshot, type ManagedPlugin, type PluginAction } from '../types.ts'
import { ManageTab, type ManageTabInjected } from './ManageTab.tsx'
import { en, zh, type ConfigKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.pluginConfig': ConfigKey
  }
}

const NS = 'settings.pluginConfig'

export const inject = ['slots', 'locale'] as const

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

  const injected = (): ManageTabInjected => ({ loadInventory, runAction })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'all',
    order: 10,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, ManageTab as never))
}
