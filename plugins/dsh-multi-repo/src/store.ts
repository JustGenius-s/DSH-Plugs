import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  folderName,
  normalizePrimaryPath,
  samePath,
  type MultiRepoProject,
  type RepoFolder,
} from './shared'
import { markExternal, tryRealpath } from './scan'

interface StoreFile {
  version: 1
  projects: MultiRepoProject[]
}

function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function rootDir(): string {
  return join(dshHome(), 'multi-repo')
}

function storePath(): string {
  return join(rootDir(), 'projects.json')
}

function empty(): StoreFile {
  return { version: 1, projects: [] }
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

function normalizeProject(raw: unknown): MultiRepoProject | null {
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

function load(): StoreFile {
  try {
    const raw = JSON.parse(readFileSync(storePath(), 'utf8')) as { version?: unknown; projects?: unknown }
    if (!Array.isArray(raw.projects)) return empty()
    const projects: MultiRepoProject[] = []
    for (const item of raw.projects) {
      const project = normalizeProject(item)
      if (project !== null) projects.push(project)
    }
    return { version: 1, projects }
  } catch {
    return empty()
  }
}

function save(file: StoreFile): void {
  atomicWrite(storePath(), `${JSON.stringify(file, null, 2)}\n`)
}

export function listProjects(): MultiRepoProject[] {
  return load().projects.slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getProject(root: string): MultiRepoProject | null {
  const key = tryRealpath(root)
  const alt = root
  for (const project of load().projects) {
    if (project.root === key || project.root === alt) return project
    if (tryRealpath(project.root) === key) return project
    if (samePath(project.primaryPath, key) || samePath(project.primaryPath, alt)) return project
  }
  return null
}

export function findProjectForCwd(cwd: string): MultiRepoProject | null {
  const key = tryRealpath(cwd)
  const exact = getProject(key)
  if (exact !== null) return exact
  for (const project of load().projects) {
    if (tryRealpath(project.root) === key) return project
    if (tryRealpath(project.primaryPath) === key) return project
    if (project.repos.some((repo) => tryRealpath(repo.path) === key)) return project
  }
  return null
}

export function bindProject(input: {
  root: string
  repos: RepoFolder[]
  title?: string
  primaryPath?: string
}): MultiRepoProject {
  const repos = input.repos
    .filter((repo) => typeof repo.path === 'string' && repo.path.trim() !== '')
    .map((repo) => {
      const path = tryRealpath(repo.path)
      return {
        name: repo.name.trim() || folderName(path),
        path,
        kind: 'folder' as const,
      } satisfies RepoFolder
    })
  if (repos.length === 0) throw new Error('at least one folder is required')
  const primaryPath = normalizePrimaryPath(repos, input.primaryPath ?? input.root)
  const root = tryRealpath(primaryPath)
  const project: MultiRepoProject = {
    root,
    title: input.title?.trim() || basenameTitle(root, repos.length),
    primaryPath: root,
    repos: markExternal(repos, root),
    updatedAt: Date.now(),
  }
  const file = load()
  file.projects = file.projects.filter((item) => {
    const existing = tryRealpath(item.root)
    return existing !== root && tryRealpath(item.primaryPath) !== root
  })
  file.projects.unshift(project)
  save(file)
  return project
}

export function deleteProject(root: string): boolean {
  const key = tryRealpath(root)
  const file = load()
  const next = file.projects.filter((item) => {
    return tryRealpath(item.root) !== key
      && item.root !== root
      && tryRealpath(item.primaryPath) !== key
  })
  if (next.length === file.projects.length) return false
  file.projects = next
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
