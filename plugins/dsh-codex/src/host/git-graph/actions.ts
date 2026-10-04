import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import type {
  GitGraphActionName,
  GitGraphActionRequest,
  GitResetMode,
} from '../../shared/git-graph'
import { parsePorcelainEntries } from './browse'
import { execGit, runGit } from './git-exec'

const ACTION_TIMEOUT_MS = 30_000
const MAX_BUFFER = 8 * 1024 * 1024
const SHA_RE = /^[0-9a-f]{7,40}$/i
const BRANCH_RE = /^(?!\/)[A-Za-z0-9._][A-Za-z0-9._/-]*$/

export async function runGraphAction(ctx: Context, request: GitGraphActionRequest): Promise<string> {
  await assertGitRepo(ctx, request.cwd)
  if (isCommitAction(request.action)) {
    const sha = (request.sha ?? '').trim()
    if (!SHA_RE.test(sha)) {
      throw badRequest('invalid commit')
    }
    const args = buildArgs(request.action, sha, request.branch, request.mode)
    return gitText(ctx, request.cwd, args)
  }
  return runWorkdirAction(ctx, request)
}

type CommitAction = Extract<
  GitGraphActionName,
  'checkout' | 'create-branch' | 'cherry-pick' | 'revert' | 'reset'
>

function isCommitAction(action: GitGraphActionName): action is CommitAction {
  switch (action) {
    case 'checkout':
    case 'create-branch':
    case 'cherry-pick':
    case 'revert':
    case 'reset':
      return true
    default:
      return false
  }
}

/**
 * Working-tree actions from the Git changes panel. Commit semantics mirror
 * VSCode's source-control panel: with all the client already confirmed
 * "stage all and commit", so everything (untracked included) is added first;
 * otherwise the index is committed as-is, falling back to commit -a (all
 * tracked changes) when nothing is staged. Amend never sweeps in unstaged
 * changes implicitly.
 */
async function runWorkdirAction(ctx: Context, request: GitGraphActionRequest): Promise<string> {
  const cwd = request.cwd
  switch (request.action) {
    case 'commit':
    case 'commit-push':
    case 'commit-amend':
    case 'commit-push-amend': {
      const message = (request.message ?? '').trim()
      if (message.length === 0) throw badRequest('empty commit message')
      const amend = request.action === 'commit-amend' || request.action === 'commit-push-amend'
      if (request.all === true) await gitText(ctx, cwd, ['add', '-A'])
      // Amend with nothing staged is legal and simply rewrites the message.
      const args = ['commit']
      if (amend) {
        args.push('--amend', '-m', message)
      } else if (request.all === true || (await hasStagedChanges(ctx, cwd))) {
        args.push('-m', message)
      } else {
        args.push('-am', message)
      }
      const out = await gitText(ctx, cwd, args)
      if (request.action === 'commit' || request.action === 'commit-amend') return out
      const push = await gitText(ctx, cwd, ['push'])
      return [out, push].filter((part) => part.length > 0).join('\n')
    }
    case 'stage':
      return gitText(ctx, cwd, ['add', '--', safePath(request.path)])
    case 'unstage': {
      const path = safePath(request.path)
      try {
        return await gitText(ctx, cwd, ['reset', '-q', 'HEAD', '--', path])
      } catch (error) {
        // Unborn HEAD (no commits yet): the index entry can only come out
        // with rm --cached.
        if (!/ambiguous argument|unknown revision|Failed to resolve/i.test(errorMessage(error))) {
          throw error
        }
        return gitText(ctx, cwd, ['rm', '-q', '-r', '--cached', '--', path])
      }
    }
    case 'stage-all':
      return gitText(ctx, cwd, ['add', '-A'])
    case 'unstage-all': {
      try {
        return await gitText(ctx, cwd, ['reset', '-q', 'HEAD', '--'])
      } catch (error) {
        // Unborn HEAD (no commits yet): empty the index with rm --cached.
        if (!/ambiguous argument|unknown revision|Failed to resolve/i.test(errorMessage(error))) {
          throw error
        }
        return gitText(ctx, cwd, ['rm', '-q', '-r', '--cached', '--ignore-unmatch', '--', '.'])
      }
    }
    case 'discard':
      // The path may be a file or a directory (tree-view folder discard),
      // which can hold both kinds at once — discardWorktree splits them.
      return discardWorktree(ctx, await repoRoot(ctx, cwd), safePath(request.path))
    case 'discard-all':
      // The section-header action on the unstaged group: drop every
      // worktree-side change and delete every untracked file, and leave the
      // index — the user's staged work — exactly as it was.
      return discardWorktree(ctx, await repoRoot(ctx, cwd), undefined)
    case 'pull':
      return gitText(ctx, cwd, ['pull', '--ff-only'])
    case 'push':
      return gitText(ctx, cwd, ['push'])
    case 'fetch':
      return gitText(ctx, cwd, ['fetch', '--all', '--prune'])
    case 'stash':
      return gitText(ctx, cwd, ['stash', 'push', '-u'])
    case 'stash-pop':
      return gitText(ctx, cwd, ['stash', 'pop'])
    default:
      throw badRequest('invalid action')
  }
}

