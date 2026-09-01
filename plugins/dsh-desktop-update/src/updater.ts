// Update DETECTION for @just-genius/dsh-desktop-update (Host half).
//
// This is the half that used to live in DSH-Desktop's Electron main process.
// It needs no Electron and no browser window: a plain `fetch` from the dsh web
// host reaches GitHub Releases and the npm registry. Keeping it here also means
// detection keeps running when no window is open, and that a remote web session
// sees the same results as the desktop shell.
//
// The shell keeps only what genuinely requires it: its own packaged version,
// `pnpm add` for the runtime, opening the download page, and relaunching.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { DesktopUpdateConfig, DesktopUpdateInfo, DesktopUpdateKind, DshChannel } from './shared'

/**
 * GitHub Releases "latest" page (not the REST API). It 302-redirects to
 * `/releases/tag/vX.Y.Z`, so the version parses out of the Location header.
 * The REST API is deliberately avoided: unauthenticated it is rate-limited to
 * 60 requests/hour/source IP, which corporate NAT exhausts and turns detection
 * into a silent failure. The web endpoint has no such limit and behaves the
 * same (draft → 404, prerelease is never "latest").
 */
const RELEASES_URL = 'https://github.com/JustGenius-s/DSH-Desktop/releases/latest'

const NPM_REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh'

/** Per-request timeout. Detection is best-effort; never block startup on it. */
const REQUEST_TIMEOUT_MS = 10_000

/** DSH home, matching the CLI convention (`$DSH_HOME` or `~/.dsh`). */
function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

function normalizeVersion(v: string): string {
  return v.replace(/^[vV]/, '')
}

/** Parse a version into [major, minor, patch, prerelease segments]. */
function parseVersion(v: string): [number, number, number, string[]] {
  const m = /^[vV]?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v.trim())
  if (m === null) return [0, 0, 0, []]
  const pre = m[4] === undefined ? [] : m[4].split('.')
  return [Number(m[1]), Number(m[2]), Number(m[3]), pre]
}

/**
 * Compare two versions: positive when a > b, 0 when equal, negative when a < b.
 *
 * A release outranks any prerelease of the same number; prerelease segments
 * compare pairwise, numeric segments numerically and the rest lexically, with
 * numeric segments ranking before non-numeric ones. The DSH runtime ships `rc`
 * prereleases, so this must understand them — otherwise 0.1.0-rc.6 and
 * 0.1.0-rc.7 compare equal and the update never surfaces.
 */
