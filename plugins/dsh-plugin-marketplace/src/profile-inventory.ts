import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Catalog, CatalogPlugin } from './catalog.ts'

interface ProfilePackageJson {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

export function profilePackagePath(): string {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'profiles', 'web', 'package.json')
}

/** Lowercased package names, bundle ids, and install specs from the web profile. */
export function readProfileTokens(): Set<string> {
  const tokens = new Set<string>()
  const file = profilePackagePath()
  if (!existsSync(file)) return tokens
  let pkg: ProfilePackageJson
  try {
    pkg = JSON.parse(readFileSync(file, 'utf8')) as ProfilePackageJson
  } catch {
    return tokens
  }
  for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
    addToken(tokens, name)
    addToken(tokens, spec)
    if (spec.startsWith('link:')) addToken(tokens, spec.slice(5))
    if (spec.startsWith('github:')) addToken(tokens, spec)
  }
  for (const bundle of pkg.dsh?.profile?.bundles ?? []) addToken(tokens, bundle)
  return tokens
}

export function pluginIsInProfile(plugin: CatalogPlugin, tokens: Set<string>): boolean {
  for (const token of pluginTokens(plugin)) {
    if (tokens.has(token)) return true
  }
  for (const token of tokens) {
    if (plugin.packageName && token === plugin.packageName.toLowerCase()) return true
    if (token.endsWith(`/${plugin.name.toLowerCase()}`)) return true
  }
  return false
}

export function markInstalled(catalog: Catalog, tokens: Set<string> = readProfileTokens()): Catalog {
  return {
    ...catalog,
    plugins: catalog.plugins.map((plugin) => ({
      ...plugin,
      installed: pluginIsInProfile(plugin, tokens),
    })),
  }
}

export function pluginTokens(plugin: CatalogPlugin): string[] {
  const tokens = [
    plugin.name,
    plugin.owner,
    `${plugin.owner}/${plugin.name}`,
    `github:${plugin.owner}/${plugin.name}`,
    plugin.spec,
  ]
  if (plugin.packageName) tokens.push(plugin.packageName)
  return tokens.map((value) => value.toLowerCase()).filter((value) => value !== '')
}

function addToken(tokens: Set<string>, value: string): void {
  const trimmed = value.trim().toLowerCase()
  if (trimmed !== '') tokens.add(trimmed)
}
