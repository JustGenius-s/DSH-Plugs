import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import { join, posix, resolve } from 'node:path'
import { execGit } from './git-exec'
import type {
  GitChangeFile,
  GitChangeStatus,
  GitFileDiff,
  GitTreeEntry,
} from '../../shared/git-graph'

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 8_000
const MAX_BUFFER = 32 * 1024 * 1024
const FIELD = '\x1f'

const STATUS_TO_CHANGE: Record<string, GitChangeStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  U: 'conflicted',
  '??': 'untracked',
}

/**
 * Files changed by a commit, or in the working tree when `sha` is absent.
 *
 * Commit mode: `git diff-tree --no-commit-id --name-status -z -r <sha>`.
 * Working-tree mode: `git status --porcelain -z` (renames/copies follow the
 * `X\told -> new` shape of porcelain v1 with -z). Insertion/deletion counts
 * are read with `--numstat` in both modes.
 */
export async function loadChangeFiles(
  cwd: string,
  sha?: string,
): Promise<GitChangeFile[]> {
  await assertGitRepo(cwd)
  if (sha !== undefined) {
    // A merge commit diffs against its FIRST parent — the branch the merge
    // landed on. Bare `diff-tree <merge>` prints nothing at all, and
    // `-m --first-parent` still splits the output per parent, so the first
    // parent is resolved explicitly and the two-tree form is used. A root
    // commit has no parent and keeps the single-commit `--root` form.
    const firstParent = await gitText(
      cwd,
      ['rev-parse', '--verify', '--quiet', sha + '^1'],
      GIT_TIMEOUT_MS,
    ).catch(() => '')
    const trees = firstParent === '' ? ['--root', sha] : [firstParent, sha]
    const nameStatus = await gitText(
      cwd,
      ['diff-tree', '--no-commit-id', '--name-status', '-z', '-r', '-M', ...trees, '--'],
      GIT_TIMEOUT_MS,
    )
    const numstat = await gitText(
      cwd,
      ['diff-tree', '--no-commit-id', '--numstat', '-r', '-M', ...trees, '--'],
      GIT_TIMEOUT_MS,
    ).catch(() => '')
    const counts = parseNumstat(numstat)
    const files = parseNameStatusZ(nameStatus, true)
    for (const file of files) {
      const count = counts.get(file.path)
      if (count !== undefined) {
        file.added = count.added
        file.removed = count.removed
      }
    }
    return files
  }

  const porcelain = await gitText(
    cwd,
    ['status', '--porcelain', '-z', '-uall'],
    GIT_TIMEOUT_MS,
  )
  const files = parsePorcelainZ(porcelain)
  if (files.length === 0) return files

  // Per-side +/- counts: staged entries read the index diff, unstaged ones
  // the worktree-vs-index diff (untracked files get no counts).
  const [cachedNumstat, worktreeNumstat] = await Promise.all([
    gitText(cwd, ['diff', '--cached', '--numstat', '--'], GIT_TIMEOUT_MS).catch(() => ''),
    gitText(cwd, ['diff', '--numstat', '--'], GIT_TIMEOUT_MS).catch(() => ''),
  ])
  const cachedCounts = parseNumstat(cachedNumstat)
  const worktreeCounts = parseNumstat(worktreeNumstat)
  for (const file of files) {
    const count = (file.staged === true ? cachedCounts : worktreeCounts).get(file.path)
    if (count !== undefined) {
      file.added = count.added
      file.removed = count.removed
    }
  }
  return files
}

/**
 * The full working-tree file listing, flat (every entry is a file with its
 * repo-relative `path`; the client assembles directories itself). Tracked
 * files come from `git ls-files -z`, statuses from
 * `git status --porcelain -z -uall`; untracked files — which `ls-files`
 * never reports — are merged in from the status side, so the browser shows
 * work-in-progress too. `path`, when given, restricts the listing to that
 * directory.
 *
 * Loading everything in one round trip (instead of one request per expanded
 * directory) keeps panel search honest: a query can match any file in the
 * repo, not just the ones already fetched.
 */