/**
 * The repository root, so git path arguments (which are always repo-relative,
 * even when the workspace is opened below the root) line up with the paths
 * the panel lists.
 */
async function repoRoot(ctx: Context, cwd: string): Promise<string> {
  const root = await gitText(ctx, cwd, ['rev-parse', '--show-toplevel']).catch(() => '')
  return root.length > 0 ? root : cwd
}

/** Max paths per git invocation, so a huge change set cannot blow up argv. */
const PATH_BATCH = 100
/** Unmerged porcelain X/Y letters: an unmerged path has no index entry to restore. */
const UNMERGED = new Set(['U'])

/**
 * Discard the unstaged (worktree) side of the changes under `scope`.
 *
 * VSCode parity for the Changes group: tracked paths go back to their index
 * content and untracked paths are deleted. The index must never be rewritten
 * here — it holds the staged work the panel lists under its own group, and
 * restoring a path from HEAD (or a `reset --hard`) would silently unstage it
 * and, for a path changed on both sides, throw the staged half away.
 *
 * @param scope a repo-relative file or directory path, or undefined for the
 * whole worktree (the `Discard All Changes` action).
 */
async function discardWorktree(
  ctx: Context,
  cwd: string,
  scope: string | undefined,
): Promise<string> {
  const args = ['status', '--porcelain', '-z', '-uall']
  if (scope !== undefined) args.push('--', scope)
  const status = await gitText(ctx, cwd, args)
  if (status.length === 0) return ''

  const untracked: string[] = []
  const restore: string[] = []
  const unmerged: string[] = []
  const renameSources: string[] = []
  for (const entry of parsePorcelainEntries(status)) {
    if (entry.y === '?') {
      untracked.push(entry.path)
      continue
    }
    if (entry.y === ' ') continue
    if (UNMERGED.has(entry.x) || UNMERGED.has(entry.y)) unmerged.push(entry.path)
    else restore.push(entry.path)
    // A rename keeps its new path in the index only; the source path stays
    // behind in the worktree as an ordinary file, so it has to go too.
    if (entry.oldPath !== undefined) renameSources.push(entry.oldPath)
  }

  const out: string[] = []
  for (const batch of batched(restore, PATH_BATCH)) {
    out.push(await gitText(ctx, cwd, ['restore', '-W', '--', ...batch]))
  }
  // Unmerged paths have no index content to restore: HEAD is the only version
  // that resolves them, and it is also the merge's "ours" side.
  for (const batch of batched(unmerged, PATH_BATCH)) {
    out.push(await gitText(ctx, cwd, ['checkout', '-f', 'HEAD', '--', ...batch]))
  }
  // Only the paths themselves, never `clean -fd` over the whole tree: a
  // pathspec keeps the deletion to what the panel listed, while an unscoped
  // clean would also take ignored-only neighbours and anything the status
  // read missed. A path the index dropped is untracked to git now, so clean
  // reaches it here too.
  const removed = [...renameSources, ...untracked]
  for (const batch of batched(removed, PATH_BATCH)) {
    out.push(await gitText(ctx, cwd, ['clean', '-fd', '--', ...batch]))
  }
  return out.filter((part) => part.length > 0).join('\n')
}

