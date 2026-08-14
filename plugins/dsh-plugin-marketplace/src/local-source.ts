import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CatalogPlugin } from './catalog.ts'
import {
  DSH_PLUGS_PLUGINS,
  DSH_PLUGS_SOURCE,
  githubPathSpec,
  pluginUrl,
  type DshPlugsPluginDef,
} from './dsh-plugs.ts'

/** Directory that contains this plugin's `package.json`. */
function thisPluginDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return basename(here) === 'lib' ? dirname(here) : here
}

/**
 * When this package is linked from the DSH-Plugs monorepo, return the
 * sibling `plugins/` directory. npm installs have no siblings to scan.
 */
export function resolveMonorepoPluginsDir(): string | null {
  const pluginsDir = dirname(thisPluginDir())
  if (basename(pluginsDir) !== 'plugins') return null
  const root = dirname(pluginsDir)
  if (!existsSync(join(root, 'pnpm-workspace.yaml'))) return null
  return pluginsDir
}

export function loadDshPlugsPlugins(): CatalogPlugin[] {
  const pluginsDir = resolveMonorepoPluginsDir()
  const known = new Map(DSH_PLUGS_PLUGINS.map((def) => [def.folder, def]))
  const out: CatalogPlugin[] = []

  for (const def of DSH_PLUGS_PLUGINS) {
    const localDir = pluginsDir === null ? null : join(pluginsDir, def.folder)
    const local = localDir !== null && existsSync(join(localDir, 'package.json')) ? localDir : null
    out.push(toPlugin(def, local))
  }

  if (pluginsDir === null) return out

  for (const folder of readdirSync(pluginsDir)) {
    if (known.has(folder)) continue
    const pkgPath = join(pluginsDir, folder, 'package.json')
    if (!existsSync(pkgPath)) continue
    let pkg: { name?: string; description?: string; dsh?: { bundle?: { patch?: string } } }
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as typeof pkg
    } catch {
      continue
    }
    if (pkg.dsh?.bundle?.patch === undefined || typeof pkg.name !== 'string') continue
    const description = typeof pkg.description === 'string' && pkg.description !== ''
      ? pkg.description
      : folder
    const def: DshPlugsPluginDef = {
      folder,
      packageName: pkg.name,
      category: 'ui',
      description: { en: description, zh: description },
    }
    out.push(toPlugin(def, join(pluginsDir, folder)))
  }

  return out
}

function toPlugin(def: DshPlugsPluginDef, localDir: string | null): CatalogPlugin {
  const spec = localDir ?? githubPathSpec(def.folder)
  return {
    name: def.folder,
    packageName: def.packageName,
    owner: 'Rory-X',
    url: pluginUrl(def.folder),
    category: def.category,
    description: def.description,
    install: `dsh plugin --profile web add ${spec}`,
    spec,
    source: DSH_PLUGS_SOURCE,
    added: '',
    profilePatches: def.profilePatches,
  }
}
