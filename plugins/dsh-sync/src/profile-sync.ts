import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PluginProfileManager } from '@just-genius/dsh-plugin-runtime'
import type { SyncPluginsSnapshot } from './shared.ts'

const DSH_PLUGS_REPO = 'JustGenius-s/DSH-Plugs'

const KNOWN_FOLDERS: Record<string, string> = {
  '@just-genius/dsh-codex': 'dsh-codex',
  '@just-genius/dsh-debug-mode': 'dsh-debug-mode',
  '@just-genius/dsh-desktop-update': 'dsh-desktop-update',
  '@just-genius/dsh-memory': 'dsh-memory',
  '@just-genius/dsh-model-custom-ex': 'dsh-model-custom-ex',
  '@just-genius/dsh-plugin-config': 'dsh-plugin-config',
  '@just-genius/dsh-sync': 'dsh-sync',
  '@just-genius/dsh-wechat-chat': 'dsh-wechat-chat',
  '@just-genius/dsh-whale-girl': 'dsh-whale-girl',
  '@just-genius/dsh-session-navigator': 'session-navigator',
}

export interface SkippedPlugin {
  name: string
  reason: string
}

export interface CollectPluginsResult {
  snapshot: SyncPluginsSnapshot
  skipped: SkippedPlugin[]
}

export function collectPlugins(profile: PluginProfileManager): CollectPluginsResult {
  const current = profile.snapshot()
  const portable: Record<string, string> = {}
  const skipped: SkippedPlugin[] = []

  for (const [name, spec] of Object.entries(current.dependencies)) {
    const normalized = normalizeDepSpec(name, spec)
    if (normalized === null) {
      skipped.push({
        name,
        reason: `Cannot port "${spec}" — not a github:/registry/version or known DSH-Plugs package`,
      })
    } else {
      portable[name] = normalized
    }
  }

  return {
    snapshot: { dependencies: portable, cordisPatchYml: current.patchText },
    skipped,
  }
}

export async function applyPlugins(
  profile: PluginProfileManager,
  snapshot: SyncPluginsSnapshot,
) {
  const current = profile.snapshot()
  const desired: Record<string, string> = { ...current.dependencies }
  const localPortable = new Set(Object.keys(collectPlugins(profile).snapshot.dependencies))

  for (const name of localPortable) {
    if (!(name in snapshot.dependencies)) delete desired[name]
  }
  for (const [name, portableSpec] of Object.entries(snapshot.dependencies)) {
    const existing = current.dependencies[name]
    if (existing !== undefined && packageSatisfiesPortable(name, existing, portableSpec)) continue
    desired[name] = resolveLocalCheckout(name) ?? portableSpec
  }

  return profile.reconcile({ dependencies: desired, patchText: snapshot.cordisPatchYml })
}

function normalizeDepSpec(name: string, spec: string): string | null {
  const trimmed = spec.trim()
  if (trimmed === '') return null
  if (isPortableSpec(trimmed)) return trimmed
  const folder = folderForPackage(name)
  if (folder !== null) return githubPathSpec(folder)
  const localPath = localPathFromSpec(trimmed)
  if (localPath !== null) {
    const pkgName = readPackageName(localPath)
    const mapped = pkgName === null ? null : folderForPackage(pkgName)
    if (mapped !== null) return githubPathSpec(mapped)
    const match = /[/\\]plugins[/\\]([^/\\]+)[/\\]?$/.exec(localPath)
    if (match?.[1]) return githubPathSpec(match[1])
  }
  return null
}

function isPortableSpec(spec: string): boolean {
  if (spec.startsWith('github:') || spec.startsWith('git+') || spec.startsWith('git@')) return true
  if (spec.startsWith('npm:') || spec.startsWith('http://') || spec.startsWith('https://')) return true
  return !spec.includes('/') && !spec.includes('\\') && !spec.startsWith('.')
    && !spec.startsWith('link:') && !spec.startsWith('file:') && !spec.startsWith('workspace:')
}

function localPathFromSpec(spec: string): string | null {
  if (spec.startsWith('link:')) return spec.slice(5)
  if (spec.startsWith('file:')) return spec.slice(5)
  if (spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec)) return spec
  return null
}

function packageSatisfiesPortable(name: string, existing: string, portable: string): boolean {
  if (existing === portable) return true
  const normalized = normalizeDepSpec(name, existing)
  if (normalized === portable) return true
  const left = normalized === null ? null : githubPathFolder(normalized)
  const right = githubPathFolder(portable)
  return left !== null && left === right
}

function githubPathFolder(spec: string): string | null {
  return /^github:[^#\s]+#path:plugins\/([^/\s#]+)$/.exec(spec.trim())?.[1] ?? null
}

function resolveLocalCheckout(packageName: string): string | null {
  const folder = folderForPackage(packageName)
  const pluginsDir = resolveMonorepoPluginsDir()
  if (folder === null || pluginsDir === null) return null
  const dir = join(pluginsDir, folder)
  return existsSync(join(dir, 'package.json')) ? dir : null
}

function folderForPackage(packageName: string): string | null {
  return KNOWN_FOLDERS[packageName] ?? scanMonorepoPackageMap().get(packageName) ?? null
}

function githubPathSpec(folder: string): string {
  return `github:${DSH_PLUGS_REPO}#path:plugins/${folder}`
}

function resolveMonorepoPluginsDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url))
  const pluginDir = basename(here) === 'lib' ? dirname(here) : here
  const pluginsDir = dirname(pluginDir)
  return basename(pluginsDir) === 'plugins' && existsSync(join(dirname(pluginsDir), 'pnpm-workspace.yaml'))
    ? pluginsDir
    : null
}

let packageMapCache: Map<string, string> | null = null

function scanMonorepoPackageMap(): Map<string, string> {
  if (packageMapCache !== null) return packageMapCache
  const map = new Map<string, string>()
  const pluginsDir = resolveMonorepoPluginsDir()
  if (pluginsDir !== null) {
    try {
      for (const folder of readdirSync(pluginsDir)) {
        const name = readPackageName(join(pluginsDir, folder))
        if (name !== null) map.set(name, folder)
      }
    } catch {
      // Packaged installs have no monorepo checkout.
    }
  }
  packageMapCache = map
  return map
}

function readPackageName(dir: string): string | null {
  try {
    const value = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: unknown }
    return typeof value.name === 'string' ? value.name : null
  } catch {
    return null
  }
}
