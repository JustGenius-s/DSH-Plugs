import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  DEFAULT_GRAPH_LIMIT,
  GIT_GRAPH_ALL_SCOPE,
  MAX_GRAPH_LIMIT,
  MAX_GRAPH_SCOPE_REFS,
  type GitGraphRef,
  type GitGraphRow,
  type GitGraphScopeRef,
} from '../../shared/git-graph'

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 8_000
const SHOW_TIMEOUT_MS = 5_000
const MAX_BUFFER = 8 * 1024 * 1024
const FIELD = '\x1f'
const WORKDIR_SHA = 'WORKDIR'
const TYPE_ORDER: Record<GitGraphScopeRef['type'], number> = {
  head: 0,
  branch: 1,
  remote: 2,
  tag: 3,
}

export interface GraphScope {
  all: boolean
  gitArgs: string[]
  selected: string[]
}

export interface GraphLog {
  head?: string
  branch?: string
  refs: GitGraphScopeRef[]
  selected: string[]
  rows: GitGraphRow[]
  hasMore: boolean
}

export async function loadGraphLog(
  cwd: string,
  skip: number,
  limit: number,
  requested?: readonly string[],
): Promise<GraphLog> {
  await assertGitRepo(cwd)
  const [head, branch] = await Promise.all([
    gitText(cwd, ['rev-parse', 'HEAD'], GIT_TIMEOUT_MS).catch(() => ''),
    gitText(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], GIT_TIMEOUT_MS)
      .catch(() => ''),
  ])
  const refs = await listScopeRefs(cwd, branch)
  const scope = resolveScope(requested, refs, branch)
  const rows = await readLog(cwd, skip, limit + 1, scope)
  const hasMore = rows.length > limit
  if (hasMore) rows.pop()
  if (skip === 0 && scopeIncludesWorkdir(scope, refs)) {
    const wip = await readWorkdirRow(cwd, head)
    if (wip !== undefined) rows.unshift(wip)
  }
  return {
    head: head === '' ? undefined : head,
    branch: branch === '' ? undefined : branch,
    refs,
    selected: scope.selected,
    rows,
    hasMore,
  }
}

export async function loadCommitBody(cwd: string, sha: string): Promise<string> {
  await assertGitRepo(cwd)
  return gitText(
    cwd,
    ['show', '--stat', '--format=%B', '--no-color', sha, '--'],
    SHOW_TIMEOUT_MS,
  )
}

async function assertGitRepo(cwd: string): Promise<void> {
  try {
    const inside = await gitText(
      cwd,
      ['rev-parse', '--is-inside-work-tree'],
      GIT_TIMEOUT_MS,
    )
    if (inside === 'true') return
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/not a git repository/i.test(message)) throw error
  }
  const error = new Error('not a git repository')
  error.name = 'NotGit'
  throw error
}

async function listScopeRefs(
  cwd: string,
  currentBranch: string,
): Promise<GitGraphScopeRef[]> {
  const stdout = await gitText(cwd, [
    'for-each-ref',
    `--format=%(refname)${FIELD}%(refname:short)${FIELD}%(HEAD)`,
    'refs/heads',
    'refs/remotes',
    'refs/tags',
  ], GIT_TIMEOUT_MS).catch(() => '')
  const refs: GitGraphScopeRef[] = []
  const seen = new Set<string>()
  for (const line of stdout.split('\n')) {
    const parts = line.split(FIELD)
    const fullName = parts[0]?.trim() ?? ''
    const name = parts[1]?.trim() ?? ''
    const marker = parts[2]?.trim() ?? ''
    if (fullName.length === 0 || name.length === 0) continue
    if (fullName.endsWith('/HEAD')) continue
    if (seen.has(fullName)) continue
    seen.add(fullName)
    const type: GitGraphScopeRef['type'] = fullName.startsWith('refs/heads/')
      ? 'branch'
      : fullName.startsWith('refs/remotes/')
        ? 'remote'
        : 'tag'
    refs.push({
      name,
      fullName,
      type,
      current: marker === '*' || (type === 'branch' && name === currentBranch),
    })
  }
  if (currentBranch === 'HEAD' || currentBranch === '') {
    refs.push({
      name: 'HEAD',
      fullName: 'HEAD',
      type: 'head',
      current: true,
    })
  }
  refs.sort(compareScopeRefs)
  return refs
}

export function resolveScope(
  requested: readonly string[] | undefined,
  refs: readonly GitGraphScopeRef[],
  currentBranch: string,
): GraphScope {
  const allowed = new Set(refs.map((ref) => ref.fullName))
  allowed.add('HEAD')
  if (requested?.includes(GIT_GRAPH_ALL_SCOPE) === true) {
    return { all: true, gitArgs: [], selected: [GIT_GRAPH_ALL_SCOPE] }
  }
  const picked: string[] = []
  for (const raw of requested ?? []) {
    if (!allowed.has(raw) || !isSafeRefArg(raw)) continue
    if (picked.includes(raw)) continue
    picked.push(raw)
    if (picked.length >= MAX_GRAPH_SCOPE_REFS) break
  }
  if (picked.length === 0) {
    const current = refs.find((ref) => ref.current === true)
    const fallback = current?.fullName
      ?? (currentBranch === 'HEAD' || currentBranch === ''
        ? 'HEAD'
        : `refs/heads/${currentBranch}`)
    const selected = isSafeRefArg(fallback) ? [fallback] : ['HEAD']
    return { all: false, gitArgs: selected, selected }
  }
  return { all: false, gitArgs: picked, selected: picked }
}

