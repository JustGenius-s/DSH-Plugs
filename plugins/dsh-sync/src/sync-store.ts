import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface SyncState {
  version: 1
  clientId: string
  accessToken: string | null
  login: string | null
  avatarUrl: string | null
  gistId: string | null
  lastSyncedAt: string | null
  lastSyncedHash: string | null
}

function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function syncRoot(): string {
  return join(dshHome(), 'sync')
}

function statePath(): string {
  return join(syncRoot(), 'state.json')
}

function ensureDir(): void {
  mkdirSync(syncRoot(), { recursive: true })
}

function atomicWrite(file: string, body: string): void {
  ensureDir()
  const tmp = `${file}.tmp`
  writeFileSync(tmp, body, 'utf8')
  renameSync(tmp, file)
}

function emptyState(): SyncState {
  return {
    version: 1,
    clientId: '',
    accessToken: null,
    login: null,
    avatarUrl: null,
    gistId: null,
    lastSyncedAt: null,
    lastSyncedHash: null,
  }
}

export function loadState(): SyncState {
  try {
    const raw = JSON.parse(readFileSync(statePath(), 'utf8')) as Record<string, unknown>
    const login = typeof raw.login === 'string' && raw.login !== '' ? raw.login : null
    const storedAvatar = typeof raw.avatarUrl === 'string' && raw.avatarUrl !== '' ? raw.avatarUrl : null
    return {
      version: 1,
      clientId: typeof raw.clientId === 'string' ? raw.clientId.trim() : '',
      accessToken: typeof raw.accessToken === 'string' && raw.accessToken !== '' ? raw.accessToken : null,
      login,
      avatarUrl: storedAvatar ?? (login !== null ? `https://github.com/${login}.png` : null),
      gistId: typeof raw.gistId === 'string' && raw.gistId !== '' ? raw.gistId : null,
      lastSyncedAt: typeof raw.lastSyncedAt === 'string' ? raw.lastSyncedAt : null,
      lastSyncedHash: typeof raw.lastSyncedHash === 'string' ? raw.lastSyncedHash : null,
    }
  } catch {
    return emptyState()
  }
}

export function saveState(state: SyncState): void {
  atomicWrite(statePath(), `${JSON.stringify(state, null, 2)}\n`)
}

export function patchState(patch: Partial<SyncState>): SyncState {
  const prev = loadState()
  const next: SyncState = { ...prev, version: 1 }
  for (const [key, value] of Object.entries(patch) as Array<[keyof SyncState, SyncState[keyof SyncState]]>) {
    if (value !== undefined) next[key] = value as never
  }
  saveState(next)
  return next
}

export function clearAuth(): SyncState {
  return patchState({
    accessToken: null,
    login: null,
    avatarUrl: null,
  })
}

export function readTextIfExists(file: string): string | null {
  try {
    if (!existsSync(file)) return null
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

export function writeText(file: string, body: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, body, 'utf8')
  renameSync(tmp, file)
}

export function removeFile(file: string): void {
  try {
    unlinkSync(file)
  } catch {
    // ignore
  }
}
