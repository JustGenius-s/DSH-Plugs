/** Browser-safe subset of DSH 0.1.5's workspace file-address contract. */

export const FILE_ADDRESS_PATTERN = 'dsh-resource://file/**'
const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

export type FileAddress =
  | { scope: 'session'; sessionId: string; path: string }
  | { scope: 'absolute'; path: string }

export interface FilesNavigationState extends Readonly<Record<string, string | undefined>> {
  mode?: 'tree' | 'preview' | 'diff'
  file?: string
  sha?: string
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ':')
}

function encodePath(path: string): string {
  return path.split('/').map(encodeSegment).join('/')
}

function isWindowsStylePath(path: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')
}

export function isAbsoluteWorkspacePath(path: string): boolean {
  return path.startsWith('/') || isWindowsStylePath(path)
}

export function sessionFileAddress(sessionId: string, path: string): string {
  const relative = path
    .replace(/\\/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/^\/+/, '')
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(relative)}`
}

export function absoluteFileAddress(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const unc = normalized.startsWith('//')
  const absolute = normalized.replace(/^\/+/, '')
  return `${FILE_ADDRESS_PREFIX}absolute/${unc ? '/' : ''}${encodePath(absolute)}`
}

/** Use a Session-relative address whenever the path is inside its workspace. */
export function fileAddressFor(
  sessionId: string,
  cwd: string | undefined,
  path: string,
): string {
  const normalized = path.replace(/\\/g, '/')
  if (!isAbsoluteWorkspacePath(normalized)) return sessionFileAddress(sessionId, normalized)
  const root = cwd?.replace(/\\/g, '/').replace(/\/+$/, '') ?? ''
  if (root !== '' && normalized === root) return sessionFileAddress(sessionId, '')
  if (root !== '' && normalized.startsWith(`${root}/`)) {
    return sessionFileAddress(sessionId, normalized.slice(root.length + 1))
  }
  return absoluteFileAddress(normalized)
}

/** Decode a DSH file resource without touching the filesystem. */
export function parseFileAddress(address: string): FileAddress | undefined {
  try {
    const url = new URL(address)
    if (url.protocol !== 'dsh-resource:' || url.host !== 'file') return undefined
    const [, scope, ...rest] = url.pathname.split('/')
    if (scope === 'session') {
      const [id, ...segments] = rest
      if (id === undefined || id === '' || segments.length === 0) return undefined
      return {
        scope,
        sessionId: decodeURIComponent(id),
        path: segments.map(decodeURIComponent).join('/'),
      }
    }
    if (scope !== 'absolute') return undefined
    const unc = rest[0] === '' && rest.length > 1
    const segments = (unc ? rest.slice(1) : rest).map(decodeURIComponent)
    if (segments.length === 0 || segments[0] === '') return undefined
    if (unc) return { scope, path: `//${segments.join('/')}` }
    const path = /^[A-Za-z]:$/.test(segments[0] ?? '')
      ? segments.join('/')
      : `/${segments.join('/')}`
    return { scope, path }
  } catch {
    return undefined
  }
}

export function fileTitleFromAddress(address: string, fallback: string): string {
  const parsed = parseFileAddress(address)
  if (parsed === undefined) return fallback
  const trimmed = parsed.path.replace(/[/\\]+$/, '')
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return trimmed.slice(separator + 1) || fallback
}

/** Narrow the unvalidated official navigation params for the rich viewer. */
export function filesNavigationFrom(
  address: string,
  params: Readonly<Record<string, unknown>> | undefined,
): FilesNavigationState | undefined {
  const parsed = parseFileAddress(address)
  if (parsed === undefined) return undefined
  const mode = params?.mode === 'diff' ? 'diff' : 'preview'
  const sha = typeof params?.sha === 'string' ? params.sha : undefined
  return { mode, file: parsed.path, sha }
}
