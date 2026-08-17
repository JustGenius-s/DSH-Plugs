import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { HostContext } from './host-context.ts'
import { PROTECTED_IDS } from './classify.ts'
import { collectInventory } from './inventory.ts'
import { removeDisablePatch, writeDisablePatch } from './profile.ts'
import {
  SELF_ID,
  type ActionRequest,
  type ActionResult,
  type ManagedPlugin,
} from './types.ts'

const REMOVE_MS = 180_000

export async function runAction(ctx: Context, request: ActionRequest): Promise<ActionResult> {
  const action = request.action
  if (action !== 'disable' && action !== 'enable' && action !== 'uninstall') {
    return { ok: false, error: 'Unknown action.' }
  }
  const snapshot = collectInventory(ctx)
  const plugin = findPlugin(snapshot.plugins, request)
  if (!plugin) return { ok: false, action, error: 'Plugin not found in the current inventory.' }

  if (action === 'disable') return disablePlugin(ctx, plugin)
  if (action === 'enable') return enablePlugin(ctx, plugin)
  return uninstallPlugin(plugin)
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

async function disablePlugin(ctx: Context, plugin: ManagedPlugin): Promise<ActionResult> {
  if (!plugin.canDisable) {
    return { ok: false, action: 'disable', entryId: plugin.entryId, error: denyMessage(plugin, 'disable') }
  }
  writeDisablePatch(plugin.localId, true)
  if (plugin.localId === SELF_ID) {
    return { ok: true, action: 'disable', entryId: plugin.entryId, needsRestart: true }
  }
  const live = await applyLive(ctx, plugin.entryId, true)
  return {
    ok: true,
    action: 'disable',
    entryId: plugin.entryId,
    needsRestart: !live,
    detail: live ? undefined : 'Disable is saved. Restart DSH if the plugin is still mounted.',
  }
}

async function enablePlugin(ctx: Context, plugin: ManagedPlugin): Promise<ActionResult> {
  if (!plugin.canEnable) {
    return { ok: false, action: 'enable', entryId: plugin.entryId, error: denyMessage(plugin, 'enable') }
  }
  writeDisablePatch(plugin.localId, false)
  const live = await applyLive(ctx, plugin.entryId, false)
  return {
    ok: true,
    action: 'enable',
    entryId: plugin.entryId,
    needsRestart: !live,
    detail: live ? undefined : 'Enable is saved. Restart DSH to mount it.',
  }
}

async function uninstallPlugin(plugin: ManagedPlugin): Promise<ActionResult> {
  if (!plugin.canUninstall || !plugin.packageName) {
    return { ok: false, action: 'uninstall', entryId: plugin.entryId, error: denyMessage(plugin, 'uninstall') }
  }
  if (PROTECTED_IDS.has(plugin.localId)) {
    return { ok: false, action: 'uninstall', entryId: plugin.entryId, error: 'This plugin is part of the DSH web surface.' }
  }
  const bin = resolveDshBin()
  try {
    const { code, stdout, stderr } = await run(bin, ['plugin', '--profile', 'web', 'remove', plugin.packageName], REMOVE_MS)
    const detail = [stdout, stderr].filter(Boolean).join('\n').trim().slice(0, 4000)
    if (code !== 0) {
      return {
        ok: false,
        action: 'uninstall',
        entryId: plugin.entryId,
        packageName: plugin.packageName,
        error: `dsh plugin remove exited ${code}.`,
        detail,
      }
    }
    removeDisablePatch(plugin.localId)
    return {
      ok: true,
      action: 'uninstall',
      entryId: plugin.entryId,
      packageName: plugin.packageName,
      needsRestart: true,
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

async function applyLive(ctx: Context, entryId: string, disabled: boolean): Promise<boolean> {
  if (entryId.startsWith('profile:')) return false
  try {
    await (ctx as HostContext).loader.update(entryId, { disabled })
    return true
  } catch {
    return false
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

export function resolveDshBin(): string {
  if (process.env.DSH_BIN) return process.env.DSH_BIN
  const argv1 = process.argv[1] ?? ''
  if (argv1.endsWith(`${join('dsh', 'lib', 'bin.js')}`)) {
    const shim = join(argv1, '..', '..', '..', '.bin', 'dsh')
    if (existsSync(shim)) return shim
  }
  if (argv1.endsWith(`${join('.bin', 'dsh')}`) && existsSync(argv1)) return argv1
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const candidate = join(home, 'runtime', 'node_modules', '.bin', 'dsh')
  if (existsSync(candidate)) return candidate
  return 'dsh'
}

function run(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
  })
}