/** Chunk paths so one git call never approaches the platform argv limit. */
function batched(paths: readonly string[], size: number): string[][] {
  const batches: string[][] = []
  for (let index = 0; index < paths.length; index += size) {
    batches.push(paths.slice(index, index + size))
  }
  return batches
}

/** True when the index differs from HEAD (git diff --cached --quiet). */
async function hasStagedChanges(ctx: Context, cwd: string): Promise<boolean> {
  const result = await runGit(ctx, cwd, ['diff', '--cached', '--quiet', '--'], ACTION_TIMEOUT_MS, MAX_BUFFER)
  if (result.timedOut) throw new Error('git diff timed out')
  return result.exitCode === 1
}

function buildArgs(
  action: CommitAction,
  sha: string,
  branch: string | undefined,
  mode: GitResetMode | undefined,
): string[] {
  switch (action) {
    case 'checkout':
      return ['checkout', '--detach', sha]
    case 'create-branch': {
      const name = (branch ?? '').trim()
      if (!isSafeBranchName(name)) throw badRequest('invalid branch name')
      return ['checkout', '-b', name, sha]
    }
    case 'cherry-pick':
      return ['cherry-pick', sha]
    case 'revert':
      return ['revert', '--no-edit', sha]
    case 'reset':
      return ['reset', resetFlag(mode ?? 'mixed'), sha]
  }
}

function resetFlag(mode: GitResetMode): '--soft' | '--mixed' | '--hard' {
  if (mode === 'soft') return '--soft'
  if (mode === 'hard') return '--hard'
  return '--mixed'
}

function isSafeBranchName(name: string): boolean {
  if (name.length === 0 || name.length > 128) return false
  if (name.includes('..') || name.includes('//') || name.endsWith('.lock')) return false
  if (name.startsWith('-') || name.endsWith('/') || name.endsWith('.')) return false
  return BRANCH_RE.test(name)
}

async function assertGitRepo(ctx: Context, cwd: string): Promise<void> {
  try {
    const inside = await gitText(ctx, cwd, ['rev-parse', '--is-inside-work-tree'])
    if (inside === 'true') return
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/not a git repository/i.test(message)) throw error
  }
  const error = new Error('not a git repository')
  error.name = 'NotGit'
  throw error
}

async function gitText(ctx: Context, cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execGit(ctx, cwd, args, ACTION_TIMEOUT_MS, MAX_BUFFER)
    return [stdout, stderr].filter((part) => part.trim().length > 0).join('\n').replace(/\n+$/, '')
  } catch (error) {
    throw new Error(gitErrorMessage(error))
  }
}

function gitErrorMessage(error: unknown): string {
  if (error !== null && typeof error === 'object') {
    const stderr = 'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '') : ''
    const message = 'message' in error ? String((error as { message?: unknown }).message ?? '') : ''
    const text = stderr.trim() || message.trim()
    if (text.length > 0) return text
  }
  return String(error)
}

function badRequest(message: string): Error {
  const error = new Error(message)
  error.name = 'BadRequest'
  return error
}

/** Validate a repo-relative path coming from the client. */
function safePath(path: string | undefined): string {
  const value = (path ?? '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (
    value.length === 0
    || value.includes('\0')
    || value.includes('..')
    || value.includes('//')
    || value.startsWith('-')
  ) {
    throw badRequest('invalid path')
  }
  return value
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
