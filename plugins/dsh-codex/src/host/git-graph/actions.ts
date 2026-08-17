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
  const sha = request.sha.trim()
  if (!SHA_RE.test(sha)) {
    throw badRequest('invalid commit')
  }
  await assertGitRepo(request.cwd)
  const args = buildArgs(request.action, sha, request.branch, request.mode)
  return gitText(request.cwd, args)
}

function buildArgs(
  action: GitGraphActionName,
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