function scopeIncludesWorkdir(
  scope: GraphScope,
  refs: readonly GitGraphScopeRef[],
): boolean {
  if (scope.all) return true
  const current = refs.find((ref) => ref.current === true)
  if (current !== undefined && scope.selected.includes(current.fullName)) {
    return true
  }
  return scope.selected.includes('HEAD')
}

function compareScopeRefs(a: GitGraphScopeRef, b: GitGraphScopeRef): number {
  if (a.current === true && b.current !== true) return -1
  if (b.current === true && a.current !== true) return 1
  const delta = TYPE_ORDER[a.type] - TYPE_ORDER[b.type]
  if (delta !== 0) return delta
  return a.name.localeCompare(b.name)
}

function isSafeRefArg(value: string): boolean {
  if (value.length === 0 || value.length > 256) return false
  if (value.includes('\0') || value.includes('..') || value.includes('//')) {
    return false
  }
  if (value.startsWith('-') || value.includes(' ')) return false
  return value === 'HEAD' || value.startsWith('refs/')
}

async function readLog(
  cwd: string,
  skip: number,
  limit: number,
  scope: GraphScope,
): Promise<GitGraphRow[]> {
  const args = [
    'log',
    ...(scope.all ? ['--all'] : []),
    '--topo-order',
    '--decorate=full',
    `--skip=${skip}`,
    `--max-count=${limit}`,
    `--pretty=format:%H${FIELD}%P${FIELD}%an${FIELD}%at${FIELD}%d${FIELD}%s`,
    ...(scope.all ? [] : scope.gitArgs),
    '--',
  ]
  const stdout = await gitText(cwd, args, GIT_TIMEOUT_MS)
  if (stdout.length === 0) return []
  const rows: GitGraphRow[] = []
  for (const line of stdout.split('\n')) {
    const row = parseLogLine(line)
    if (row !== undefined) rows.push(row)
  }
  return rows
}

async function readWorkdirRow(
  cwd: string,
  head: string,
): Promise<GitGraphRow | undefined> {
  const porcelain = await gitText(
    cwd,
    ['status', '--porcelain'],
    GIT_TIMEOUT_MS,
  ).catch(() => '')
  if (porcelain.length === 0) return undefined
  const parents = head === '' ? [] : [head]
  return {
    sha: WORKDIR_SHA,
    shortSha: 'wip',
    parents,
    author: '',
    timestamp: Math.floor(Date.now() / 1000),
    subject: 'Uncommitted changes',
    refs: [],
    kind: 'workdir',
    detail: porcelain,
  }
}

function parseLogLine(line: string): GitGraphRow | undefined {
  const parts = line.split(FIELD)
  if (parts.length < 6) return undefined
  const sha = parts[0]?.trim() ?? ''
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return undefined
  const parents = (parts[1] ?? '')
    .trim()
    .split(' ')
    .filter((parent) => parent.length > 0)
  const author = parts[2] ?? ''
  const timestamp = Number.parseInt(parts[3] ?? '', 10)
  const refs = parseDecorations(parts[4] ?? '')
  const subject = parts.slice(5).join(FIELD)
  return {
    sha,
    shortSha: sha.slice(0, 7),
    parents,
    author,
    timestamp: Number.isFinite(timestamp) ? timestamp : 0,
    subject,
    refs,
    kind: parents.length > 1 ? 'merge' : 'commit',
  }
}

function parseDecorations(raw: string): GitGraphRef[] {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return []
  const body = trimmed.replace(/^\(/, '').replace(/\)$/, '')
  const refs: GitGraphRef[] = []
  for (const part of body.split(',')) {
    const token = part.trim()
    if (token.length === 0) continue
    if (token.startsWith('HEAD -> ')) {
      const full = token.slice('HEAD -> '.length)
      refs.push({ name: 'HEAD', type: 'head', current: true })
      refs.push({
        name: shortenRef(full),
        type: full.startsWith('refs/remotes/') ? 'remote' : 'branch',
        current: true,
      })
      continue
    }
    if (token === 'HEAD') {
      refs.push({ name: 'HEAD', type: 'head', current: true })
      continue
    }
    if (token.startsWith('tag: ')) {
      refs.push({ name: shortenRef(token.slice(5)), type: 'tag' })
      continue
    }
    if (token.startsWith('refs/tags/')) {
      refs.push({ name: shortenRef(token), type: 'tag' })
      continue
    }
    if (token.startsWith('refs/remotes/')) {
      refs.push({ name: shortenRef(token), type: 'remote' })
      continue
    }
    if (token.startsWith('refs/heads/')) {
      refs.push({ name: shortenRef(token), type: 'branch' })
    }
  }
  return refs
}

function shortenRef(ref: string): string {
  if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length)
  if (ref.startsWith('refs/remotes/')) return ref.slice('refs/remotes/'.length)
  if (ref.startsWith('refs/tags/')) return ref.slice('refs/tags/'.length)
  return ref
}

async function gitText(
  cwd: string,
  args: string[],
  timeout: number,
): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout,
    maxBuffer: MAX_BUFFER,
    encoding: 'utf8',
  })
  return stdout.replace(/\n+$/, '')
}

export function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GRAPH_LIMIT
  return Math.min(MAX_GRAPH_LIMIT, Math.max(1, Math.floor(value)))
}

export function clampSkip(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}
