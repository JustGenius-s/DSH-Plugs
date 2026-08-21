import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { dshHome, readTextIfExists, writeText } from './sync-store.ts'
import type { SyncPluginsSnapshot } from './shared.ts'

const DSH_PLUGS_REPO = 'JustGenius-s/DSH-Plugs'

/** Known monorepo package → folder (fallback when sibling scan is unavailable). */
const KNOWN_FOLDERS: Record<string, string> = {
  '@just-genius/dsh-codex': 'dsh-codex',
  '@just-genius/dsh-debug-mode': 'dsh-debug-mode',
  '@just-genius/dsh-desktop-update': 'dsh-desktop-update',
  '@just-genius/dsh-memory': 'dsh-memory',
  '@just-genius/dsh-model-custom-ex': 'dsh-model-custom-ex',
  '@just-genius/dsh-plugin-config': 'dsh-plugin-config',
  '@just-genius/dsh-sync': 'dsh-sync',
  '@just-genius/dsh-wechat-chat': 'dsh-wechat-chat',
  '@just-genius/dsh-whale-girl': 'dsh-whale-girl',
  '@just-genius/dsh-session-navigator': 'session-navigator',
}

export interface SkippedPlugin {
  name: string
  reason: string
}

export interface CollectPluginsResult {
  snapshot: SyncPluginsSnapshot
  skipped: SkippedPlugin[]
}

export interface ApplyPluginsResult {
  added: string[]
  removed: string[]
  failed: Array<{ name: string; error: string }>
  needsRestart: boolean
}

interface ProfilePackageJson {
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
  packageManager?: string
  [key: string]: unknown
}

export function profileDir(): string {
  return join(dshHome(), 'profiles', 'web')
}

export function profilePackagePath(): string {
  return join(profileDir(), 'package.json')
}

export function profilePatchPath(): string {
  return join(profileDir(), 'cordis.patch.yml')
}

export function collectPlugins(): CollectPluginsResult {
  const pkg = readProfilePackage()
  const deps = pkg.dependencies ?? {}
  const portable: Record<string, string> = {}
  const skipped: SkippedPlugin[] = []

  for (const [name, spec] of Object.entries(deps)) {
    const next = normalizeDepSpec(name, spec)
    if (next === null) {
      skipped.push({
        name,
        reason: `Cannot port "${spec}" — not a github:/registry/version or known DSH-Plugs package`,
      })
      continue
    }
    portable[name] = next
  }

  const patch = readTextIfExists(profilePatchPath()) ?? ''
  return {
    snapshot: {
      dependencies: portable,
      cordisPatchYml: patch,
    },
    skipped,
  }
}

export async function applyPlugins(snapshot: SyncPluginsSnapshot): Promise<ApplyPluginsResult> {
  const previousPatch = readTextIfExists(profilePatchPath()) ?? ''
  const nextPatch = snapshot.cordisPatchYml.endsWith('\n') || snapshot.cordisPatchYml === ''
    ? snapshot.cordisPatchYml
    : `${snapshot.cordisPatchYml}\n`
  const patchChanged = previousPatch !== nextPatch
  if (patchChanged) writeText(profilePatchPath(), nextPatch)

  const desired = snapshot.dependencies
  const current = readProfilePackage().dependencies ?? {}
  const desiredNames = new Set(Object.keys(desired))
  // Only remove deps that this machine could have pushed (portable). Local-only
  // link:/path packages that never enter the Gist must not be wiped on pull.
  const localPortable = new Set(Object.keys(collectPlugins().snapshot.dependencies))
  const toRemove = [...Object.keys(current)].filter(
    (name) => !desiredNames.has(name) && localPortable.has(name),
  )
  const toAddOrUpdate: Array<{ name: string; spec: string }> = []
  for (const [name, portableSpec] of Object.entries(desired)) {
    const existing = current[name]
    // Already mounted as the same portable package (any link:/file:/github: form).
    if (existing !== undefined && packageSatisfiesPortable(name, existing, portableSpec)) {
      continue
    }
    toAddOrUpdate.push({ name, spec: preferredInstallSpec(name, portableSpec) })
  }

  const added: string[] = []
  const removed: string[] = []
  const failed: Array<{ name: string; error: string }> = []

  for (const name of toRemove) {
    try {
      await runDshPlugin(['remove', name])
      removed.push(name)
    } catch (error) {
      failed.push({ name, error: errorMessage(error) })
    }
  }

  for (const { name, spec } of toAddOrUpdate) {
    try {
      await runDshPlugin(['add', spec])
      added.push(name)
    } catch (error) {
      failed.push({ name, error: errorMessage(error) })
    }
  }

  return {
    added,
    removed,
    failed,
    needsRestart: added.length > 0 || removed.length > 0 || patchChanged,
  }
}

/** mtimes of profile package.json + cordis.patch.yml (for conflict detection). */
export function profileContentMtimes(): number[] {
  const times: number[] = []
  for (const file of [profilePackagePath(), profilePatchPath()]) {
    try {
      if (existsSync(file)) times.push(statSync(file).mtimeMs)
    } catch {
      // ignore
    }
  }
  return times
}

function readProfilePackage(): ProfilePackageJson {
  const file = profilePackagePath()
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as ProfilePackageJson
  } catch {
    return {}
  }
}

/**
 * Turn a local link:/file: path into a portable github: or registry spec.
 * Returns null when the dependency cannot be synced to another machine.
 */
