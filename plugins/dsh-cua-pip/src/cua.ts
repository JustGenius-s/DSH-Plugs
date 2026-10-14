// Thin wrapper over the Cua Driver CLI (`cua-driver call <tool> '<json>'`).
//
// Why the CLI and not a raw MCP socket: the CLI is the documented stable
// surface, answers under the signed CuaDriver bundle identity, and needs no
// persistent connection management in the plugin host. Only discovery and
// explicit window actions use this adapter. PiP pixels come exclusively from
// the independent ScreenCaptureKit stream in native-capture.ts.

import { execFile as execFileCallback } from 'node:child_process'
import { setTimeout as waitForTimeout } from 'node:timers/promises'
import { promisify } from 'node:util'
import { pickRebindCandidate } from './shared/cua-activity.ts'
import type { CuaWindow, CuaWindowBounds, Frame, WatchTarget } from './shared/types.ts'

export type { CuaWindow, CuaWindowBounds, Frame, WatchTarget } from './shared/types.ts'

const execFile = promisify(execFileCallback)

export const CUA_DRIVER_BIN = '/Applications/CuaDriver.app/Contents/MacOS/cua-driver'

export type CuaErrorCode = 'window_gone' | 'capture_failed' | 'cli_failed' | 'app_window_unavailable'
  | 'permission_denied' | 'capture_stopped' | 'capture_interrupted'

export class CuaError extends Error {
  constructor(
    message: string,
    readonly code: CuaErrorCode,
  ) {
    super(message)
    this.name = 'CuaError'
  }
}

export type Run = (file: string, args: readonly string[], options?: { signal?: AbortSignal }) => Promise<string>

