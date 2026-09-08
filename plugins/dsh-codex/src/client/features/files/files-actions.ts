import {
  CODEX_FILES_INFO_PATH,
  CODEX_FILES_REVEAL_PATH,
  type CodexFilesInfoResponse,
  type CodexFilesRevealResponse,
  type CodexHostPlatform,
} from '../../../shared/files'
import { requestJson } from '../../infrastructure/http'

export interface FilesHostInfo {
  platform: CodexHostPlatform
  revealSupported: boolean
}

/**
 * What this host can do behind the files panel's row actions.
 *
 * Cached per page: the platform does not change while the tab is open, and a
 * right-click must not pay a round trip before it can paint its menu.
 */
let infoCache: Promise<FilesHostInfo> | undefined

export function fetchFilesHostInfo(): Promise<FilesHostInfo> {
  infoCache ??= requestJson<CodexFilesInfoResponse>(CODEX_FILES_INFO_PATH)
    .then(value => (value.ok
      ? { platform: value.platform, revealSupported: value.revealSupported }
      : { platform: 'unknown' as const, revealSupported: false }))
    .catch(() => ({ platform: 'unknown' as const, revealSupported: false }))
  return infoCache
}

/** Reveal one workspace path in the Host's native file manager. */
export async function revealPath(
  cwd: string,
  path: string,
  kind: 'file' | 'dir',
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const value = await postJson<CodexFilesRevealResponse>(
      CODEX_FILES_REVEAL_PATH,
      { cwd, path, kind },
    )
    return value.ok ? { ok: true } : { ok: false, message: value.message }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return await response.json() as T
}

/**
 * The workspace-relative path of one tree row — what "Copy Relative Path"
 * puts on the clipboard, and the shape the `@path` grammar and every host
 * route already expect.
 *
 * Tree rows are ALREADY workspace-relative, so those pass through unchanged.
 * An absolute path is only ever reduced when it sits inside the workspace; one
 * outside has no relative spelling, and the caller disables the row.
 */
export function relativePathOf(path: string, cwd: string | undefined): string | undefined {
  const normalizedPath = path.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalizedPath.length === 0) return undefined
  if (!normalizedPath.startsWith('/') && !/^[A-Za-z]:\//.test(normalizedPath)) {
    return normalizedPath
  }
  if (cwd === undefined || cwd.length === 0) return undefined
  const normalizedCwd = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalizedCwd.length === 0) return undefined
  const root = normalizedCwd + '/'
  if (!normalizedPath.startsWith(root)) return undefined
  const relative = normalizedPath.slice(root.length)
  return relative.length === 0 ? undefined : relative
}

/**
 * The absolute path of one tree row, for "Copy Path".
 *
 * Tree rows are already workspace-relative, so this joins them onto the
 * session cwd. A row that is itself absolute (an outside-workspace preview
 * opened by a chat link) is used as-is.
 */
export function absolutePathOf(path: string, cwd: string | undefined): string {
  const normalizedPath = path.replace(/\\/g, '/')
  if (normalizedPath.startsWith('/') || /^[A-Za-z]:\//.test(normalizedPath)) {
    return path
  }
  if (cwd === undefined || cwd.length === 0) return path
  const normalizedCwd = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  return `${normalizedCwd}/${normalizedPath}`
}
