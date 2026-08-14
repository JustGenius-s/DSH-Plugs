import type { CatalogPlugin } from '../catalog.ts'

export interface InventoryEntry {
  entryId: string
  moduleName: string
  enabled: boolean
}

export function specOf(plugin: CatalogPlugin): string {
  return plugin.spec
}

export function isInstalled(plugin: CatalogPlugin, entries: readonly InventoryEntry[]): boolean {
  const packageName = plugin.packageName?.toLowerCase()
  const name = plugin.name.toLowerCase()
  const owner = plugin.owner.toLowerCase()
  const repo = `${owner}/${name}`
  for (const entry of entries) {
    const moduleName = entry.moduleName.toLowerCase()
    const short = moduleName.split('/').pop() ?? moduleName
    if (packageName !== undefined && moduleName === packageName) return true
    if (short === name || moduleName === name || moduleName.endsWith(`/${name}`)) return true
    if (moduleName.includes(repo)) return true
  }
  return false
}
