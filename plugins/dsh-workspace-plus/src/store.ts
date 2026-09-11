import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  folderName,
  normalizePrimaryPath,
  samePath,
  type RepoFolder,
  type WorkspaceBinding,
} from './shared.ts'
import { adoptFolder, InvalidFolderError, markExternal, tryRealpath } from './scan.ts'

interface StoreFile {
  version: 1
  bindings: WorkspaceBinding[]
}

/**
 * Pre-rename store. The plugin was `dsh-multi-repo` before it became the
 * workspace enhancement plugin; first load copies its bindings forward and
 * leaves the old file untouched so a downgrade still works.
 */
const LEGACY_DIR_NAME = 'multi-repo'

function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function rootDir(): string {
  return join(dshHome(), 'workspace-plus')
}

function storePath(): string {
  return join(rootDir(), 'bindings.json')
}

function legacyStorePath(): string {
  return join(dshHome(), LEGACY_DIR_NAME, 'projects.json')
}

function empty(): StoreFile {
  return { version: 1, bindings: [] }
}

function ensureDir(): void {
  mkdirSync(rootDir(), { recursive: true })
}

function atomicWrite(file: string, body: string): void {
  ensureDir()
  const tmp = `${file}.tmp`
  writeFileSync(tmp, body, 'utf8')
  renameSync(tmp, file)
}

function normalizeRepo(raw: unknown): RepoFolder | null {
  if (raw === null || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (typeof value.name !== 'string' || typeof value.path !== 'string') return null
  const name = value.name.trim()
  const path = value.path.trim()
  if (name === '' || path === '') return null
  return {
    name,
    path,
    kind: 'folder',
    external: value.external === true ? true : undefined,
  }
}

function normalizeBinding(raw: unknown): WorkspaceBinding | null {
  if (raw === null || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (typeof value.root !== 'string' || value.root.trim() === '') return null
  if (!Array.isArray(value.repos)) return null
  const repos: RepoFolder[] = []
  for (const item of value.repos) {
    const repo = normalizeRepo(item)
    if (repo !== null) repos.push(repo)
  }
  if (repos.length === 0) return null
  const root = value.root.trim()
  const primaryPath = normalizePrimaryPath(repos, typeof value.primaryPath === 'string' ? value.primaryPath : root)
  return {
    root,
    title: typeof value.title === 'string' && value.title.trim() !== '' ? value.title.trim() : root,
    primaryPath,
    repos: markExternal(repos, primaryPath),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
  }
}

/**
 * Accept both the current `{ bindings }` shape and the legacy `{ projects }`
 * key the pre-rename store wrote, so a hand-edited or half-migrated file
 * still loads.
 */
function parseStore(raw: unknown): StoreFile {
  if (raw === null || typeof raw !== 'object') return empty()
  const value = raw as { version?: unknown; bindings?: unknown; projects?: unknown }
  const list = Array.isArray(value.bindings) ? value.bindings
    : Array.isArray(value.projects) ? value.projects
    : []
  const bindings: WorkspaceBinding[] = []
  for (const item of list) {
    const binding = normalizeBinding(item)
    if (binding !== null) bindings.push(binding)
  }
  return { version: 1, bindings }
}

function readFile(file: string): StoreFile {
  try {
    return parseStore(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return empty()
  }
}

/** Copy the pre-rename store forward the first time the new one is missing. */
function migrateLegacy(): void {
  if (existsSync(storePath())) return
  const legacy = legacyStorePath()
  if (!existsSync(legacy)) return
  const imported = readFile(legacy)
  if (imported.bindings.length === 0) return
  try {
    atomicWrite(storePath(), `${JSON.stringify(imported, null, 2)}\n`)
  } catch {
    // Read-only home: the plugin stays usable, it just starts empty.
  }
}

function load(): StoreFile {
  migrateLegacy()
  return readFile(storePath())
}

function save(file: StoreFile): void {
  atomicWrite(storePath(), `${JSON.stringify(file, null, 2)}\n`)
}

export function listBindings(): WorkspaceBinding[] {
  return load().bindings.slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getBinding(root: string): WorkspaceBinding | null {
  const key = tryRealpath(root)
  const alt = root
  for (const binding of load().bindings) {
    if (binding.root === key || binding.root === alt) return binding
    if (tryRealpath(binding.root) === key) return binding
    if (samePath(binding.primaryPath, key) || samePath(binding.primaryPath, alt)) return binding
  }
  return null
}

export function findBindingForCwd(cwd: string): WorkspaceBinding | null {
  const key = tryRealpath(cwd)
  const exact = getBinding(key)
  if (exact !== null) return exact
  for (const binding of load().bindings) {
    if (tryRealpath(binding.root) === key) return binding
    if (tryRealpath(binding.primaryPath) === key) return binding
    if (binding.repos.some((repo) => tryRealpath(repo.path) === key)) return binding
  }
  return null
}

export function bindBinding(input: {
  root: string
  repos: RepoFolder[]
  title?: string
  primaryPath?: string
  previousRoot?: string
}): WorkspaceBinding {
  const repos = input.repos
    .filter((repo) => typeof repo.path === 'string' && repo.path.trim() !== '')
    .map((repo) => {
      const adopted = adoptFolder(repo.path)
      return {
        name: repo.name.trim() || adopted.name,
        path: adopted.path,
        kind: 'folder' as const,
      } satisfies RepoFolder
    })
  if (repos.length === 0) throw new Error('at least one folder is required')
  const requestedPrimary = tryRealpath(input.primaryPath ?? input.root)
  if (!repos.some((repo) => samePath(repo.path, requestedPrimary))) {
    throw new InvalidFolderError('primary folder must be listed')
  }
  const primaryPath = normalizePrimaryPath(repos, requestedPrimary)
  const root = tryRealpath(primaryPath)
  const binding: WorkspaceBinding = {
    root,
    title: input.title?.trim() || basenameTitle(root, repos.length),
    primaryPath: root,
    repos: markExternal(repos, root),
    updatedAt: Date.now(),
  }
  const file = load()
  const previousRoot = input.previousRoot === undefined ? undefined : tryRealpath(input.previousRoot)
  file.bindings = file.bindings.filter((item) => {
    const existing = tryRealpath(item.root)
    const existingPrimary = tryRealpath(item.primaryPath)
    return existing !== root
      && existingPrimary !== root
      && (previousRoot === undefined || (existing !== previousRoot && existingPrimary !== previousRoot))
  })
  file.bindings.unshift(binding)
  save(file)
  return binding
}

export function deleteBinding(root: string): boolean {
  const key = tryRealpath(root)
  const file = load()
  const next = file.bindings.filter((item) => {
    return tryRealpath(item.root) !== key
      && item.root !== root
      && tryRealpath(item.primaryPath) !== key
  })
  if (next.length === file.bindings.length) return false
  file.bindings = next
  save(file)
  return true
}

export function storeRoot(): string {
  return rootDir()
}

export function storeExists(): boolean {
  return existsSync(storePath())
}

function basenameTitle(root: string, count: number): string {
  const name = folderName(root)
  return count > 1 ? `${name} · ${count}` : name
}
