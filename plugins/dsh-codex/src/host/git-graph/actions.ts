import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  GitGraphActionName,
  GitGraphActionRequest,
  GitResetMode,
} from '../../shared/git-graph'

const execFileAsync = promisify(execFile)
const ACTION_TIMEOUT_MS = 30_000
const MAX_BUFFER = 8 * 1024 * 1024
const SHA_RE = /^[0-9a-f]{7,40}$/i
const BRANCH_RE = /^(?!\/)[A-Za-z0-9._][A-Za-z0-9._/-]*$/

export async function runGraphAction(request: GitGraphActionRequest): Promise<string> {
  await assertGitRepo(request.cwd)
  if (isCommitAction(request.action)) {
    const sha = (request.sha ?? '').trim()
    if (!SHA_RE.test(sha)) {
      throw badRequest('invalid commit')
    }
    const args = buildArgs(request.action, sha, request.branch, request.mode)
    return gitText(request.cwd, args)
  }
  return runWorkdirAction(request)
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
 * VSCode's source-control panel: with `all` the client already confirmed
 * "stage all and commit", so everything (untracked included) is added first;
 * otherwise the index is committed as-is, falling back to `commit -a` (all
 * tracked changes) when nothing is staged. Amend never sweeps in unstaged
 * changes implicitly.
 */
async function runWorkdirAction(request: GitGraphActionRequest): Promise<string> {
  const cwd = request.cwd
  switch (request.action) {
    case 'commit':
    case 'commit-push':
    case 'commit-amend':
    case 'commit-push-amend': {
      const message = (request.message ?? '').trim()
      if (message.length === 0) throw badRequest('empty commit message')
      const amend = request.action === 'commit-amend' || request.action === 'commit-push-amend'
      if (request.all === true) await gitText(cwd, ['add', '-A'])
      // Amend with nothing staged is legal and simply rewrites the message.
      const args = ['commit']
      if (amend) {
        args.push('--amend', '-m', message)
      } else if (request.all === true || (await hasStagedChanges(cwd))) {
        args.push('-m', message)
      } else {
        args.push('-am', message)
      }
      const out = await gitText(cwd, args)
      if (request.action === 'commit' || request.action === 'commit-amend') return out
      const push = await gitText(cwd, ['push'])
      return [out, push].filter((part) => part.length > 0).join('\n')
    }
    case 'stage':
      return gitText(cwd, ['add', '--', safePath(request.path)])
    case 'unstage': {
      const path = safePath(request.path)
      try {
        return await gitText(cwd, ['reset', '-q', 'HEAD', '--', path])
      } catch (error) {
        // Unborn HEAD (no commits yet): the index entry can only come out
        // with rm --cached.
        if (!/ambiguous argument|unknown revision|Failed to resolve/i.test(errorMessage(error))) {
          throw error
        }
        return gitText(cwd, ['rm', '-q', '-r', '--cached', '--', path])
      }
    }
    case 'stage-all':
      return gitText(cwd, ['add', '-A'])
    case 'unstage-all': {
      try {
        return await gitText(cwd, ['reset', '-q', 'HEAD', '--'])
      } catch (error) {
        // Unborn HEAD (no commits yet): empty the index with rm --cached.
        if (!/ambiguous argument|unknown revision|Failed to resolve/i.test(errorMessage(error))) {
          throw error
        }
        return gitText(cwd, ['rm', '-q', '-r', '--cached', '--ignore-unmatch', '--', '.'])
      }
    }
    case 'discard': {
      // VSCode parity: untracked files are deleted, tracked files are
      // restored from the index (worktree side only — staged changes stay).
      // The path may be a directory (tree-view folder discard), which can
      // hold both kinds at once, so each side is handled independently.
      const path = safePath(request.path)
      const status = await gitText(cwd, ['status', '--porcelain', '-z', '--', path])
      if (status.length === 0) return ''
      const entries = status.split('\0').filter((entry) => entry.length > 0)
      const out: string[] = []
      if (entries.some((entry) => !entry.startsWith('??'))) {
        out.push(await gitText(cwd, ['checkout', '--', path]))
      }
      if (entries.some((entry) => entry.startsWith('??'))) {
        // -d: an untracked path can be a whole directory.
        out.push(await gitText(cwd, ['clean', '-fd', '--', path]))
      }
      return out.filter((part) => part.length > 0).join('\n')
    }
    case 'discard-all': {
      const reset = await gitText(cwd, ['reset', '--hard', 'HEAD'])
      const clean = await gitText(cwd, ['clean', '-fd'])
      return [reset, clean].filter((part) => part.length > 0).join('\n')
    }
    case 'pull':
      return gitText(cwd, ['pull', '--ff-only'])
    case 'push':
      return gitText(cwd, ['push'])
    case 'fetch':
      return gitText(cwd, ['fetch', '--all', '--prune'])
    case 'stash':
      return gitText(cwd, ['stash', 'push', '-u'])
    case 'stash-pop':
      return gitText(cwd, ['stash', 'pop'])
    default:
      throw badRequest('invalid action')
  }
}

/** True when the index differs from HEAD (`git diff --cached --quiet`). */
async function hasStagedChanges(cwd: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['diff', '--cached', '--quiet', '--'], {
      cwd,
      timeout: ACTION_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    })
    return false
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === 1) return true
    throw new Error(gitErrorMessage(error))
  }
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

async function assertGitRepo(cwd: string): Promise<void> {
  try {
    const inside = await gitText(cwd, ['rev-parse', '--is-inside-work-tree'])
    if (inside === 'true') return
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/not a git repository/i.test(message)) throw error
  }
  const error = new Error('not a git repository')
  error.name = 'NotGit'
  throw error
}

async function gitText(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout: ACTION_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
    })
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