export const defaultRun: Run = async (file, args, options) => {
  const { stdout } = await execFile(file, [...args], {
    timeout: 20_000,
    signal: options?.signal,
    // Preview JPEGs are small, but leave room for other driver image responses.
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function contentText(rec: Record<string, unknown>): string {
  if (!Array.isArray(rec.content)) return ''
  return rec.content.flatMap((item) => {
    const entry = record(item)
    return entry?.type === 'text' && typeof entry.text === 'string' ? [entry.text] : []
  }).join('\n')
}

function errorMessage(rec: Record<string, unknown>): string {
  const nested = record(rec.error)
  return [
    rec.code,
    rec.message,
    typeof rec.error === 'string' ? rec.error : undefined,
    nested?.code,
    nested?.message,
    record(rec.structuredContent) !== undefined ? errorMessage(record(rec.structuredContent)!) : undefined,
    rec.suggestion,
    contentText(rec),
  ].filter((value): value is string => typeof value === 'string' && value.trim() !== '').join(': ')
}

/**
 * Cua can refuse a tool with exit 0. MCP additionally carries failures in
 * `isError`/text content; do not turn those into an empty window list.
 * Successful action payloads may also contain a `code`, so consider their
 * explicit outcome before treating a bare code as an error.
 */
function throwIfErrorBody(rec: Record<string, unknown>): void {
  const explicitFailure = rec.isError === true
    || rec.ok === false
    || rec.success === false
    || rec.effect === 'refused'
    || rec.effect === 'failed'
    || ['error', 'failed', 'refused'].includes(String(rec.status))
    || typeof rec.error === 'string' && rec.error !== ''
    || record(rec.error) !== undefined
  const hasOutcome = rec.activated === true
    || rec.ok === true
    || rec.success === true
    || typeof rec.effect === 'string' && rec.effect !== ''
    || ['activated', 'launched', 'running', 'success', 'ok', 'confirmed', 'completed'].includes(String(rec.status))
    || ['request_sent', 'running', 'window_ready'].includes(String(rec.launch_state))
  if (!explicitFailure && (typeof rec.code !== 'string' || rec.code === '' || hasOutcome)) return
  const message = errorMessage(rec) || 'Cua Driver refused the request'
  throw new CuaError(message, classifyError(message))
}

/** Accept both the CLI's bare payload and standard MCP tool-result envelopes. */
export function parseCuaResponse(raw: string): Record<string, unknown> {
  const trimmed = raw.trim()
  if (trimmed === '' || (trimmed[0] !== '{' && trimmed[0] !== '[')) {
    throw new CuaError(trimmed === '' ? 'empty CLI output' : trimmed, classifyError(trimmed))
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new CuaError(trimmed, classifyError(trimmed))
  }
  let rec = record(parsed)
  if (rec === undefined) {
    throw new CuaError(trimmed, classifyError(trimmed))
  }
  const rpcResult = record(rec.result)
  if (rpcResult !== undefined && typeof rec.jsonrpc === 'string') {
    throwIfErrorBody(rec)
    rec = rpcResult
  }
  throwIfErrorBody(rec)
  const structured = record(rec.structuredContent)
  let payload = structured ?? rec
  if (structured === undefined && Array.isArray(rec.content)) {
    const text = contentText(rec)
    if (text.trim() !== '') {
      try {
        const decoded = record(JSON.parse(text))
        if (decoded !== undefined) payload = decoded
      } catch {
        // Successful MCP responses can carry explanatory text and an image.
        // Errors were handled above, before choosing a payload.
      }
    }
  }
  throwIfErrorBody(payload)
  const image = Array.isArray(rec.content)
    ? rec.content.map(record).find((entry) => entry?.type === 'image' && typeof entry.data === 'string')
    : undefined
  if (image !== undefined && typeof payload.screenshot_png_b64 !== 'string') {
    return { ...payload, screenshot_png_b64: image.data, screenshot_mime_type: image.mimeType ?? 'image/png' }
  }
  return payload
}

/** Map a CLI failure message onto a stable code the watcher can branch on. */
export function classifyError(message: string): CuaErrorCode {
  if (/window_id_not_found|window_owner_pid_mismatch|no such window|window not found/i.test(message)) {
    return 'window_gone'
  }
  if (/no content produced|screenshot|capture|px_capture_unavailable|px_frame_mismatch/i.test(message)) {
    return 'capture_failed'
  }
  return 'cli_failed'
}

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isSafeInteger(n) && n > 0 ? n : undefined
}

function windowBounds(value: unknown): CuaWindowBounds | undefined {
  const bounds = record(value)
  if (bounds === undefined) return undefined
  const { x, y, width, height } = bounds
  if (typeof x !== 'number' || !Number.isFinite(x)
    || typeof y !== 'number' || !Number.isFinite(y)
    || typeof width !== 'number' || !Number.isFinite(width) || width <= 0
    || typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return undefined
  return { x, y, width, height }
}

function windowsFromPayload(sc: Record<string, unknown>): CuaWindow[] {
  const list = sc.windows
  if (!Array.isArray(list)) throw new CuaError('Cua Driver response carried no windows array', 'cli_failed')
  const out: CuaWindow[] = []
  for (const entry of list) {
    const w = record(entry)
    if (w === undefined || w.layer !== undefined && w.layer !== 0) continue
    const bounds = record(w.bounds)
    const width = Number(bounds?.width)
    const height = Number(bounds?.height)
    const pid = positiveInt(w.pid)
    const windowId = positiveInt(w.window_id)
    if (pid === undefined || windowId === undefined) continue
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 50 || height < 50) continue
    const appName = typeof w.app_name === 'string' ? w.app_name : ''
    if (appName === '') continue
    out.push({
      pid,
      windowId,
      appName,
      title: typeof w.title === 'string' ? w.title : '',
      bounds: { x: Number(bounds?.x) || 0, y: Number(bounds?.y) || 0, width, height },
      isOnScreen: w.is_on_screen === true,
    })
  }
  return out
}

/** Parse `list_windows`. Only layer-0 windows with a usable frame are kept. */
export function parseWindows(raw: string): CuaWindow[] {
  return windowsFromPayload(parseCuaResponse(raw))
}

/** The PNG's IHDR describes the actual thumbnail, including Retina downscaling. */
function pngDimensions(base64: string): { width: number; height: number } | undefined {
  const header = Buffer.from(base64.slice(0, 44), 'base64')
  if (header.length < 24
    || !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || header.toString('ascii', 12, 16) !== 'IHDR') return undefined
  const width = positiveInt(header.readUInt32BE(16))
  const height = positiveInt(header.readUInt32BE(20))
  return width !== undefined && height !== undefined ? { width, height } : undefined
}

/** Parse either the driver's JPEG zoom image or a legacy PNG capture. */
export function parseFrame(raw: string): Frame {
  const sc = parseCuaResponse(raw)
  const base64 = sc.screenshot_png_b64
  if (typeof base64 !== 'string' || base64.length === 0) {
    const reason = typeof sc.degraded_reason === 'string' ? `: ${sc.degraded_reason}` : ''
    throw new CuaError(`preview response carried no screenshot${reason}`, 'capture_failed')
  }
  const dimensions = pngDimensions(base64)
  const width = dimensions?.width ?? positiveInt(sc.screenshot_width) ?? positiveInt(sc.width)
  const height = dimensions?.height ?? positiveInt(sc.screenshot_height) ?? positiveInt(sc.height)
  if (width === undefined || height === undefined) {
    throw new CuaError('preview response carried invalid screenshot dimensions', 'capture_failed')
  }
  const bounds = windowBounds(sc.window_bounds)
  return {
    mime: typeof sc.screenshot_mime_type === 'string'
      ? sc.screenshot_mime_type : typeof sc.mime_type === 'string' ? sc.mime_type : 'image/png',
    base64,
    width,
    height,
    appName: typeof sc.app_name === 'string' ? sc.app_name : '',
    windowTitle: typeof sc.window_title === 'string' ? sc.window_title : '',
    ...(bounds === undefined ? {} : { windowBounds: bounds }),
  }
}

export async function listWindows(run: Run = defaultRun, bin: string = CUA_DRIVER_BIN): Promise<CuaWindow[]> {
  return windowsFromPayload(await callCua('list_windows', {}, run, bin))
}

async function callCua(
  tool: string,
  args: Record<string, unknown>,
  run: Run,
  bin: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  try {
    signal?.throwIfAborted()
    const raw = await run(bin, ['call', tool, JSON.stringify(args)], { signal })
    signal?.throwIfAborted()
    return parseCuaResponse(raw)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof CuaError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new CuaError(message, classifyError(message))
  }
}

export interface OpenApplicationOptions {
  /** Additional window-list polls after launch. Defaults to 12 (at most 3 s of waits). */
  retries?: number
  retryDelayMs?: number
  signal?: AbortSignal
  /** Test hook; production uses a short delay between window-list polls. */
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>
}

function matchesApp(app: Record<string, unknown>, requested: string): boolean {
  const key = requested.trim().toLocaleLowerCase()
  return [app.name, app.bundle_id, app.launch_path]
    .some((value) => typeof value === 'string' && value.toLocaleLowerCase() === key)
}

/**
 * Open any installed application through Cua's background launch path, then
 * resolve an exact process/window pair. The driver may return before the
 * process or its first window is ready, so only polling is retried; launch
 * itself is never repeated and no foreground activation is requested.
 */
export async function openApplication(
  application: string,
  options: OpenApplicationOptions = {},
  run: Run = defaultRun,
  bin: string = CUA_DRIVER_BIN,
): Promise<CuaWindow> {
  options.signal?.throwIfAborted()
  const app = application.trim()
  if (app === '') throw new CuaError('application name or bundle id is required', 'cli_failed')
  const isBundleId = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(app) && !/\.app$/i.test(app)
  const inventory = await callCua('list_apps', {}, run, bin, options.signal)
  if (!Array.isArray(inventory.apps)) throw new CuaError('Cua Driver response carried no apps array', 'cli_failed')
  const existing = inventory.apps.map(record).find((entry) => entry !== undefined
    && positiveInt(entry.pid) !== undefined && matchesApp(entry, app))
  // Reopening an already running app can dispatch a reopen event that the app
  // handles by activating itself. Observe its existing windows instead.
  const launched = existing ?? await callCua(
    'launch_app', isBundleId ? { bundle_id: app } : { name: app }, run, bin, options.signal,
  )
  let pid = positiveInt(launched.pid)
  const launchedWindows = Array.isArray(launched.windows) ? windowsFromPayload(launched) : []
  // Some driver versions report windows before the top-level pid is populated.
  if (pid === undefined) {
    const pids = new Set(launchedWindows.map((window) => window.pid))
    if (pids.size === 1) pid = launchedWindows[0]?.pid
  }
  if (pid !== undefined) {
    const ready = pickRebindCandidate(launchedWindows, pid)
    if (ready !== undefined) return ready
  }
  const retries = Number.isFinite(options.retries)
    ? Math.min(30, Math.max(0, Math.floor(options.retries!)))
    : 12
  const delay = Number.isFinite(options.retryDelayMs)
    ? Math.min(2_000, Math.max(0, options.retryDelayMs!))
    : 250
  const wait = options.wait ?? ((ms, signal) => waitForTimeout(ms, undefined, { signal }))
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    options.signal?.throwIfAborted()
    if (attempt > 0) await wait(delay, options.signal)
    options.signal?.throwIfAborted()
    if (pid === undefined) {
      const apps = await callCua('list_apps', {}, run, bin, options.signal)
      if (!Array.isArray(apps.apps)) throw new CuaError('Cua Driver response carried no apps array', 'cli_failed')
      const running = apps.apps.map(record).find((candidate) => candidate !== undefined
        && positiveInt(candidate.pid) !== undefined
        && (matchesApp(candidate, app)
          || typeof launched.bundle_id === 'string' && matchesApp(candidate, launched.bundle_id)
          || typeof launched.name === 'string' && matchesApp(candidate, launched.name)))
      pid = positiveInt(running?.pid)
    }
    if (pid === undefined) continue
    const windows = windowsFromPayload(await callCua('list_windows', { pid }, run, bin, options.signal))
    const candidate = pickRebindCandidate(windows, pid)
    if (candidate !== undefined) return candidate
  }
  throw new CuaError(
    `${app} did not provide a capturable application window; it may still be starting or have no open window`,
    'app_window_unavailable',
  )
}

/**
 * Read one exact window without the inventory's minimum thumbnail-size filter.
 * Position must be a real native coordinate: defaulting missing x/y to zero
 * before a frame mutation would unexpectedly move the user's application.
 */
async function readExactWindow(
  target: WatchTarget,
  run: Run,
  bin: string,
  signal?: AbortSignal,
): Promise<CuaWindow> {
  const payload = await callCua('list_windows', { pid: target.pid }, run, bin, signal)
  if (!Array.isArray(payload.windows)) {
    throw new CuaError('Cua Driver response carried no windows array', 'cli_failed')
  }
  const window = payload.windows.map(record).find((entry) =>
    entry !== undefined
    && positiveInt(entry.pid) === target.pid
    && positiveInt(entry.window_id) === target.windowId
    && (entry.layer === undefined || entry.layer === 0))
  if (window === undefined) {
    throw new CuaError(`window_id_not_found: ${target.windowId} for pid ${target.pid}`, 'window_gone')
  }
  const bounds = windowBounds(window.bounds)
  if (bounds === undefined) {
    throw new CuaError('Cua Driver returned invalid native window bounds', 'cli_failed')
  }
  return {
    pid: target.pid,
    windowId: target.windowId,
    appName: typeof window.app_name === 'string' ? window.app_name : '',
    title: typeof window.title === 'string' ? window.title : '',
    bounds,
    isOnScreen: window.is_on_screen === true,
  }
}

/**
 * Resize the bound application window through the native window-frame API.
 * Width/height use list_windows desktop units (logical points on macOS), not
 * screenshot pixels. The driver's schema requires x/y, so read and preserve
 * the current origin. No activation or pointer action is requested.
 *
 * Mutate once, then independently read back the same pid/window_id. Apps and
 * window managers can clamp requested dimensions; the returned bounds always
 * describe what actually exists. Never retry an uncertain frame mutation.
 */
export async function resizeApplicationWindow(
  target: WatchTarget,
  size: { width: number; height: number },
  options: { signal?: AbortSignal } = {},
  run: Run = defaultRun,
  bin: string = CUA_DRIVER_BIN,
): Promise<CuaWindow> {
  options.signal?.throwIfAborted()
  if (positiveInt(target.pid) !== target.pid || positiveInt(target.windowId) !== target.windowId) {
    throw new CuaError('positive integer pid and windowId are required', 'cli_failed')
  }
  if (![size.width, size.height].every((value) => Number.isSafeInteger(value) && value >= 1 && value <= 16_384)) {
    throw new CuaError('window width and height must be integers between 1 and 16384', 'cli_failed')
  }
  const before = await readExactWindow(target, run, bin, options.signal)
  await callCua('set_window_frame', {
    pid: target.pid,
    window_id: target.windowId,
    x: before.bounds.x,
    y: before.bounds.y,
    width: size.width,
    height: size.height,
  }, run, bin, options.signal)
  return readExactWindow(target, run, bin, options.signal)
}

/**
 * `bring_to_front` exits 0 even when the driver refuses. Pid-only calls
 * return `{effect:"refused", code:"ambiguous_window_target"}` when the
 * app has more than one window (Calculator ships 9). Pass window_id and
 * treat a refused payload as failure.
 */
export function assertBroughtToFront(raw: string): void {
  const sc = parseCuaResponse(raw)
  if (sc.effect === 'refused') {
    const code = typeof sc.code === 'string' && sc.code !== '' ? sc.code : 'bring_to_front_refused'
    throw new CuaError(code, classifyError(code))
  }
  if (sc.activated === true || sc.status === 'activated') return
  throw new CuaError('Cua Driver did not confirm window activation', 'cli_failed')
}

export async function bringToFront(
  target: WatchTarget,
  run: Run = defaultRun,
  bin: string = CUA_DRIVER_BIN,
): Promise<void> {
  assertBroughtToFront(
    await run(bin, ['call', 'bring_to_front', JSON.stringify({ pid: target.pid, window_id: target.windowId })]),
  )
}

export { pickRebindCandidate } from './shared/cua-activity.ts'
