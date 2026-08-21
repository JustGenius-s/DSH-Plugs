import { emptyCatalog, loadRemoteCatalog } from './catalog.ts'
import { markInstalled } from './profile-inventory.ts'
import type { Catalog } from './types.ts'

let cache: { at: number; catalog: Catalog } | null = null
const CACHE_MS = 60 * 1000

/** Awesome-dsh-plugin only — no hardcoded DSH-Plugs source. */
export async function loadMarketplaceCatalog(force = false): Promise<Catalog> {
  const now = Date.now()
  if (!force && cache && now - cache.at < CACHE_MS) return cache.catalog
  let remote: Catalog
  try {
    remote = await loadRemoteCatalog(force)
  } catch {
    remote = emptyCatalog()
  }
  const catalog = markInstalled(remote)
  if (catalog.plugins.length === 0) throw new Error('catalog unavailable')
  cache = { at: now, catalog }
  return catalog
}
