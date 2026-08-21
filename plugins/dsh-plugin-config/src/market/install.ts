import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { catalogEntry, classifyInstallSpec } from './catalog.ts'
import type { InstallOutcome, ProfilePatch } from './types.ts'
import { loadMarketplaceCatalog } from './host-catalog.ts'

const INSTALL_MS = 180_000

export function resolveDshBin(): string {
  if (process.env.DSH_BIN) return process.env.DSH_BIN
  const argv1 = process.argv[1] ?? ''
  if (argv1.endsWith(`${join('dsh', 'lib', 'bin.js')}`)) {
    const shim = join(argv1, '..', '..', '..', '.bin', 'dsh')
    if (existsSync(shim)) return shim
  }
  if (argv1.endsWith(`${join('.bin', 'dsh')}`) && existsSync(argv1)) return argv1
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const candidate = join(home, 'runtime', 'node_modules', '.bin', 'dsh')
  if (existsSync(candidate)) return candidate
  return 'dsh'
}

export async function installCatalogSpec(spec: string): Promise<InstallOutcome> {
  const trimmed = spec.trim()
  if (trimmed === '') {
    return { ok: false, error: 'Missing install spec.' }
  }

  let catalog
  try {
    catalog = await loadMarketplaceCatalog(true)
  } catch (error) {
    return {
      ok: false,
      error: 'Could not refresh the catalog to verify this plugin.',
      detail: String(error),
    }
  }
  const entry = catalogEntry(catalog, trimmed)
  if (entry === undefined) {
    return { ok: false, error: 'That plugin is not in the current marketplace catalog.' }
  }

  const kind = classifyInstallSpec(trimmed)
  if (kind === null) {
    return {
      ok: false,
      error: 'Unsupported install spec. Use npm package, github:, local path, or https tarball URL.',
    }
  }
  if (kind === 'local' && !existsSync(join(trimmed, 'package.json'))) {
    return { ok: false, spec: trimmed, error: 'Local plugin folder is missing package.json.' }
  }

  const bin = resolveDshBin()
  try {
    const { code, stdout, stderr } = await run(
      bin,
      ['plugin', '--profile', 'web', 'add', trimmed],
      INSTALL_MS,
    )
    const detail = [stdout, stderr].filter(Boolean).join('\n').trim()
    if (code !== 0) {
      return {
        ok: false,
        spec: trimmed,
        error: `dsh plugin add exited ${code}.`,
        detail: detail.slice(0, 4000),
      }
    }
    if (entry.profilePatches && entry.profilePatches.length > 0) {
      applyProfilePatches(entry.profilePatches)
    }
    return { ok: true, spec: trimmed, needsRestart: true, detail: detail.slice(0, 4000) }
  } catch (error) {
    return { ok: false, spec: trimmed, error: 'Failed to run dsh plugin add.', detail: String(error) }
  }
}

function applyProfilePatches(patches: ProfilePatch[]): void {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const file = join(home, 'profiles', 'web', 'cordis.patch.yml')
  let text = existsSync(file) ? readFileSync(file, 'utf8') : ''
  for (const patch of patches) {
    if (patch.disabled !== true) continue
    const idLine = `- id: ${patch.id}`
    if (text.includes(idLine)) continue
    const block = `${idLine}\n  disabled: true\n`
    if (text.trim() === '' || text.trim() === '[]') text = block
    else text = text.replace(/\s*$/, '\n') + block
  }
  writeFileSync(file, text)
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
