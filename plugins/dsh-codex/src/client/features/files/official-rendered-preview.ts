import { parseFileAddress } from './resource-address'

/**
 * Suffixes whose official document-preview renderer is a real view, not
 * source highlighting. Mirrors DSH 0.1.5
 * `dsh-client-ui-sidebar-documentpreview` (HTML iframe, Markdown,
 * image body, PDF). Codex must not claim these addresses while that
 * builtin exists.
 */
export const OFFICIAL_RENDERED_PREVIEW_EXTENSIONS = [
  'html',
  'htm',
  'md',
  'markdown',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'svg',
  'pdf',
] as const

export function officialRenderedPreviewExtension(path: string): string | undefined {
  const normalized = path.replaceAll('\\', '/').toLowerCase()
  const name = normalized.slice(normalized.lastIndexOf('/') + 1)
  let matched: string | undefined
  for (const extension of OFFICIAL_RENDERED_PREVIEW_EXTENSIONS) {
    if (!name.endsWith(`.${extension}`)) continue
    if (matched === undefined || extension.length > matched.length) matched = extension
  }
  return matched
}

/** True for a workspace path or a `dsh-resource://file/…` address. */
export function usesOfficialRenderedPreview(pathOrAddress: string): boolean {
  const parsed = parseFileAddress(pathOrAddress)
  return officialRenderedPreviewExtension(parsed?.path ?? pathOrAddress) !== undefined
}