export async function loadTree(cwd: string, path: string): Promise<GitTreeEntry[]> {
  await assertGitRepo(cwd)
  const root = posixSafe(path)
  const tracked = await gitText(
    cwd,
    ['ls-files', '-z', '--', root === '' ? '.' : root],
    GIT_TIMEOUT_MS,
  ).catch(() => '')
  const porcelain = await gitText(
    cwd,
    ['status', '--porcelain', '-z', '-uall'],
    GIT_TIMEOUT_MS,
  ).catch(() => '')
  const statusByPath = new Map<string, GitChangeStatus>()
  for (const file of parsePorcelainZ(porcelain)) {
    statusByPath.set(file.path, file.status)
  }

  const entries = new Map<string, GitTreeEntry>()
  const prefix = root === '' ? '' : root + '/'
  const put = (file: string, status: GitChangeStatus | undefined): void => {
    if (file.length === 0 || entries.has(file)) return
    if (prefix !== '' && !file.startsWith(prefix)) return
    const slash = file.lastIndexOf('/')
    entries.set(file, {
      name: slash === -1 ? file : file.slice(slash + 1),
      path: file,
      kind: 'file',
      status,
    })
  }
  for (const file of tracked.split('\0')) {
    put(file, statusByPath.get(file))
  }
  // Untracked files never appear in ls-files; deleted ones drop out of it.
  for (const [file, status] of statusByPath) {
    put(file, status)
  }
  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/** Image extensions the panel previews inline, mapped to their MIME type. */
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  avif: 'image/avif',
}

export interface LoadedFile {
  content: string
  encoding: 'utf8' | 'base64'
  mime?: string
  binary?: boolean
  /** True when the path names a directory, not a file (worktree reads). */
  directory?: boolean
  exists: boolean
}

/**
 * File contents at a commit, or from the working tree when `sha` is absent.
 * Images come back base64-encoded with their MIME type so the panel can
 * render them inline; other binary files are flagged `binary` with empty
 * content. Returns `exists: false` when the path is not present at the
 * given revision.
 *
 * Worktree reads accept absolute paths too — a chat link can point anywhere
 * on disk, and previewing it is read-only file IO. Commit reads (sha set)
 * stay repo-relative: `posixSafe` keeps git path arguments inside the tree.
 */
export async function loadFile(
  cwd: string,
  path: string,
  sha?: string,
): Promise<LoadedFile> {
  if (sha !== undefined) await assertGitRepo(cwd)
  const worktree = sha === undefined ? resolveWorktreePath(cwd, path) : undefined
  if (worktree === null) {
    throw badRequest('invalid file path')
  }
  const safePath = worktree === undefined ? posixSafe(path) : undefined
  if (safePath !== undefined && safePath.length === 0) {
    throw badRequest('invalid file path')
  }
  if (worktree !== undefined) {
    const info = await stat(worktree).catch(() => null)
    if (info === null) return { content: '', encoding: 'utf8', exists: false }
    if (info.isDirectory()) {
      return { content: '', encoding: 'utf8', directory: true, exists: true }
    }
  }
  const bytes =
    worktree !== undefined
      ? await readWorktreeBytes(worktree)
      : await readCommitBytes(cwd, safePath as string, sha as string)
  if (bytes === null) {
    return { content: '', encoding: 'utf8', exists: false }
  }
  const mime = IMAGE_MIME[extensionOf(worktree ?? (safePath as string))]
  if (mime !== undefined) {
    return { content: bytes.toString('base64'), encoding: 'base64', mime, exists: true }
  }
  if (looksBinary(bytes)) {
    return { content: '', encoding: 'utf8', binary: true, exists: true }
  }
  return { content: bytes.toString('utf8'), encoding: 'utf8', exists: true }
}

/**
 * Absolute filesystem path for a worktree read, or null when the path is
 * unusable (empty, or carrying a NUL byte). Relative input resolves against
 * `cwd` and must survive `posixSafe`; absolute input (POSIX or a Windows
 * drive path) is normalized and used as-is — it may point anywhere on disk.
 */
function resolveWorktreePath(cwd: string, path: string): string | null {
  const trimmed = path.trim()
  if (trimmed.length === 0 || trimmed.includes('\0')) return null
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return resolve(trimmed)
  }
  return join(cwd, ...posixSafe(trimmed).split('/'))
}

/** Raw bytes of a worktree file (`cat`); null when the path is absent. */
async function readWorktreeBytes(abs: string): Promise<Buffer | null> {
  try {
    const { stdout } = (await execFileAsync('cat', [abs], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      encoding: 'buffer',
    })) as unknown as { stdout: Buffer }
    return stdout
  } catch (error) {
    const message = errorMessage(error)
    if (/no such file/i.test(message)) return null
    throw new Error(message)
  }
}

/**
 * Raw bytes of a committed blob (`git show <sha>:<path>`); null when the
 * path is absent at that revision.
 */
