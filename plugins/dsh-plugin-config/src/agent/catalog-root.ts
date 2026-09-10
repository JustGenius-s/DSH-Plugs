import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Builtin catalog root shipped next to this plugin package. */
export function builtinCatalogRoot(here = import.meta.url): string {
  return resolveCatalogRoot(dirname(fileURLToPath(here)))
}

/**
 * Walk up from a compiled or source file until `catalog/<id>/plugin.json` exists.
 * Needed because the host bundle lives at `lib/index.js`, while source lives
 * under `src/agent/`.
 */
export function resolveCatalogRoot(startDir: string): string {
  let dir = startDir
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'catalog')
    if (isPackCatalog(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return join(startDir, '..', 'catalog')
}

function isPackCatalog(dir: string): boolean {
  if (!existsSync(dir)) return false
  try {
    return readdirSync(dir, { withFileTypes: true }).some(
      (entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'plugin.json')),
    )
  } catch {
    return false
  }
}
