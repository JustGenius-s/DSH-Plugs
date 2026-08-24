import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginProfileManager } from '@just-genius/dsh-plugin-runtime'
import { catalogEntry, classifyInstallSpec } from './catalog.ts'
import type { InstallOutcome, ProfilePatch } from './types.ts'
import { loadMarketplaceCatalog } from './host-catalog.ts'

export async function installCatalogSpec(
  profileManager: PluginProfileManager,
  spec: string,
): Promise<InstallOutcome> {
  const trimmed = spec.trim()
  if (trimmed === '') {
    return { ok: false, error: 'Missing install spec.' }
  }

  let catalog
  try {
    catalog = await loadMarketplaceCatalog(true)
  } catch (error) {
    return {
      ok: false,
      error: 'Could not refresh the catalog to verify this plugin.',
      detail: String(error),
    }
  }
  const entry = catalogEntry(catalog, trimmed)
  if (entry === undefined) {
    return { ok: false, error: 'That plugin is not in the current marketplace catalog.' }
  }

  const kind = classifyInstallSpec(trimmed)
  if (kind === null) {
    return {
      ok: false,
      error: 'Unsupported install spec. Use npm package, github:, local path, or https tarball URL.',
    }
  }
  if (kind === 'local' && !existsSync(join(trimmed, 'package.json'))) {
    return { ok: false, spec: trimmed, error: 'Local plugin folder is missing package.json.' }
  }

  try {
    const { detail, needsRestart } = await profileManager.install(trimmed)
    if (entry.profilePatches && entry.profilePatches.length > 0) {
      await applyProfilePatches(profileManager, entry.profilePatches)
    }
    return { ok: true, spec: trimmed, needsRestart, detail }
  } catch (error) {
    return { ok: false, spec: trimmed, error: 'Failed to run dsh plugin add.', detail: String(error) }
  }
}

async function applyProfilePatches(
  profileManager: PluginProfileManager,
  patches: ProfilePatch[],
): Promise<void> {
  for (const patch of patches) {
    if (patch.disabled !== true) continue
    await profileManager.setDisabled(patch.id, patch.id, true)
  }
}
