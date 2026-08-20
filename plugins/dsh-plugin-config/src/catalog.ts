import { SELF_PACKAGE } from './types.ts'

/** Known DSH-Plugs packages. Marketplace host is optional. */
export const KNOWN_MARKETPLACE = new Set([
  '@just-genius/dsh-session-navigator',
  '@just-genius/dsh-codex',
  '@just-genius/dsh-model-custom-ex',
  '@just-genius/dsh-plugin-marketplace',
  '@just-genius/dsh-desktop-update',
  '@just-genius/dsh-wechat-chat',
  '@just-genius/dsh-memory',
  SELF_PACKAGE,
].map((name) => name.toLowerCase()))

export function catalogNames(): Set<string> {
  return new Set(KNOWN_MARKETPLACE)
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
