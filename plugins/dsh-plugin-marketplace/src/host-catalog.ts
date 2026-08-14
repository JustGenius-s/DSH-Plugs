import { loadRemoteCatalog, mergeCatalogs, emptyRemoteCatalog, type Catalog } from './catalog.ts'
import { loadDshPlugsPlugins } from './local-source.ts'

let cache: { at: number; catalog: Catalog } | null = null
const CACHE_MS = 60 * 1000

export async function loadMergedCatalog(force = false): Promise<Catalog> {
  const now = Date.now()
  if (!force && cache && now - cache.at < CACHE_MS) return cache.catalog
  const local = loadDshPlugsPlugins()
  let remote
  try {
    remote = await loadRemoteCatalog(force)
  } catch {
    remote = emptyRemoteCatalog()
  }
  const catalog = mergeCatalogs(local, remote)
  if (catalog.plugins.length === 0) throw new Error('catalog unavailable')
  cache = { at: now, catalog }
  return catalog
}
