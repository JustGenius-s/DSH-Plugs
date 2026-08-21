import { SELF_PACKAGE } from './types.ts'

/**
 * Extra marketplace package names beyond the `@just-genius/` scope heuristic.
 * Prefer matching against the live awesome catalog when available; this set is
 * only a small fallback for packages that use a different scope.
 */
const EXTRA_MARKETPLACE = new Set([
  SELF_PACKAGE,
].map((name) => name.toLowerCase()))

export function catalogNames(extra: Iterable<string> = []): Set<string> {
  const names = new Set(EXTRA_MARKETPLACE)
  for (const name of extra) {
    const trimmed = name.trim().toLowerCase()
    if (trimmed !== '') names.add(trimmed)
  }
  return names
}

export function matchCatalogLabel(
  packageName: string | null,
  moduleName: string,
  names: Set<string>,
): string | null {
  for (const needle of [packageName, moduleName]) {
    if (needle && names.has(needle.toLowerCase())) return needle
  }
  return null
}
