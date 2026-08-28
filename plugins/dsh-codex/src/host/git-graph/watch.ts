import { createHash } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { execGit } from './git-exec'

const GIT_TIMEOUT_MS = 5_000
const MAX_BUFFER = 32 * 1024 * 1024
/** Burst collapse: one event per save/commit storm, not one per file. */
const DEBOUNCE_MS = 300
const HEARTBEAT_MS = 25_000
/** Safety-net poll cadence when recursive fs.watch works (macOS/Windows). */
const POLL_RELAXED_MS = 15_000
/** Poll cadence when the worktree watch is unavailable (Linux). */
const POLL_FALLBACK_MS = 3_000

/**
 * SSE handler for the watch route: streams one change event whenever the
 * workspace moves. fs.watch covers the working tree and, in a Git repository,
 * the git dir (index/HEAD/refs). A slow Git fingerprint poll backstops missed
 * events and platforms without recursive fs.watch for repositories. Plain
 * folders still get the filesystem watcher and focus refresh fallback. The
 * response stays open until the client disconnects.
 *
 * The filesystem watch stays on node:fs — the ctx.fs seam exposes read/list/
 * write primitives, not a directory watch, so this remains a host-local
 * concern.
 */
export async function handleWatch(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
  cwd: string,
): Promise<void> {
  const dirs = await resolveGitDirs(ctx, cwd)
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    // Disable proxy buffering so events reach the client immediately.
    'x-accel-buffering': 'no',
  })
  res.write(': connected\n\n')

  let closed = false
  let debounce: NodeJS.Timeout | undefined
  const watchers: FSWatcher[] = []

  const send = (): void => {
    if (!closed) res.write('event: change\ndata: {}\n\n')
  }
  const schedule = (): void => {
    if (closed) return
    clearTimeout(debounce)
    debounce = setTimeout(send, DEBOUNCE_MS)
  }

  let worktreeWatched = false
  for (const target of watchTargets(cwd, dirs)) {
    try {
      const watcher = watch(target.dir, { recursive: target.recursive }, schedule)
      // A vanished directory (repo deleted mid-session) must not crash us.
      watcher.on('error', () => {})
      watchers.push(watcher)
      if (target.dir === cwd) worktreeWatched = true
    } catch {
      // Recursive watch unsupported on this platform, or the dir is gone;
      // the fingerprint poll below covers the gap.
    }
  }

  let polling = false
  let lastFingerprint = ''
  const poll = async (): Promise<void> => {
    if (closed || polling) return
    polling = true
    try {
      const next = await fingerprint(ctx, cwd)
      if (lastFingerprint !== '' && next !== lastFingerprint) schedule()
      lastFingerprint = next
    } catch {
      // Git busy or repo gone; keep the last baseline and try next tick.
    }
    polling = false
  }
  const pollTimer = dirs === undefined
    ? undefined
    : setInterval(
      () => { void poll() },
      worktreeWatched ? POLL_RELAXED_MS : POLL_FALLBACK_MS,
    )
  if (dirs !== undefined) void poll()

  const heartbeat = setInterval(() => {
    if (!closed) res.write(': ping\n\n')
  }, HEARTBEAT_MS)

  const cleanup = (): void => {
    if (closed) return
    closed = true
    clearTimeout(debounce)
    if (pollTimer !== undefined) clearInterval(pollTimer)
    clearInterval(heartbeat)
    for (const watcher of watchers) watcher.close()
  }
  req.on('close', cleanup)
  req.on('error', cleanup)
}

interface GitDirs {
  /** Per-worktree git dir (index, HEAD, MERGE_HEAD). */
  gitDir: string
  /** Shared git dir (refs, packed-refs); equals gitDir for a normal repo. */
  commonDir: string
}

/**
 * The directories worth watching. The worktree root always sees file edits;
 * in repositories, the git dir sees staging and checkout writes and refs/
 * sees branch and tag movement. Recursive watches are used where supported.
 */
function watchTargets(
  cwd: string,
  dirs: GitDirs | undefined,
): readonly { dir: string; recursive: boolean }[] {
  if (dirs === undefined) return [{ dir: cwd, recursive: true }]
  const targets = [
    { dir: dirs.gitDir, recursive: false },
    { dir: join(dirs.commonDir, 'refs'), recursive: true },
    { dir: cwd, recursive: true },
  ]
  if (dirs.commonDir !== dirs.gitDir) {
    // Linked worktree: packed-refs and friends live in the common dir.
    targets.push({ dir: dirs.commonDir, recursive: false })
  }
  return targets
}

async function resolveGitDirs(ctx: Context, cwd: string): Promise<GitDirs | undefined> {
  try {
    const [gitDir, commonDir] = await Promise.all([
      gitText(ctx, cwd, ['rev-parse', '--absolute-git-dir']),
      gitText(ctx, cwd, ['rev-parse', '--git-common-dir']),
    ])
    return {
      gitDir,
      commonDir: isAbsolute(commonDir) ? commonDir : resolve(cwd, commonDir),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/not a git repository/i.test(message)) throw error
    return undefined
  }
}

/** Hash of the worktree status plus HEAD identity and position. */
async function fingerprint(ctx: Context, cwd: string): Promise<string> {
  const [status, head] = await Promise.all([
    gitText(ctx, cwd, ['status', '--porcelain', '-z', '-uall']),
    gitText(ctx, cwd, ['rev-parse', 'HEAD', '--abbrev-ref', 'HEAD']).catch(() => ''),
  ])
  return createHash('sha1').update(status).update('\0').update(head).digest('hex')
}

async function gitText(ctx: Context, cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execGit(ctx, cwd, args, GIT_TIMEOUT_MS, MAX_BUFFER)
  return stdout.replace(/\n+$/, '')
}