async function readCommitBytes(
  cwd: string,
  path: string,
  sha: string,
): Promise<Buffer | null> {
  try {
    const { stdout } = (await execFileAsync('git', ['show', sha + ':' + path], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      encoding: 'buffer',
      cwd,
    })) as unknown as { stdout: Buffer }
    return stdout
  } catch (error) {
    const message = gitErrorMessage(error)
    if (/does not exist|invalid object name|exists on disk, but not in/i.test(message)) {
      return null
    }
    throw new Error(message)
  }
}

/** Heuristic: a NUL byte in the first chunk marks the file as binary. */
function looksBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8000).includes(0)
}

function extensionOf(path: string): string {
  const slash = path.lastIndexOf('/')
  const name = slash === -1 ? path : path.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return ''
  return name.slice(dot + 1).toLowerCase()
}

/**
 * One file's diff. With `sha`, the change that commit introduced to `path`
 * (`<sha>^..<sha>`; a root commit diffs against the empty tree). Without a
 * `sha`, the working tree against HEAD. Returns `null` when the path has no
 * change at that point (no worktree change, or the commit did not touch it).
 */
export async function loadFileDiff(
  cwd: string,
  path: string,
  sha?: string,
): Promise<GitFileDiff | null> {
  await assertGitRepo(cwd)
  const safePath = posixSafe(path)
  if (safePath.length === 0) {
    throw badRequest('invalid file path')
  }

  if (sha !== undefined) {
    // `git show <sha>` diffs the commit against its parent — root commits
    // against the empty tree — and prints nothing for untouched paths.
    // `--first-parent` picks the landing-side parent for merges; without it
    // `show` falls back to a combined diff that is empty for clean merges.
    const patch = await runDiff(cwd, [
      'show',
      '--no-color',
      '--no-ext-diff',
      '--format=',
      '--unified=3',
      '--no-renames',
      '--first-parent',
      sha,
      '--',
      safePath,
    ])
    // No textual diff: could be a pure rename or binary. Report as no change.
    return patch === null ? null : { path: safePath, patch }
  }

  // Working tree vs HEAD.
  const worktree = await runDiff(
    cwd,
    ['diff', '--no-color', '--no-ext-diff', '--unified=3', 'HEAD', '--', safePath],
  )
  if (worktree !== null) return { path: safePath, patch: worktree }

  const cached = await runDiff(
    cwd,
    ['diff', '--cached', '--no-color', '--no-ext-diff', '--unified=3', '--', safePath],
  )
  if (cached !== null) return { path: safePath, patch: cached }

  // No staged/unstaged change. An untracked file still reads as a new file.
  const tracked = await gitText(
    cwd,
    ['ls-files', '--', safePath],
    GIT_TIMEOUT_MS,
  ).catch(() => '')
  if (tracked.trim().length === 0) {
    const { content, exists } = await loadFile(cwd, safePath)
    if (exists) {
      return { path: safePath, patch: synthesizeNewFilePatch(safePath, content) }
    }
  }
  return null
}

/**
 * Run a diff command restricted to one path and return the raw unified patch.
 * Returns null when the diff is empty (no change at that path).
 */
async function runDiff(cwd: string, args: string[]): Promise<string | null> {
  const { stdout } = await execGit(cwd, args, GIT_TIMEOUT_MS, MAX_BUFFER)
    .catch((error: unknown) => {
      const message = gitErrorMessage(error)
      if (/unknown revision/i.test(message)) return { stdout: '', stderr: message }
      throw new Error(message)
    })
  const patch = stdout.replace(/\n+$/, '')
  return patch.length === 0 ? null : patch
}

/**
 * Build the unified patch git would print for an untracked file: every
 * content line is an addition against the empty old side.
 */
function synthesizeNewFilePatch(path: string, content: string): string {
  const body = content.endsWith('\n') ? content.slice(0, -1) : content
  const lines = body.length === 0 ? [] : body.split('\n')
  const header = [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
  ]
  return [...header, ...lines.map((line) => '+' + line)].join('\n')
}

/** `git diff-tree --name-status -z` output → change files. */
function parseNameStatusZ(raw: string, followRenames: boolean): GitChangeFile[] {
  const parts = raw.split('\0')
  const files: GitChangeFile[] = []
  for (let index = 0; index < parts.length; index += 1) {
    const token = parts[index]
    if (token === undefined || token.length === 0) continue
    if (followRenames && (token.startsWith('R') || token.startsWith('C'))) {
      const oldPath = parts[index + 1]
      const newPath = parts[index + 2]
      if (oldPath !== undefined && newPath !== undefined) {
        files.push({
          path: newPath,
          oldPath,
          status: token.startsWith('R') ? 'renamed' : 'copied',
        })
        index += 2
        continue
      }
    }
    const status = STATUS_TO_CHANGE[token] ?? 'modified'
    const path = parts[index + 1]
    if (path !== undefined && path.length > 0) {
      files.push({ path, status })
      index += 1
    }
  }
  return files
}