export function compareVersions(a: string, b: string): number {
  const [aMaj, aMin, aPat, aPre] = parseVersion(a)
  const [bMaj, bMin, bPat, bPre] = parseVersion(b)
  for (const [x, y] of [[aMaj, bMaj], [aMin, bMin], [aPat, bPat]]) {
    if (x !== y) return x - y
  }
  if (aPre.length === 0 && bPre.length === 0) return 0
  if (aPre.length === 0) return 1
  if (bPre.length === 0) return -1
  for (let i = 0; i < Math.max(aPre.length, bPre.length); i++) {
    const x = aPre[i]
    const y = bPre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = Number(x)
    const yn = Number(y)
    const xIsNum = !Number.isNaN(xn) && /^\d+$/.test(x)
    const yIsNum = !Number.isNaN(yn) && /^\d+$/.test(y)
    if (xIsNum && yIsNum) { if (xn !== yn) return xn - yn; continue }
    if (xIsNum) return -1
    if (yIsNum) return 1
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** Whether a string looks like an npm package version (no tag semantics). */
export function looksLikeVersion(input: string): boolean {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(input.trim())
}

/**
 * Latest published DSH-Desktop release.
 * Network failure, no release (404), and unexpected responses all resolve to
 * undefined — detection is best-effort and must never throw at a caller.
 */
export async function latestAppRelease(): Promise<{ version: string; url: string } | undefined> {
  try {
    // redirect: 'manual' reads the 302 Location without following it (saves a
    // full page download).
    const res = await fetch(RELEASES_URL, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'manual',
      headers: { 'User-Agent': 'DSH-Desktop' },
    })
    if (res.status !== 302 && res.status !== 301) return undefined
    const location = res.headers.get('location')
    if (location === null) return undefined
    // Location looks like https://github.com/<owner>/<repo>/releases/tag/vX.Y.Z
    const tag = /\/releases\/tag\/([^/?#]+)/.exec(location)?.[1]
    if (tag === undefined) return undefined
    return { version: normalizeVersion(decodeURIComponent(tag)), url: location }
  } catch {
    return undefined
  }
}

/** Read `@deepseek-ai/dsh`'s dist-tags from npm; undefined on any failure. */
async function fetchDshDistTags(): Promise<Record<string, string> | undefined> {
  try {
    const res = await fetch(NPM_REGISTRY_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!res.ok) return undefined
    const body = (await res.json()) as { 'dist-tags'?: unknown }
    const tags = body['dist-tags']
    if (tags === null || typeof tags !== 'object') return undefined
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(tags as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value
    }
    return out
  } catch {
    return undefined
  }
}

/**
 * Resolve the DSH runtime version a channel points at.
 * - `latest` / `next` / `alpha`: the same-named npm dist-tag; undefined when
 *   the tag does not exist. (`alpha` exists because upstream publishes alphas
 *   under that tag without moving `latest` — without it alpha releases are
 *   invisible to detection.)
 * - `custom`: the pinned exact version; undefined when unusable.
 */
export async function resolveDshChannelVersion(
  channel: DshChannel,
  exact?: string,
): Promise<string | undefined> {
  if (channel === 'custom') {
    const version = (exact ?? '').trim()
    return version !== '' && looksLikeVersion(version) ? version : undefined
  }
  const tags = await fetchDshDistTags()
  if (tags === undefined) return undefined
  const version = tags[channel]
  return typeof version === 'string' && version !== '' ? version : undefined
}

/**
 * The installed DSH runtime version.
 *
 * The plugin is installed under `~/.dsh/plugins/…`, which has no path to the
 * profile's hoisted store, so resolution is anchored on the profile — verified
 * to be the only reliable anchor (resolving from the install directory fails
 * with MODULE_NOT_FOUND). Anchors are tried in order and the first hit wins.
 */
export function installedDshVersion(): string | undefined {
  const anchors = [
    join(dshHome(), 'profiles', 'web', 'package.json'),
    join(dshHome(), 'runtime', 'node_modules', 'index.js'),
    import.meta.url,
  ]
  for (const anchor of anchors) {
    try {
      const req = createRequire(anchor)
      // The package's exports map does not expose its root; only the
      // package.json subpath resolves.
      const pkg = req('@deepseek-ai/dsh/package.json') as { version?: unknown }
      if (typeof pkg.version === 'string') return pkg.version
    } catch {
      // Try the next anchor.
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Skipped versions
// ---------------------------------------------------------------------------

/**
 * "Skip this version" record: kind → the latest version the user dismissed.
 * A skipped latest stays hidden until a newer one appears. Deliberately not a
 * permanent "never ask again" — the badge is unobtrusive, so there is no need.
 *
 * Stored under DSH home rather than through a settings namespace: this is
 * internal state, not user-editable configuration.
 */
function skipFilePath(): string {
  return join(dshHome(), 'desktop-update-skip.json')
}

export type SkipMap = Partial<Record<DesktopUpdateKind, string>>

export function readSkipped(): SkipMap {
  try {
    const obj = JSON.parse(readFileSync(skipFilePath(), 'utf8')) as Record<string, unknown>
    const out: SkipMap = {}
    for (const kind of ['app', 'dsh'] as const) {
      if (typeof obj[kind] === 'string') out[kind] = obj[kind]
    }
    return out
  } catch {
    return {}
  }
}

export function writeSkipped(map: SkipMap): void {
  try {
    mkdirSync(dirname(skipFilePath()), { recursive: true })
    writeFileSync(skipFilePath(), JSON.stringify(map, null, 2) + '\n')
  } catch {
    // A failed write only means this skip is not remembered.
  }
}

/** Hide an update whose latest is at or below the skipped version. */
export function applySkip(info: DesktopUpdateInfo | null, kind: DesktopUpdateKind): DesktopUpdateInfo | null {
  if (info === null) return null
  const skipped = readSkipped()[kind]
  return skipped !== undefined && compareVersions(info.latest, skipped) <= 0 ? null : info
}

/**
 * One detection round. Never throws: every failure degrades to "no update",
 * keeping the last known-good state rather than blanking the UI.
 *
 * `appVersion` is the desktop shell's packaged version, injected by the caller
 * because only the shell knows it; it is empty in a plain browser, which
 * disables the app half of detection.
 */
export async function detectUpdates(
  config: DesktopUpdateConfig,
  appVersion: string,
): Promise<{ app: DesktopUpdateInfo | null; dsh: DesktopUpdateInfo | null }> {
  const [release, dshLatest] = await Promise.all([
    config.checkApp && appVersion !== ''
      ? latestAppRelease().catch(() => undefined)
      : Promise.resolve(undefined),
    config.checkDsh
      ? resolveDshChannelVersion(config.dshChannel ?? 'latest', config.dshVersion).catch(() => undefined)
      : Promise.resolve(undefined),
  ])

  const app: DesktopUpdateInfo | null =
    release !== undefined && appVersion !== '' && compareVersions(release.version, appVersion) > 0
      ? { current: appVersion, latest: release.version, url: release.url }
      : null

  const dshInstalled = installedDshVersion()
  const dsh: DesktopUpdateInfo | null =
    dshLatest !== undefined && dshInstalled !== undefined && compareVersions(dshLatest, dshInstalled) > 0
      ? { current: dshInstalled, latest: dshLatest }
      : null

  return {
    app: config.checkApp ? applySkip(app, 'app') : null,
    dsh: config.checkDsh ? applySkip(dsh, 'dsh') : null,
  }
}

/** Whether a DSH runtime install is present on disk (for the `dsh` version row). */
export function hasDshInstall(): boolean {
  return existsSync(join(dshHome(), 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
}
