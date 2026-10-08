import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, symlinkSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const SCOPE_PACKAGE = '@deepseek-ai/dsh-scope'

function manifest(path: string): { name: string; version: string } {
  const value = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
  if (value?.name !== SCOPE_PACKAGE || typeof value.version !== 'string' || value.version.trim() === '') {
    throw new Error(`Invalid ${SCOPE_PACKAGE} manifest at ${path}`)
  }
  return value
}

function hasLocalScope(profileDir: string): boolean {
  try {
    lstatSync(join(profileDir, 'node_modules', SCOPE_PACKAGE))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * dsh-scope owns Symbols and WeakMaps, so equal versions are not interchangeable
 * module instances. A hoisted profile install can shadow the Host's copy and
 * silently turn per-Agent tool registrations into global registrations.
 * Repair only an exact-version duplicate; preserve the original for rollback.
 */
export function repairProfileScopeIdentity(profileDir: string, hostToolsEntry: string): string | undefined {
  if (!hasLocalScope(profileDir)) return undefined
  const hostRequire = createRequire(realpathSync(hostToolsEntry))
  const target = realpathSync(dirname(hostRequire.resolve(`${SCOPE_PACKAGE}/package.json`)))
  const local = join(profileDir, 'node_modules', SCOPE_PACKAGE)
  if (realpathSync(local) === target) return undefined
  const installed = manifest(local)
  const host = manifest(target)
  if (installed.version !== host.version) {
    throw new Error(`Cannot share ${SCOPE_PACKAGE}: profile ${installed.version}, host ${host.version}; align versions before restarting DSH`)
  }
  // Move the directory/link itself, never mutate pnpm's content-addressed store.
  const backups = join(profileDir, '.dsh-singleton-backups')
  mkdirSync(backups, { recursive: true })
  const id = randomUUID()
  const backup = join(backups, `dsh-scope-${id}`)
  const staged = join(dirname(local), `.dsh-scope-${id}`)
  // Check link creation before moving the original out of the resolution path.
  symlinkSync(target, staged, process.platform === 'win32' ? 'junction' : 'dir')
  try {
    renameSync(local, backup)
    try {
      renameSync(staged, local)
    } catch (error) {
      renameSync(backup, local)
      throw error
    }
  } finally {
    try {
      unlinkSync(staged)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return backup
}

/** Resolve from the installation's tools owner, not this plugin's dependencies. */
export function repairWebProfileScopeIdentity(dshHome: string): string | undefined {
  const profile = join(dshHome, 'profiles', 'web')
  if (!hasLocalScope(profile)) return undefined
  const host = createRequire(realpathSync(join(dshHome, 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')))
  return repairProfileScopeIdentity(profile, host.resolve('@deepseek-ai/dsh-tools'))
}