function normalizeDepSpec(name: string, spec: string): string | null {
  const trimmed = spec.trim()
  if (trimmed === '') return null
  if (isPortableSpec(trimmed)) return trimmed

  const folder = folderForPackage(name)
  if (folder !== null) return githubPathSpec(folder)

  const localPath = localPathFromSpec(trimmed)
  if (localPath !== null) {
    const pkgName = readPackageName(localPath)
    if (pkgName !== null) {
      const mapped = folderForPackage(pkgName)
      if (mapped !== null) return githubPathSpec(mapped)
    }
    const match = /[/\\]plugins[/\\]([^/\\]+)[/\\]?$/.exec(localPath)
    if (match?.[1]) return githubPathSpec(match[1])
  }

  return null
}

function isPortableSpec(spec: string): boolean {
  if (spec.startsWith('github:')) return true
  if (spec.startsWith('git+') || spec.startsWith('git@')) return true
  if (spec.startsWith('npm:')) return true
  if (spec.startsWith('http://') || spec.startsWith('https://')) return true
  if (
    !spec.includes('/')
    && !spec.includes('\\')
    && !spec.startsWith('.')
    && !spec.startsWith('link:')
    && !spec.startsWith('file:')
  ) {
    return true
  }
  if (spec.startsWith('workspace:')) return false
  return false
}

function localPathFromSpec(spec: string): string | null {
  if (spec.startsWith('link:')) return spec.slice(5)
  if (spec.startsWith('file:')) return spec.slice(5)
  if (spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec)) return spec
  return null
}

function preferredInstallSpec(name: string, portableSpec: string): string {
  const local = resolveLocalCheckout(name)
  if (local !== null) return local
  return portableSpec
}

/**
 * True when the installed dep already satisfies the cloud portable spec.
 * Do not relocate link:/file: installs across directories on every pull — only
 * compare portable identity (github path folder / registry spec).
 */
function packageSatisfiesPortable(
  name: string,
  existing: string,
  portable: string,
): boolean {
  if (existing === portable) return true
  const existingPortable = normalizeDepSpec(name, existing)
  if (existingPortable !== null && portableSpecsMatch(existingPortable, portable)) {
    return true
  }
  // Already a local checkout of this known package name.
  const existingPath = localPathFromSpec(existing)
  if (existingPath !== null && folderForPackage(name) !== null) {
    const folder = githubPathFolder(portable)
    if (folder !== null && folderForPackage(name) === folder) return true
  }
  return false
}

function portableSpecsMatch(a: string, b: string): boolean {
  if (a === b) return true
  const fa = githubPathFolder(a)
  const fb = githubPathFolder(b)
  return fa !== null && fa === fb
}

function githubPathFolder(spec: string): string | null {
  const match = /^github:[^#\s]+#path:plugins\/([^/\s#]+)$/.exec(spec.trim())
  return match?.[1] ?? null
}

function resolveLocalCheckout(packageName: string): string | null {
  const folder = folderForPackage(packageName)
  if (folder === null) return null
  const pluginsDir = resolveMonorepoPluginsDir()
  if (pluginsDir === null) return null
  const dir = join(pluginsDir, folder)
  if (!existsSync(join(dir, 'package.json'))) return null
  return dir
}

function folderForPackage(packageName: string): string | null {
  if (KNOWN_FOLDERS[packageName]) return KNOWN_FOLDERS[packageName]
  const map = scanMonorepoPackageMap()
  return map.get(packageName) ?? null
}

function githubPathSpec(folder: string): string {
  return `github:${DSH_PLUGS_REPO}#path:plugins/${folder}`
}

function thisPluginDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return basename(here) === 'lib' ? dirname(here) : here
}

function resolveMonorepoPluginsDir(): string | null {
  const pluginsDir = dirname(thisPluginDir())
  if (basename(pluginsDir) !== 'plugins') return null
  const root = dirname(pluginsDir)
  if (!existsSync(join(root, 'pnpm-workspace.yaml'))) return null
  return pluginsDir
}

let packageMapCache: Map<string, string> | null = null

function scanMonorepoPackageMap(): Map<string, string> {
  if (packageMapCache !== null) return packageMapCache
  const map = new Map<string, string>()
  const pluginsDir = resolveMonorepoPluginsDir()
  if (pluginsDir === null) {
    packageMapCache = map
    return map
  }
  try {
    for (const folder of readdirSync(pluginsDir)) {
      const name = readPackageName(join(pluginsDir, folder))
      if (name !== null) map.set(name, folder)
    }
  } catch {
    // ignore
  }
  packageMapCache = map
  return map
}

function readPackageName(dir: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string }
    return typeof raw.name === 'string' ? raw.name : null
  } catch {
    return null
  }
}

export function resolveDshBin(): string {
  if (process.env.DSH_BIN) return process.env.DSH_BIN
  const argv1 = process.argv[1] ?? ''
  if (argv1.endsWith(`${join('dsh', 'lib', 'bin.js')}`)) {
    const shim = join(argv1, '..', '..', '..', '.bin', 'dsh')
    if (existsSync(shim)) return shim
  }
  if (argv1.endsWith(`${join('.bin', 'dsh')}`) && existsSync(argv1)) return argv1
  const candidate = join(dshHome(), 'runtime', 'node_modules', '.bin', 'dsh')
  if (existsSync(candidate)) return candidate
  return 'dsh'
}

function runDshPlugin(args: string[], timeoutMs = 180_000): Promise<void> {
  const bin = resolveDshBin()
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['plugin', '--profile', 'web', ...args], {
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
      if (code === 0) {
        resolve()
        return
      }
      const detail = [Buffer.concat(stdout).toString('utf8'), Buffer.concat(stderr).toString('utf8')]
        .filter(Boolean)
        .join('\n')
        .trim()
        .slice(0, 2000)
      reject(new Error(detail || `dsh plugin ${args[0]} exited ${code}`))
    })
  })
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
