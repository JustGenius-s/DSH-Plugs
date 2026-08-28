import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { execGit, runGitBuffer, runGitWithStdin } from './git-exec'
import type {
  GitChangeFile,
  GitChangeStatus,
  GitFileDiff,
  GitTreeEntry,
} from '../../shared/git-graph'

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
 * Files changed by a commit, or in the working tree when sha is absent.
 *
 * Commit mode: git diff-tree --no-commit-id --name-status -z -r sha.
 * Working-tree mode: git status --porcelain -z (renames/copies follow the
 * X[tab]old -> new shape of porcelain v1 with -z). Insertion/deletion counts
 * are read with --numstat in both modes.
 */
export async function loadChangeFiles(
  ctx: Context,
  cwd: string,
  sha?: string,
): Promise<GitChangeFile[]> {
  await assertGitRepo(ctx, cwd)
  if (sha !== undefined) {
    // A merge commit diffs against its FIRST parent, the branch the merge
    // landed on. Bare diff-tree merge prints nothing, and -m --first-parent
    // still splits the output per parent, so the first parent is resolved
    // explicitly and the two-tree form is used. A root commit has no parent
    // and keeps the single-commit --root form.
    const firstParent = await gitText(
      ctx,
      cwd,
      ['rev-parse', '--verify', '--quiet', sha + '^1'],
      GIT_TIMEOUT_MS,
    ).catch(() => '')
    const trees = firstParent === '' ? ['--root', sha] : [firstParent, sha]
    const nameStatus = await gitText(
      ctx,
      cwd,
      ['diff-tree', '--no-commit-id', '--name-status', '-z', '-r', '-M', ...trees, '--'],
      GIT_TIMEOUT_MS,
    )
    const numstat = await gitText(
      ctx,
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
    ctx,
    cwd,
    ['status', '--porcelain', '-z', '-uall'],
    GIT_TIMEOUT_MS,
  )
  const files = parsePorcelainZ(porcelain)
  if (files.length === 0) return files

  // Per-side +/- counts: staged entries read the index diff, unstaged ones
  // the worktree-vs-index diff (untracked files get no counts).
  const [cachedNumstat, worktreeNumstat] = await Promise.all([
    gitText(ctx, cwd, ['diff', '--cached', '--numstat', '--'], GIT_TIMEOUT_MS).catch(() => ''),
    gitText(ctx, cwd, ['diff', '--numstat', '--'], GIT_TIMEOUT_MS).catch(() => ''),
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

/** Cap on explorer search hits (matches the client MAX_SEARCH_ROWS). */
const TREE_SEARCH_LIMIT = 200
/** Safety cap so a rare query cannot walk an entire node_modules tree. */
const TREE_SEARCH_MAX_DIRS = 2_500

export interface LoadTreeOptions {
  /** When false, drop paths matched by .gitignore / exclude rules. Default true. */
  showIgnored?: boolean
}

/**
 * One directory of the working-tree browser (VS Code Explorer style).
 *
 * Uses the filesystem seam (ctx.fs) so gitignored paths (node_modules, build
 * outputs, etc.) can appear. .git is the only name always skipped. path is the
 * workspace-relative directory to list ('' = workspace root). Children are not
 * recursed; the client loads each folder when the user expands it.
 *
 * In a Git repository, status from status --porcelain -z -uall is overlaid on
 * files so modified / untracked badges still show. When showIgnored is true
 * (default), gitignored rows are kept and flagged ignored for a faded Explorer
 * look; pass showIgnored: false to hide them entirely. Plain folders remain
 * browsable and simply omit Git-specific status and ignore decorations.
 */
export async function loadTree(
  ctx: Context,
  cwd: string,
  path: string,
  options: LoadTreeOptions = {},
): Promise<GitTreeEntry[]> {
  const showIgnored = options.showIgnored !== false
  const gitRepo = await isGitRepo(ctx, cwd)
  const root = posixSafe(path)
  const statusByPath = gitRepo
    ? await loadStatusByPath(ctx, cwd)
    : new Map<string, GitChangeStatus>()

  const dirTarget = await ctx.fs.resolve(root === '' ? '.' : root, { cwd })
  let children
  try {
    children = await ctx.fs.listDir(dirTarget)
  } catch (error) {
    if (isFsMissing(error)) return []
    throw error
  }

  const entries: GitTreeEntry[] = []
  for (const child of children) {
    if (child.name === '.git') continue
    const rel = root === '' ? child.name : root + '/' + child.name
    const kind: 'dir' | 'file' = child.type === 'directory' ? 'dir' : 'file'
    entries.push({
      name: child.name,
      path: rel,
      kind,
      status: kind === 'file' ? statusByPath.get(rel) : undefined,
    })
  }
  // Inside an already-ignored directory every child is ignored (same as
  // VS Code's per-URI checkIgnore under node_modules / lib / etc.).
  const parentIgnored = gitRepo && showIgnored && root !== ''
    && (await gitIgnoredPaths(ctx, cwd, [root])).has(root)
  let visible: GitTreeEntry[]
  if (!gitRepo) {
    visible = entries
  } else if (!showIgnored) {
    visible = await dropGitIgnored(ctx, cwd, entries)
  } else if (parentIgnored) {
    visible = entries.map((entry) => ({ ...entry, ignored: true as const }))
  } else {
    visible = await markGitIgnored(ctx, cwd, entries)
  }
  visible.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return visible
}

/**
 * Flat file search across the worktree. BFS from the workspace root, stops after
 * TREE_SEARCH_LIMIT hits or TREE_SEARCH_MAX_DIRS directories visited so huge
 * trees stay bounded.
 *
 * In Git repositories, ignored directories are never entered (same as VS Code
 * Quick Open / file search) even when the Explorer setting shows gitignored
 * rows. Walking
 * node_modules while marking every child with check-ignore took ~26s on this
 * repo and left the client stuck on "loading".
 */
export async function searchTree(
  ctx: Context,
  cwd: string,
  query: string,
  options: LoadTreeOptions = {},
): Promise<GitTreeEntry[]> {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return []
  const showIgnored = options.showIgnored !== false
  const gitRepo = await isGitRepo(ctx, cwd)
  const statusByPath = gitRepo
    ? await loadStatusByPath(ctx, cwd)
    : new Map<string, GitChangeStatus>()
  const matches: GitTreeEntry[] = []
  const queue: string[] = ['']
  let visited = 0
  while (queue.length > 0 && matches.length < TREE_SEARCH_LIMIT && visited < TREE_SEARCH_MAX_DIRS) {
    const dir = queue.shift() ?? ''
    visited += 1
    const dirTarget = await ctx.fs.resolve(dir === '' ? '.' : dir, { cwd })
    let children
    try {
      children = await ctx.fs.listDir(dirTarget)
    } catch {
      continue
    }
    const pending: GitTreeEntry[] = []
    for (const child of children) {
      if (child.name === '.git') continue
      const rel = dir === '' ? child.name : dir + '/' + child.name
      const isDir = child.type === 'directory'
      pending.push({
        name: child.name,
        path: rel,
        kind: isDir ? 'dir' : 'file',
        status: isDir ? undefined : statusByPath.get(rel),
      })
    }
    // In a repository, classify ignore so search can skip ignored dirs. When
    // the Explorer setting hides them, drop those rows from results entirely.
    const annotated = gitRepo
      ? await markGitIgnored(ctx, cwd, pending)
      : pending
    const visible = showIgnored
      ? annotated
      : annotated.filter((entry) => entry.ignored !== true)
    for (const entry of visible) {
      if (entry.kind === 'dir') {
        // Never descend into gitignored folders (node_modules, dist, etc.).
        if (entry.ignored === true) continue
        queue.push(entry.path)
        continue
      }
      if (!entry.path.toLowerCase().includes(needle)) continue
      matches.push(entry)
      if (matches.length >= TREE_SEARCH_LIMIT) break
    }
  }
  return matches
}

/**
 * Annotate entries that git check-ignore reports as excluded so the client
 * can apply gitDecoration.ignoredResourceForeground. Tracked paths and paths
 * matched only by a negation pattern stay unmarked, same as VS Code's
 * GitIgnoreDecorationProvider.
 */
async function markGitIgnored(
  ctx: Context,
  cwd: string,
  entries: readonly GitTreeEntry[],
): Promise<GitTreeEntry[]> {
  if (entries.length === 0) return []
  const ignored = await gitIgnoredPaths(ctx, cwd, entries.map((entry) => entry.path))
  if (ignored.size === 0) return [...entries]
  return entries.map((entry) => (
    ignored.has(entry.path) ? { ...entry, ignored: true } : entry
  ))
}

/**
 * Drop entries that git check-ignore reports as excluded. Tracked files that
 * happen to match a pattern stay (check-ignore skips the index).
 */
async function dropGitIgnored(
  ctx: Context,
  cwd: string,
  entries: readonly GitTreeEntry[],
): Promise<GitTreeEntry[]> {
  if (entries.length === 0) return []
  const ignored = await gitIgnoredPaths(ctx, cwd, entries.map((entry) => entry.path))
  if (ignored.size === 0) return [...entries]
  return entries.filter((entry) => !ignored.has(entry.path))
}

/**
 * Paths that match a git exclude rule.
 *
 * Mirrors VS Code Repository.checkIgnore: check-ignore -v -z --stdin, then
 * keep only records whose pattern does not start with a bang. Output records
 * are source NUL linenum NUL pattern NUL path NUL (see git check-ignore docs).
 */
async function gitIgnoredPaths(ctx: Context, cwd: string, paths: readonly string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set()
  const result = await runGitWithStdin(
    ctx,
    cwd,
    ['check-ignore', '-v', '-z', '--stdin'],
    paths.join('\0') + '\0',
    GIT_TIMEOUT_MS,
    MAX_BUFFER,
  ).catch(() => undefined)
  const ignored = new Set<string>()
  if (result === undefined) return ignored
  const parts = result.stdout.split('\0')
  for (let i = 0; i + 3 < parts.length; i += 4) {
    const pattern = parts[i + 2]
    const path = parts[i + 3]
    if (pattern !== undefined && pattern.length > 0 && !pattern.startsWith('!')
      && path !== undefined && path.length > 0) {
      ignored.add(path)
    }
  }
  return ignored
}

/** Working-tree porcelain -> path -> status (first side wins if duplicated). */
async function loadStatusByPath(ctx: Context, cwd: string): Promise<Map<string, GitChangeStatus>> {
  const porcelain = await gitText(
    ctx,
    cwd,
    ['status', '--porcelain', '-z', '-uall'],
    GIT_TIMEOUT_MS,
  ).catch(() => '')
  const statusByPath = new Map<string, GitChangeStatus>()
  for (const file of parsePorcelainZ(porcelain)) {
    if (!statusByPath.has(file.path)) statusByPath.set(file.path, file.status)
  }
  return statusByPath
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
 * File contents at a commit, or from the working tree when sha is absent.
 * Images come back base64-encoded with their MIME type so the panel can
 * render them inline; other binary files are flagged binary with empty
 * content. Returns exists: false when the path is not present at the given
 * revision.
 *
 * Worktree reads go through ctx.fs (the fs-local backend is a resolution
 * default, not a containment boundary), so a chat link can point anywhere on
 * disk. Commit reads (sha set) stay repo-relative: posixSafe keeps git path
 * arguments inside the tree.
 */
export async function loadFile(
  ctx: Context,
  cwd: string,
  path: string,
  sha?: string,
): Promise<LoadedFile> {
  const trimmed = path.trim()
  if (trimmed.length === 0 || trimmed.includes('\0')) {
    throw badRequest('invalid file path')
  }
  if (sha !== undefined) {
    await assertGitRepo(ctx, cwd)
    const safePath = posixSafe(trimmed)
    if (safePath.length === 0) throw badRequest('invalid file path')
    const bytes = await readCommitBytes(ctx, cwd, safePath, sha)
    if (bytes === null) return { content: '', encoding: 'utf8', exists: false }
    return decodeFileBytes(bytes, safePath)
  }
  return readWorktreeFile(ctx, cwd, trimmed)
}

async function readWorktreeFile(ctx: Context, cwd: string, path: string): Promise<LoadedFile> {
  let target
  try {
    target = await ctx.fs.resolve(path, { cwd })
  } catch (error) {
    if (isFsMissing(error)) return { content: '', encoding: 'utf8', exists: false }
    throw error
  }
  const info = await ctx.fs.stat(target)
  if (info === undefined) return { content: '', encoding: 'utf8', exists: false }
  if (info.type === 'directory') {
    return { content: '', encoding: 'utf8', directory: true, exists: true }
  }
  let bytes
  try {
    bytes = await ctx.fs.readBytes(target, undefined, MAX_BUFFER)
  } catch (error) {
    if (isFsMissing(error)) return { content: '', encoding: 'utf8', exists: false }
    throw error
  }
  return decodeFileBytes(Buffer.from(bytes), target.displayPath)
}

function decodeFileBytes(bytes: Buffer, displayPath: string): LoadedFile {
  const mime = IMAGE_MIME[extensionOf(displayPath)]
  if (mime !== undefined) {
    return { content: bytes.toString('base64'), encoding: 'base64', mime, exists: true }
  }
  if (looksBinary(bytes)) {
    return { content: '', encoding: 'utf8', binary: true, exists: true }
  }
  return { content: bytes.toString('utf8'), encoding: 'utf8', exists: true }
}

/**
 * Raw bytes of a committed blob (git show sha:path); null when the path is
 * absent at that revision.
 */
async function readCommitBytes(
  ctx: Context,
  cwd: string,
  path: string,
  sha: string,
): Promise<Buffer | null> {
  const result = await runGitBuffer(
    ctx,
    cwd,
    ['show', sha + ':' + path],
    GIT_TIMEOUT_MS,
    MAX_BUFFER,
  )
  if (result.exitCode === 0) return result.stdout
  if (/does not exist|invalid object name|exists on disk, but not in/i.test(result.stderr)) {
    return null
  }
  throw new Error(result.stderr.trim() || `git show exited with code ${result.exitCode}`)
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
 * One file's diff. With sha, the change that commit introduced to path
 * (sha^..sha; a root commit diffs against the empty tree). Without a sha, the
 * working tree against HEAD. Returns null when the path has no change at that
 * point (no worktree change, or the commit did not touch it).
 */
export async function loadFileDiff(
  ctx: Context,
  cwd: string,
  path: string,
  sha?: string,
): Promise<GitFileDiff | null> {
  await assertGitRepo(ctx, cwd)
  const safePath = posixSafe(path)
  if (safePath.length === 0) {
    throw badRequest('invalid file path')
  }

  if (sha !== undefined) {
    // git show sha diffs the commit against its parent (root commits against
    // the empty tree) and prints nothing for untouched paths. --first-parent
    // picks the landing-side parent for merges; without it show falls back to
    // a combined diff that is empty for clean merges.
    const patch = await runDiff(ctx, cwd, [
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
    ctx,
    cwd,
    ['diff', '--no-color', '--no-ext-diff', '--unified=3', 'HEAD', '--', safePath],
  )
  if (worktree !== null) return { path: safePath, patch: worktree }

  const cached = await runDiff(
    ctx,
    cwd,
    ['diff', '--cached', '--no-color', '--no-ext-diff', '--unified=3', '--', safePath],
  )
  if (cached !== null) return { path: safePath, patch: cached }

  // No staged/unstaged change. An untracked file still reads as a new file.
  const tracked = await gitText(
    ctx,
    cwd,
    ['ls-files', '--', safePath],
    GIT_TIMEOUT_MS,
  ).catch(() => '')
  if (tracked.trim().length === 0) {
    const loaded = await loadFile(ctx, cwd, safePath)
    if (loaded.exists) {
      return { path: safePath, patch: synthesizeNewFilePatch(safePath, loaded.content) }
    }
  }
  return null
}

/**
 * Run a diff command restricted to one path and return the raw unified patch.
 * Returns null when the diff is empty (no change at that path).
 */
async function runDiff(ctx: Context, cwd: string, args: string[]): Promise<string | null> {
  const { stdout } = await execGit(ctx, cwd, args, GIT_TIMEOUT_MS, MAX_BUFFER)
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

/** git diff-tree --name-status -z output -> change files. */
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

/** git status --porcelain -z output -> change files.
 *
 * With -z each entry is NUL-separated. A normal entry is one field XY path; a
 * rename/copy is TWO fields R newPath then oldPath (the target comes first).
 * Untracked directories are only shown collapsed (?? dir/) unless -uall was
 * passed; callers pass -uall so untracked files appear individually.
 *
 * X is the index (staged) side, Y the worktree side; a path changed in both
 * (MM) yields one entry per side, flagged via staged, so the client can group
 * them the way VSCode does.
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
      // Two fields: newPath then oldPath. The rename itself is staged; y may
      // still flag further unstaged edits to the new path.
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

/** git diff --numstat output -> path -> {added, removed}. */
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
    // Rename/copy paths print as old => new; keep the destination so the
    // count lines up with the name-status newPath.
    const arrow = path.indexOf(' => ')
    if (arrow !== -1) path = path.slice(arrow + 4)
    if (path.length === 0 || Number.isNaN(added) || Number.isNaN(removed)) continue
    counts.set(path, { added, removed })
  }
  return counts
}

/** Strip a leading ./ and normalize separators for git path arguments. */
function posixSafe(path: string): string {
  const trimmed = path.trim().replace(/\\/g, '/')
  const normalized = trimmed.startsWith('./') ? trimmed.slice(2) : trimmed
  const cleaned = normalized.replace(/^\/+/, '')
  if (cleaned.includes('\0') || cleaned.includes('..') || cleaned.includes('//')) {
    throw badRequest('invalid path')
  }
  return cleaned
}

async function assertGitRepo(ctx: Context, cwd: string): Promise<void> {
  if (await isGitRepo(ctx, cwd)) return
  const error = new Error('not a git repository')
  error.name = 'NotGit'
  throw error
}

/** Detect a repository without making the Files explorer Git-dependent. */
async function isGitRepo(ctx: Context, cwd: string): Promise<boolean> {
  try {
    const inside = await gitText(ctx, cwd, ['rev-parse', '--is-inside-work-tree'], GIT_TIMEOUT_MS)
    return inside === 'true'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/not a git repository/i.test(message)) throw error
    return false
  }
}

async function gitText(
  ctx: Context,
  cwd: string,
  args: string[],
  timeout: number,
): Promise<string> {
  const { stdout } = await execGit(ctx, cwd, args, timeout, MAX_BUFFER)
  return stdout.replace(/\n+$/, '')
}

function isFsMissing(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return code === 'FS_NOT_FOUND' || code === 'FS_NOT_DIRECTORY'
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
