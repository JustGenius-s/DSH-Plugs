import { spawn } from 'node:child_process'
import { isNpmRegistrySpec } from './npm-deps.ts'
import { readProfilePackage } from './profile.ts'
import { resolveDshBin } from './actions.ts'
import { moduleShortName } from './classify.ts'
import type { OutdatedSnapshot, PluginUpdate, UpdateOutcome } from './types.ts'

const OUTDATED_MS = 120_000
const UPDATE_MS = 180_000

/**
 * List npm-registry profile deps that pnpm reports as outdated.
 * GitHub / link / tarball installs are excluded — only registry specs update.
 */
export async function collectOutdated(): Promise<OutdatedSnapshot> {
  const deps = readProfilePackage().dependencies ?? {}
  const npmNames = Object.entries(deps)
    .filter(([, spec]) => isNpmRegistrySpec(spec))
    .map(([name]) => name)

  if (npmNames.length === 0) {
    return { updates: [], checkedAt: new Date().toISOString() }
  }

  const bin = resolveDshBin()
  // Limit the check to registry deps — link/github/tarball never appear as updatable.
  const { code, stdout, stderr } = await run(
    bin,
    ['plugin', '--profile', 'web', 'outdated', ...npmNames, '--format', 'json'],
    OUTDATED_MS,
  )
  // pnpm outdated exits 1 when anything is outdated; still parse stdout.
  const raw = stdout.trim() || ''
  let parsed: unknown
  try {
    parsed = raw === '' ? {} : JSON.parse(raw)
  } catch {
    if (code !== 0 && code !== 1) {
      throw new Error(stderr.trim() || `dsh plugin outdated exited ${code}`)
    }
    throw new Error('Could not parse pnpm outdated JSON.')
  }

  const updates: PluginUpdate[] = []
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const npmSet = new Set(npmNames.map((name) => name.toLowerCase()))
    for (const [packageName, info] of Object.entries(parsed as Record<string, unknown>)) {
      if (!npmSet.has(packageName.toLowerCase())) continue
      if (info === null || typeof info !== 'object') continue
      const row = info as Record<string, unknown>
      const current = typeof row.current === 'string' ? row.current : ''
      const latest = typeof row.latest === 'string' ? row.latest : ''
      const wanted = typeof row.wanted === 'string' ? row.wanted : latest
      if (current === '' || latest === '' || current === latest) continue
      updates.push({
        packageName,
        shortName: moduleShortName(packageName),
        current,
        wanted,
        latest,
      })
    }
  }

  updates.sort((left, right) => left.shortName.localeCompare(right.shortName))
  return { updates, checkedAt: new Date().toISOString() }
}

/** Bump one npm-registry profile dep to latest via `dsh plugin update --latest`. */
export async function updateNpmPackage(packageName: string): Promise<UpdateOutcome> {
  const trimmed = packageName.trim()
  if (trimmed === '') return { ok: false, error: 'Missing package name.' }

  const deps = readProfilePackage().dependencies ?? {}
  const entry = Object.entries(deps).find(([name]) => name.toLowerCase() === trimmed.toLowerCase())
  if (!entry) {
    return { ok: false, packageName: trimmed, error: 'Package is not in the web profile.' }
  }
  const [resolvedName, spec] = entry
  if (!isNpmRegistrySpec(spec)) {
    return {
      ok: false,
      packageName: resolvedName,
      error: 'Only npm registry installs can be updated from this panel.',
    }
  }

  const bin = resolveDshBin()
  try {
    const { code, stdout, stderr } = await run(
      bin,
      ['plugin', '--profile', 'web', 'update', resolvedName, '--latest'],
      UPDATE_MS,
    )
    const detail = [stdout, stderr].filter(Boolean).join('\n').trim().slice(0, 4000)
    if (code !== 0) {
      return {
        ok: false,
        packageName: resolvedName,
        error: `dsh plugin update exited ${code}.`,
        detail,
      }
    }
    return {
      ok: true,
      packageName: resolvedName,
      needsRestart: true,
      detail,
    }
  } catch (error) {
    return {
      ok: false,
      packageName: resolvedName,
      error: 'Failed to run dsh plugin update.',
      detail: String(error),
    }
  }
}

function run(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
  })
}