/** `git status --porcelain -z` output → change files.
 *
 * With `-z` each entry is NUL-separated. A normal entry is one field
 * `XY <path>`; a rename/copy is TWO fields `R  <newPath>` then `<oldPath>`
 * (the target comes first). Untracked directories are only shown collapsed
 * (`?? dir/`) unless `-uall` was passed; callers pass `-uall` so untracked
 * files appear individually.
 *
 * X is the index (staged) side, Y the worktree side; a path changed in both
 * (`MM`) yields one entry per side, flagged via `staged`, so the client can
 * group them the way VSCode does.
 */
function parsePorcelainZ(raw: string): GitChangeFile[] {
  const parts = raw.split('\0')
  const files: GitChangeFile[] = []
  for (let index = 0; index < parts.length; index += 1) {
    const token = parts[index]
    if (token === undefined || token.length === 0) continue
    const x = token[0] ?? ' '
    const y = token[1] ?? ' '
    const body = token.length >= 3 ? token.slice(3) : ''
    if (x === '?' && y === '?') {
      files.push({ path: body, status: 'untracked', staged: false })
      continue
    }
    if (x === 'R' || x === 'C') {
      // Two fields: <newPath> then <oldPath>. The rename itself is staged;
      // y may still flag further unstaged edits to the new path.
      const newPath = body
      const oldPath = parts[index + 1]
      if (newPath.length > 0 && oldPath !== undefined) {
        files.push({
          path: newPath,
          oldPath,
          status: x === 'R' ? 'renamed' : 'copied',
          staged: true,
        })
        index += 1
        if (y !== ' ' && y !== '?') {
          files.push({ path: newPath, status: STATUS_TO_CHANGE[y] ?? 'modified', staged: false })
        }
        continue
      }
    }
    if (body.length === 0) continue
    if (x !== ' ' && x !== '?') {
      files.push({ path: body, status: STATUS_TO_CHANGE[x] ?? 'modified', staged: true })
    }
    if (y !== ' ' && y !== '?') {
      files.push({ path: body, status: STATUS_TO_CHANGE[y] ?? 'modified', staged: false })
    }
  }
  return files
}

/** `git diff --numstat` output → path → {added, removed}. */
function parseNumstat(raw: string): Map<string, { added: number; removed: number }> {
  const counts = new Map<string, { added: number; removed: number }>()
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const second = line.indexOf('\t', tab + 1)
    if (second === -1) continue
    const added = Number.parseInt(line.slice(0, tab), 10)
    const removed = Number.parseInt(line.slice(tab + 1, second), 10)
    let path = line.slice(second + 1).trim()
    // Rename/copy paths print as `old => new`; keep the destination so the
    // count lines up with the name-status newPath.
    const arrow = path.indexOf(' => ')
    if (arrow !== -1) path = path.slice(arrow + 4)
    if (path.length === 0 || Number.isNaN(added) || Number.isNaN(removed)) continue
    counts.set(path, { added, removed })
  }
  return counts
}

/** Strip a leading `./` and normalize separators for git path arguments. */
function posixSafe(path: string): string {
  const trimmed = path.trim().replace(/\\/g, '/')
  const normalized = trimmed.startsWith('./') ? trimmed.slice(2) : trimmed
  const cleaned = normalized.replace(/^\/+/, '')
  if (cleaned.includes('\0') || cleaned.includes('..') || cleaned.includes('//')) {
    throw badRequest('invalid path')
  }
  return cleaned
}

async function assertGitRepo(cwd: string): Promise<void> {
  try {
    const inside = await gitText(cwd, ['rev-parse', '--is-inside-work-tree'], GIT_TIMEOUT_MS)
    if (inside === 'true') return
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/not a git repository/i.test(message)) throw error
  }
  const error = new Error('not a git repository')
  error.name = 'NotGit'
  throw error
}

async function gitText(cwd: string, args: string[], timeout: number): Promise<string> {
  const { stdout } = await execGit(cwd, args, timeout, MAX_BUFFER)
  return stdout.replace(/\n+$/, '')
}

function gitErrorMessage(error: unknown): string {
  if (error !== null && typeof error === 'object') {
    const stderr = 'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '') : ''
    const message = 'message' in error ? String((error as { message?: unknown }).message ?? '') : ''
    return stderr.trim() || message.trim()
  }
  return String(error)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function badRequest(message: string): Error {
  const error = new Error(message)
  error.name = 'BadRequest'
  return error
}
