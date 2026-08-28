import { symbols, type Context } from '@just-genius/dsh-plugin-runtime/host'
import type { Entry } from '@just-genius/dsh-plugin-runtime/host'
import { catalogNames, matchCatalogLabel } from './catalog.ts'
import {
  PROTECTED_IDS,
  SESSION_PLANE_IDS,
  classifyOrigin,
  classifyPlane,
  localEntryId,
  moduleShortName,
} from './classify.ts'
import { readProfilePackage, readUserDisabledIds, type ProfilePackageJson } from './profile.ts'
import {
  SELF_ID,
  SELF_PACKAGE,
  type FiberPhase,
  type InventorySnapshot,
  type ManagedPlugin,
} from './types.ts'

function fiberPhase(state: number): FiberPhase {
  switch (state) {
    case 0: return 'pending'
    case 1: return 'loading'
    case 2: return 'active'
    case 3: return 'failed'
    case 5: return 'unloading'
    default: return null
  }
}

export function collectInventory(ctx: Context): InventorySnapshot {
  const profile = readProfilePackage()
  const userDisabled = readUserDisabledIds()
  const names = catalogNames()
  const deps = profile.dependencies ?? {}
  const plugins: ManagedPlugin[] = []
  const seenPackages = new Set<string>()
  const builtinShort = new Map<string, string>()

  const entries = [...ctx.loader.entries()]
  for (const entry of entries) {
    if (entry.options.group) continue
    const moduleName = String(entry.options.name ?? '')
    if (isBuiltinModuleName(moduleName)) {
      builtinShort.set(moduleShortName(moduleName), moduleName)
    }
  }

  for (const entry of entries) {
    if (entry.options.group) continue
    const plugin = projectEntry(entry, deps, userDisabled, names, builtinShort)
    plugins.push(plugin)
    if (plugin.packageName) seenPackages.add(plugin.packageName.toLowerCase())
  }

  for (const [packageName, spec] of Object.entries(deps)) {
    if (seenPackages.has(packageName.toLowerCase())) continue
    plugins.push(projectOrphan(packageName, spec, userDisabled, names, builtinShort, profile))
  }

  return { plugins }
}

function projectEntry(
  entry: Entry,
  deps: Record<string, string>,
  userDisabled: Set<string>,
  names: Set<string>,
  builtinShort: Map<string, string>,
): ManagedPlugin {
  const entryId = String(entry.id)
  const localId = localEntryId(entryId)
  const moduleName = String(entry.options.name ?? '')
  const shortName = moduleShortName(moduleName)
  const isolate = Object.keys(entry.ctx[symbols.isolate]).length > 0
  const ancestorIsolate = hasAncestorIsolate(entry)
  const plane = classifyPlane({ localId, isolate, ancestorIsolate })
  const packageName = resolvePackageName(moduleName, localId, deps)
  const origin = classifyOrigin(moduleName, packageName, names)
  const enabled = !entry.disabled
  const userOwnedDisable = userDisabled.has(localId) || userDisabled.has(entryId)
  const sessionOwned = plane === 'session' && origin === 'builtin' && !userOwnedDisable
  const core = PROTECTED_IDS.has(localId) || localId === SELF_ID
  const conflictWith = origin !== 'builtin' ? builtinShort.get(shortName) ?? null : null

  return {
    entryId,
    localId,
    moduleName,
    shortName,
    enabled,
    fiberPhase: entry.fiber === undefined ? null : fiberPhase(entry.fiber.state),
    plane,
    origin,
    packageName,
    installSpec: packageName ? deps[packageName] ?? null : null,
    catalogLabel: matchCatalogLabel(packageName, moduleName, names),
    nameConflict: conflictWith !== null,
    conflictWith,
    canDisable: enabled && !core && !sessionOwned,
    canEnable: !enabled && !sessionOwned && !core,
    canUninstall: packageName !== null && packageName in deps && origin !== 'builtin',
    protectedReason: core ? 'core' : sessionOwned ? 'session-owned' : origin === 'builtin' && packageName === null ? 'builtin' : null,
    isolate: isolate || ancestorIsolate,
    parentId: parentIdOf(entry),
    userDisabled: userOwnedDisable,
  }
}

function projectOrphan(
  packageName: string,
  spec: string,
  userDisabled: Set<string>,
  names: Set<string>,
  builtinShort: Map<string, string>,
  _profile: ProfilePackageJson,
): ManagedPlugin {
  const shortName = moduleShortName(packageName)
  const origin = classifyOrigin(packageName, packageName, names)
  const conflictWith = origin !== 'builtin' ? builtinShort.get(shortName) ?? null : null
  const localId = shortName
  return {
    entryId: `profile:${packageName}`,
    localId,
    moduleName: packageName,
    shortName,
    enabled: false,
    fiberPhase: null,
    plane: 'global',
    origin,
    packageName,
    installSpec: spec,
    catalogLabel: matchCatalogLabel(packageName, packageName, names),
    nameConflict: conflictWith !== null,
    conflictWith,
    canDisable: false,
    canEnable: false,
    canUninstall: origin !== 'builtin',
    protectedReason: origin === 'builtin' ? 'builtin' : null,
    isolate: false,
    parentId: null,
    userDisabled: userDisabled.has(localId),
  }
}

function resolvePackageName(
  moduleName: string,
  localId: string,
  deps: Record<string, string>,
): string | null {
  if (moduleName in deps) return moduleName
  const lower = moduleName.toLowerCase()
  for (const name of Object.keys(deps)) {
    if (name.toLowerCase() === lower) return name
    if (name.endsWith(`/${localId}`) || name.endsWith(`/${moduleShortName(moduleName)}`)) return name
  }
  if (moduleName === SELF_PACKAGE) return SELF_PACKAGE
  if (isBuiltinModuleName(moduleName)) return moduleName
  return null
}

function isBuiltinModuleName(moduleName: string): boolean {
  return moduleName.startsWith('@deepseek-ai/') || moduleName.startsWith('cordis:')
}

function hasAncestorIsolate(entry: Entry): boolean {
  let current = entry.parent.ctx.fiber?.entry
  while (current) {
    if (Object.keys(current.ctx[symbols.isolate]).length > 0) return true
    if (SESSION_PLANE_IDS.has(current.options.id)) return true
    current = current.parent.ctx.fiber?.entry
  }
  return false
}

function parentIdOf(entry: Entry): string | null {
  const parent = entry.parent.ctx.fiber?.entry
  return parent ? String(parent.id) : null
}
