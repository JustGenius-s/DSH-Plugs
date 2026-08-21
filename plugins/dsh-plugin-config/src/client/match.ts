import type { CatalogPlugin, InstallMethod } from '../market/types.ts'

export interface InventoryEntry {
  entryId: string
  moduleName: string
  enabled: boolean
}

export function methodsOf(plugin: CatalogPlugin): InstallMethod[] {
  if (plugin.methods.length > 0) return plugin.methods
  if (plugin.spec === '') return []
  return [{
    kind: 'npm',
    spec: plugin.spec,
    command: plugin.install || `dsh plugin --profile web add ${plugin.spec}`,
  }]
}

export function specOf(plugin: CatalogPlugin): string {
  return methodsOf(plugin)[0]?.spec ?? plugin.spec
}

export function isInstalled(plugin: CatalogPlugin, entries: readonly InventoryEntry[]): boolean {
  if (plugin.installed === true) return true
  const needles = pluginNeedles(plugin)
  for (const entry of entries) {
    for (const hay of entryNeedles(entry)) {
      if (needles.has(hay)) return true
    }
  }
  return false
}

function pluginNeedles(plugin: CatalogPlugin): Set<string> {
  const needles = new Set<string>()
  add(needles, plugin.name)
  add(needles, plugin.packageName)
  add(needles, plugin.spec)
  add(needles, `${plugin.owner}/${plugin.name}`)
  add(needles, `github:${plugin.owner}/${plugin.name}`)
  for (const method of methodsOf(plugin)) {
    add(needles, method.spec)
    if (method.kind === 'local') add(needles, `link:${method.spec}`)
  }
  return needles
}

function entryNeedles(entry: InventoryEntry): string[] {
  const moduleName = entry.moduleName
  const short = moduleName.startsWith('@')
    ? moduleName.slice(moduleName.indexOf('/') + 1)
    : moduleName.split('/').pop() ?? moduleName
  return [moduleName, short, entry.entryId].map((value) => value.toLowerCase())
}

function add(needles: Set<string>, value: string | undefined): void {
  if (value === undefined) return
  const trimmed = value.trim().toLowerCase()
  if (trimmed !== '') needles.add(trimmed)
}
