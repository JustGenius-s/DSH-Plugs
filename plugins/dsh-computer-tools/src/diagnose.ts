import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

export const DEFAULT_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export const DEFAULT_CUA_COMMAND = 'cua-driver'
export const CUA_DRIVER_APP = '/Applications/CuaDriver.app'

export function chromeCandidates(platform = process.platform): string[] {
  if (platform === 'darwin') {
    return [
      DEFAULT_CHROME_PATH,
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ]
  }
  if (platform === 'win32') {
    return [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ]
  }
  return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
}

export function firstExisting(paths: readonly string[], exists: (path: string) => boolean = existsSync): string {
  return paths.find((path) => exists(path)) ?? paths[0] ?? DEFAULT_CHROME_PATH
}

export function commandOnPath(
  command: string,
  pathEnv = process.env.PATH ?? '',
  exists: (path: string) => boolean = existsSync,
): boolean {
  const trimmed = command.trim()
  if (trimmed === '') return false
  if (trimmed.includes('/') || trimmed.includes('\\')) return exists(trimmed)
  for (const dir of pathEnv.split(delimiter)) {
    if (dir !== '' && exists(join(dir, trimmed))) return true
  }
  return false
}

/**
 * Resolve the dsh entry to paste into a copied command. A DSH-Desktop host has
 * no `dsh` on PATH, so the bare name would fail in the user's terminal; prefer
 * `$DSH_HOME/runtime/node_modules/.bin/dsh` when it exists. Mirrors the host
 * side's own resolver rather than reaching across plugin packages.
 */
export function resolveDshBin(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): string {
  const fromEnv = env.DSH_BIN?.trim()
  if (fromEnv !== undefined && fromEnv !== '' && exists(fromEnv)) return fromEnv
  const home = env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const candidate = join(home, 'runtime', 'node_modules', '.bin', 'dsh')
  if (exists(candidate)) return candidate
  return 'dsh'
}

/**
 * Where a `cua-driver` install lands. The official installer symlinks
 * `~/.local/bin/cua-driver` into `CuaDriver.app`; a DSH host's PATH does not
 * usually carry `~/.local/bin`, so the provider config needs an absolute path.
 */
export function cuaCommandCandidates(home = process.env.HOME ?? homedir()): string[] {
  return [
    join(home, '.local', 'bin', DEFAULT_CUA_COMMAND),
    join(CUA_DRIVER_APP, 'Contents', 'MacOS', DEFAULT_CUA_COMMAND),
    join('/usr/local/bin', DEFAULT_CUA_COMMAND),
    join('/opt/homebrew/bin', DEFAULT_CUA_COMMAND),
  ]
}

/**
 * Resolve the MCP provider's `command` to an absolute path so the host can
 * spawn it regardless of its own PATH. Falls back to the bare name, which is
 * correct only when the user's PATH happens to carry it.
 */
export function resolveCuaCommand(input: {
  pathEnv?: string
  pathExists?: (path: string) => boolean
  home?: string
} = {}): string {
  const exists = input.pathExists ?? existsSync
  const pathEnv = input.pathEnv ?? process.env.PATH ?? ''
  for (const dir of pathEnv.split(delimiter)) {
    if (dir === '') continue
    const candidate = join(dir, DEFAULT_CUA_COMMAND)
    if (exists(candidate)) return candidate
  }
  return cuaCommandCandidates(input.home).find((candidate) => exists(candidate)) ?? DEFAULT_CUA_COMMAND
}

export function privacyUrl(pane: 'accessibility' | 'screen'): string {
  const key = pane === 'accessibility' ? 'Privacy_Accessibility' : 'Privacy_ScreenCapture'
  return `x-apple.systempreferences:com.apple.preference.security?${key}`
}

export function parsePrivacyPane(value: unknown): 'accessibility' | 'screen' | null {
  if (value === 'accessibility' || value === 'screen') return value
  return null
}
