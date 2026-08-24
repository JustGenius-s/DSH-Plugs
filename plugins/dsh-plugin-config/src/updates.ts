import type { PluginProfileManager } from '@just-genius/dsh-plugin-runtime'
import { isNpmRegistrySpec } from './npm-deps.ts'
import { readProfilePackage } from './profile.ts'
import { moduleShortName } from './classify.ts'
import type { OutdatedSnapshot, PluginUpdate, UpdateOutcome } from './types.ts'

/**
 * List npm-registry profile deps that pnpm reports as outdated.
 * GitHub / link / tarball installs are excluded — only registry specs update.
 */
export async function collectOutdated(profileManager: PluginProfileManager): Promise<OutdatedSnapshot> {
  const deps = readProfilePackage().dependencies ?? {}
  const npmNames = Object.entries(deps)
    .filter(([, spec]) => isNpmRegistrySpec(spec))
    .map(([name]) => name)

  if (npmNames.length === 0) {
    return { updates: [], checkedAt: new Date().toISOString() }
  }

  const parsed = await profileManager.outdated(npmNames)

  const updates: PluginUpdate[] = []
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const npmSet = new Set(npmNames.map((name) => name.toLowerCase()))
    for (const [packageName, info] of Object.entries(parsed as Record<string, unknown>)) {
      if (!npmSet.has(packageName.toLowerCase())) continue
      if (info === null || typeof info !== 'object') continue
      const row = info as Record<string, unknown>
      const current = typeof row.current === 'string' ? row.current : ''
      const latest = typeof row.latest === 'string' ? row.latest : ''
      const wanted = typeof row.wanted === 'string' ? row.wanted : latest
      if (current === '' || latest === '' || current === latest) continue
      updates.push({
        packageName,
        shortName: moduleShortName(packageName),
        current,
        wanted,
        latest,
      })
    }
  }

  updates.sort((left, right) => left.shortName.localeCompare(right.shortName))
  return { updates, checkedAt: new Date().toISOString() }
}

/** Bump one npm-registry profile dep to latest via `dsh plugin update --latest`. */
export async function updateNpmPackage(
  profileManager: PluginProfileManager,
  packageName: string,
): Promise<UpdateOutcome> {
  const trimmed = packageName.trim()
  if (trimmed === '') return { ok: false, error: 'Missing package name.' }

  const deps = readProfilePackage().dependencies ?? {}
  const entry = Object.entries(deps).find(([name]) => name.toLowerCase() === trimmed.toLowerCase())
  if (!entry) {
    return { ok: false, packageName: trimmed, error: 'Package is not in the web profile.' }
  }
  const [resolvedName, spec] = entry
  if (!isNpmRegistrySpec(spec)) {
    return {
      ok: false,
      packageName: resolvedName,
      error: 'Only npm registry installs can be updated from this panel.',
    }
  }

  try {
    const { detail, needsRestart } = await profileManager.update(resolvedName)
    return {
      ok: true,
      packageName: resolvedName,
      needsRestart,
      detail,
    }
  } catch (error) {
    return {
      ok: false,
      packageName: resolvedName,
      error: 'Failed to run dsh plugin update.',
      detail: String(error),
    }
  }
}
