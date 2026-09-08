import { isAbsolute, resolve, sep } from 'node:path'
import { stat } from 'node:fs/promises'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import type { CodexHostPlatform } from '../../shared/files'

/** Upper bound on one reveal call; a file manager either takes it or not. */
const REVEAL_TIMEOUT_MS = 10_000
/** Grace window for the terminate escalation after the timeout fires. */
const REVEAL_GRACE_MS = 2000
/** Cap for the collected-but-discarded stdio streams. */
const DISCARD_BUFFER_BYTES = 8 * 1024

export interface RevealTarget {
  absolutePath: string
  /** Whether the path is a directory, so the opener reveals the folder itself. */
  directory: boolean
}

/**
 * Reveal one path in the Host's native file manager.
 *
 * `open -R` (macOS), Explorer's `/select,` (Windows), and a best-effort
 * directory open (Linux) each highlight differently, and only the first two
 * truly select. The target's existence is checked first so a stale row fails
 * with a readable message instead of a file-manager error dialog.
 */
export async function revealInFileManager(
  ctx: Context,
  cwd: string,
  target: RevealTarget,
): Promise<void> {
  if (!(await exists(target.absolutePath))) {
    throw new RevealError(`path does not exist: ${target.absolutePath}`)
  }
  const argv = await resolveOpener(ctx, target)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REVEAL_TIMEOUT_MS)
  const handle = ctx.subprocess.spawn({
    argv,
    cwd,
    // `pipe` with a small cap, not `inherit`: a file manager's chatter must
    // not land on the harness's own console, and the exit code alone decides
    // success.
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: DISCARD_BUFFER_BYTES },
      stderr: { maxBytes: DISCARD_BUFFER_BYTES },
    },
    graceMs: REVEAL_GRACE_MS,
    signal: controller.signal,
  })
  try {
    const outcome = await handle.done
    // Every opener here is a "hand off and exit" launch, so a non-zero exit is
    // a real refusal rather than a backgrounded process reporting later.
    if (outcome.exitCode !== 0) {
      throw new RevealError(`file manager exited with code ${outcome.exitCode ?? 'unknown'}`)
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Whether this host can reveal a path in a file manager at all. */
export function revealSupported(platform: CodexHostPlatform): boolean {
  return platform === 'darwin' || platform === 'win32' || platform === 'linux'
}

/** Normalize Node's `process.platform` into the shared platform bucket. */
export function hostPlatform(value: NodeJS.Platform = process.platform): CodexHostPlatform {
  switch (value) {
    case 'darwin':
      return 'darwin'
    case 'win32':
      return 'win32'
    case 'linux':
      return 'linux'
    default:
      return 'unknown'
  }
}

export class RevealError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RevealError'
  }
}

export class UnsupportedRevealError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedRevealError'
  }
}

/**
 * Resolve `{ cwd, path }` into an absolute filesystem path inside `cwd`.
 *
 * Tree rows carry workspace-relative paths; a `path` that is already absolute
 * is used as-is. Either way the result must stay inside `cwd` — the panel is a
 * workspace browser, so it must not become a launcher for arbitrary host paths.
 */
export function resolveWithinWorkspace(cwd: string, path: string): string | undefined {
  if (cwd.includes('\0') || path.includes('\0')) return undefined
  const normalizedCwd = cwd.replace(/[/\\]+$/, '')
  if (normalizedCwd.length === 0) return undefined
  const combined = isAbsolute(path)
    ? path
    : `${normalizedCwd}${sep}${path.replace(/^[/\\]+/, '')}`
  // Normalize BEFORE the containment test: a joined path still carrying `.` or
  // `..` would otherwise slip past a prefix comparison (`repo/../outside`
  // starts with `repo/`), which is exactly the escape this function exists to
  // prevent.
  const resolved = resolve(combined)
  const root = resolve(normalizedCwd) + sep
  // Equal to cwd is rejected (revealing the workspace root is not a row
  // gesture); anything not under the root was an escape attempt.
  if (resolved !== resolve(normalizedCwd) && !resolved.startsWith(root)) return undefined
  return resolved
}

async function exists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath)
    return true
  } catch {
    return false
  }
}

/**
 * The argv that reveals `target`.
 *
 * Windows needs `explorer` resolved through the subprocess seam (it is a
 * shell/ROOT-relative name); macOS and Linux call fixed absolute paths.
 */
async function resolveOpener(ctx: Context, target: RevealTarget): Promise<string[]> {
  const absolute = target.absolutePath
  switch (hostPlatform()) {
    case 'darwin':
      // `open -R` selects the item in Finder. For a directory it reveals the
      // folder's parent with the folder selected, which is what "Reveal in
      // Finder" means for a folder row too.
      return ['/usr/bin/open', '-R', absolute]
    case 'win32': {
      const explorer = await ctx.subprocess.resolveExecutable('explorer')
      return [explorer, `/select,${absolute}`]
    }
    default:
      // Linux and any unknown POSIX host: no portable "select" contract, so
      // opening the containing directory is the honest behavior.
      return ['/usr/bin/xdg-open', target.directory ? absolute : dirnameOf(absolute)]
  }
}

function dirnameOf(absolutePath: string): string {
  const slash = Math.max(absolutePath.lastIndexOf('/'), absolutePath.lastIndexOf('\\'))
  return slash <= 0 ? absolutePath : absolutePath.slice(0, slash)
}
