import type { Context } from '@deepseek-ai/cordis'
import type { PluginProfileManager } from '@just-genius/dsh-plugin-runtime'
import { PROTECTED_IDS } from './classify.ts'
import { collectInventory } from './inventory.ts'
import {
  SELF_ID,
  type ActionRequest,
  type ActionResult,
  type ManagedPlugin,
} from './types.ts'

export async function runAction(
  ctx: Context,
  profileManager: PluginProfileManager,
  request: ActionRequest,
): Promise<ActionResult> {
  const action = request.action
  if (action !== 'disable' && action !== 'enable' && action !== 'uninstall') {
    return { ok: false, error: 'Unknown action.' }
  }
  const snapshot = collectInventory(ctx)
  const plugin = findPlugin(snapshot.plugins, request)
  if (!plugin) return { ok: false, action, error: 'Plugin not found in the current inventory.' }

  if (action === 'disable') return disablePlugin(profileManager, plugin)
  if (action === 'enable') return enablePlugin(profileManager, plugin)
  return uninstallPlugin(profileManager, plugin)
}

function findPlugin(plugins: ManagedPlugin[], request: ActionRequest): ManagedPlugin | undefined {
  if (request.entryId) {
    const exact = plugins.find((plugin) => plugin.entryId === request.entryId)
    if (exact) return exact
  }
  if (request.packageName) {
    const lower = request.packageName.toLowerCase()
    return plugins.find((plugin) => plugin.packageName?.toLowerCase() === lower)
  }
  return undefined
}

async function disablePlugin(profileManager: PluginProfileManager, plugin: ManagedPlugin): Promise<ActionResult> {
  if (!plugin.canDisable) {
    return { ok: false, action: 'disable', entryId: plugin.entryId, error: denyMessage(plugin, 'disable') }
  }
  if (plugin.localId === SELF_ID) {
    await profileManager.setDisabled(plugin.localId, plugin.entryId, true)
    return { ok: true, action: 'disable', entryId: plugin.entryId, needsRestart: true }
  }
  const { live } = await profileManager.setDisabled(plugin.localId, plugin.entryId, true)
  return {
    ok: true,
    action: 'disable',
    entryId: plugin.entryId,
    needsRestart: !live,
    detail: live ? undefined : 'Disable is saved. Restart DSH if the plugin is still mounted.',
  }
}

async function enablePlugin(profileManager: PluginProfileManager, plugin: ManagedPlugin): Promise<ActionResult> {
  if (!plugin.canEnable) {
    return { ok: false, action: 'enable', entryId: plugin.entryId, error: denyMessage(plugin, 'enable') }
  }
  const { live } = await profileManager.setDisabled(plugin.localId, plugin.entryId, false)
  return {
    ok: true,
    action: 'enable',
    entryId: plugin.entryId,
    needsRestart: !live,
    detail: live ? undefined : 'Enable is saved. Restart DSH to mount it.',
  }
}

async function uninstallPlugin(profileManager: PluginProfileManager, plugin: ManagedPlugin): Promise<ActionResult> {
  if (!plugin.canUninstall || !plugin.packageName) {
    return { ok: false, action: 'uninstall', entryId: plugin.entryId, error: denyMessage(plugin, 'uninstall') }
  }
  if (PROTECTED_IDS.has(plugin.localId)) {
    return { ok: false, action: 'uninstall', entryId: plugin.entryId, error: 'This plugin is part of the DSH web surface.' }
  }
  try {
    const { detail, needsRestart } = await profileManager.remove(plugin.packageName)
    profileManager.removeDisable(plugin.localId)
    return {
      ok: true,
      action: 'uninstall',
      entryId: plugin.entryId,
      packageName: plugin.packageName,
      needsRestart,
      detail,
    }
  } catch (error) {
    return {
      ok: false,
      action: 'uninstall',
      entryId: plugin.entryId,
      packageName: plugin.packageName,
      error: 'Failed to run dsh plugin remove.',
      detail: String(error),
    }
  }
}

function denyMessage(plugin: ManagedPlugin, action: string): string {
  if (plugin.protectedReason === 'core') return 'This plugin is required by the DSH web surface.'
  if (plugin.protectedReason === 'session-owned') {
    return 'This row belongs to an agent preset. It is not enabled or disabled on the host plane.'
  }
  if (plugin.protectedReason === 'builtin' || (action === 'uninstall' && plugin.origin === 'builtin')) {
    return 'Built-in DSH plugins cannot be uninstalled from the profile.'
  }
  return `Cannot ${action} this plugin.`
}
