// Host half of @just-genius/dsh-desktop-update.
//
// Owns update DETECTION and the `desktop-update` settings namespace. Detection
// used to live in DSH-Desktop's Electron main process; it belongs here because
// the Host half already runs in the dsh web host's Node process, where a plain
// `fetch` reaches GitHub Releases and the npm registry — no CORS, no Electron,
// and it keeps running when no window is open.
//
// The shell (DSH-Desktop) is now an EXECUTOR only: it reports its packaged
// version, runs `pnpm add` for the runtime, opens the download page, and
// relaunches. It detects nothing, and it no longer polls.
//
// The one thing the Host cannot know is the shell's packaged version, and the
// one thing it cannot do is execute. Both are solved by the browser half, which
// is the only place where the shell (via `window.dshDesktop`) and this Host
// (via these routes) are both reachable:
//
//   POST VERSION_PATH { app }  → browser reports the shell's version;
//                                the app half of detection needs it
//   POST EXEC_PATH   { action } → browser has executed (or failed); the Host
//                                records the outcome so every other window and
//                                any later session sees the same progress
//
// Routes (same-origin, registered on ctx.webServer):
//   GET  STATE_PATH   → current DesktopUpdateState
//   POST CHECK_PATH   → force one detection round
//   POST VERSION_PATH → browser reports the shell's packaged version
//   POST EXEC_PATH    → browser reports an execute outcome
//   POST SKIP_PATH    → { kind } dismiss the current latest

import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import {
  HOST_SERVICES,
  Schema,
  readJsonBody,
  sendJson,
  settingsNamespace,
} from '@just-genius/dsh-plugin-runtime/host'

import {
  CHECK_PATH,
  EMPTY_STATE,
  EXEC_PATH,
  SKIP_PATH,
  STATE_PATH,
  VERSION_PATH,
  type DesktopExecReport,
  type DesktopUpdateConfig,
  type DesktopUpdateResult,
  type DesktopUpdateState,
} from './shared'
import { detectUpdates, installedDshVersion, readSkipped, writeSkipped } from './updater'

export const name = 'desktop-update'

/** Settings namespace owned by this plugin. */
export const SETTINGS_NS = 'desktop-update'

/** Background detection interval: 6 hours. */
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000

/** User-togglable gates for the two background checks. */
export const Config = Schema.object({
  /** 自动检查 DSH-Desktop 本体更新（GitHub Releases）。 */
  checkApp: Schema.boolean().default(true),
  /** 自动检查 DSH 运行时更新（npm registry）。 */
  checkDsh: Schema.boolean().default(true),
  /**
   * DSH 运行时更新渠道：npm dist-tag（latest/next/alpha）或按精确版本（custom）。
   * `alpha` 对应 npm 的 `alpha` dist-tag：上游发 alpha 时不会更新 `latest`，
   * 因此只有显式选该渠道才能检测到 alpha 版本。
   */
  dshChannel: Schema.union([
    Schema.const('latest' as const),
    Schema.const('next' as const),
    Schema.const('alpha' as const),
    Schema.const('custom' as const),
  ]).default('latest' as const),
  /** dshChannel === 'custom' 时匹配的精确版本。 */
  dshVersion: Schema.string().default(''),
})
export type Config = Schemastery.TypeT<typeof Config>

const DEFAULTS: Config = {
  checkApp: true,
  checkDsh: true,
  dshChannel: 'latest',
  dshVersion: '',
}

export const inject = [HOST_SERVICES.webServer, HOST_SERVICES.settings] as const

/** Narrow the request body helpers onto this plugin's response envelope. */
function result(res: ServerResponseLike, status: number, body: DesktopUpdateResult): void {
  sendJson(res, status, body)
}

/** Minimal response surface: enough for sendJson, no node:http import needed. */
type ServerResponseLike = Parameters<typeof sendJson>[0]

export function apply(ctx: Context) {
  let state: DesktopUpdateState = {
    ...EMPTY_STATE,
    versions: { app: '', dsh: installedDshVersion() ?? null },
  }

  /**
   * One detection round. Never throws: a failure keeps the previous state, so a
   * flaky network never blanks the UI. Re-entrant calls share one round rather
   * than racing.
   */
  let inFlight: Promise<void> | null = null
  function detect(): Promise<void> {
    if (inFlight !== null) return inFlight
    state = { ...state, checking: true }
    inFlight = (async () => {
      try {
        const config = currentConfig()
        const found = await detectUpdates(config, state.versions.app)
        state = {
          ...state,
          app: found.app,
          dsh: found.dsh,
          checking: false,
          config,
          versions: { app: state.versions.app, dsh: installedDshVersion() ?? null },
        }
      } catch {
        state = { ...state, checking: false }
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  // Take the settings scope directly rather than through
  // `installSettingsSection`: that helper keeps the scope to itself and hands
  // back only a read thunk, while detection needs `watch` (re-run when the
  // gates or channel change). Registering the namespace is enough for the
  // browser card, which reads it through the generic settings RPC.
  let scope: { get(): Config } | undefined
  function currentConfig(): DesktopUpdateConfig {
    return scope?.get() ?? DEFAULTS
  }

  ctx.inject([HOST_SERVICES.settings], (sctx) => {
    const registered = sctx.settings.register(settingsNamespace(SETTINGS_NS), Config, { base: DEFAULTS })
    scope = { get: () => registered.get() }
    state = { ...state, config: registered.get() }
    sctx.effect(
      () =>
        registered.watch((next) => {
          state = { ...state, config: next }
          // Gates or channel changed: re-detect on the new settings.
          void detect()
        }),
      'desktop-update: settings watch',
    )
  })

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: STATE_PATH,
        handler: (_req, res) => {
          sendJson(res, 200, state)
        },
      }),
    'desktop-update: state route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: CHECK_PATH,
        handler: (req, res) => {
          void handle(res, async () => {
            await detect()
            return { ok: true, state }
          }, req)
        },
      }),
    'desktop-update: check route',
  )

  // The browser half reports the shell's packaged version. Only the shell knows
  // it, and only the browser half can reach both sides. An empty string means
  // "no shell" (plain browser), which disables the app half of detection.
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: VERSION_PATH,
        handler: (req, res) => {
          void handle(res, async () => {
            const body = (await readJsonBody(req)) as { app?: unknown }
            const app = typeof body.app === 'string' ? body.app : ''
            const changed = app !== state.versions.app
            state = {
              ...state,
              versions: { ...state.versions, app },
              shell: app !== '',
            }
            // First report, or the shell was upgraded: the app half of the
            // result is stale, so re-detect.
            if (changed) await detect()
            return { ok: true, state }
          }, req)
        },
      }),
    'desktop-update: version route',
  )

  // The browser half drove an execute through the shell and reports the
  // outcome. Recording it here keeps progress consistent across windows and
  // survives a page reload mid-update.
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: EXEC_PATH,
        handler: (req, res) => {
          void handle(res, async () => {
            const report = parseExecReport(await readJsonBody(req))
            if (report === undefined) {
              return { ok: false, state, error: 'unknown action' }
            }
            state = applyExecReport(state, report)
            return { ok: true, state }
          }, req)
        },
      }),
    'desktop-update: exec route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: SKIP_PATH,
        handler: (req, res) => {
          void handle(res, async () => {
            const body = (await readJsonBody(req)) as { kind?: unknown }
            const kind = body.kind
            if (kind !== 'app' && kind !== 'dsh') {
              return { ok: false, state, error: 'unknown kind' }
            }
            const info = state[kind]
            if (info !== null) {
              writeSkipped({ ...readSkipped(), [kind]: info.latest })
              state = { ...state, [kind]: null }
            }
            return { ok: true, state }
          }, req)
        },
      }),
    'desktop-update: skip route',
  )

  // Periodic detection. The timer service (`ctx.interval`) is only reachable
  // through an inject, and mixing a plain Web API timer into the fiber is both
  // simpler and one less service to depend on — so: own the interval, and let
  // the fiber's effect own its cleanup.
  const poll = setInterval(() => { void detect() }, POLL_INTERVAL_MS)
  // 检测不该续命应用：定时器不保持事件循环存活。
  poll.unref?.()
  ctx.effect(() => () => clearInterval(poll), 'desktop-update: poll timer')

  // First round: do not block activation on the network.
  void detect()
}

/** Fold one execute report into the state. */
export function applyExecReport(
  current: DesktopUpdateState,
  report: DesktopExecReport,
): DesktopUpdateState {
  if (report.phase === 'start') {
    return {
      ...current,
      updatingDsh: true,
      updateMessage: `正在更新 DSH 运行时到 ${report.version}…`,
      needsRelaunch: false,
    }
  }
  if (report.phase === 'error') {
    return {
      ...current,
      updatingDsh: false,
      updateMessage: `更新失败：${report.message}`,
      needsRelaunch: false,
    }
  }
  // done: the new runtime is installed and needs a relaunch to take effect.
  return {
    ...current,
    dsh: null,
    updatingDsh: false,
    updateMessage: `已安装 ${report.version}，请重启 DSH-Desktop 生效`,
    needsRelaunch: true,
    versions: { app: current.versions.app, dsh: installedDshVersion() ?? null },
  }
}

function parseExecReport(body: unknown): DesktopExecReport | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const report = body as Record<string, unknown>
  const phase = report['phase']
  if (phase === 'start' || phase === 'done') {
    return typeof report['version'] === 'string'
      ? { phase, version: report['version'] }
      : undefined
  }
  if (phase === 'error') {
    return typeof report['message'] === 'string'
      ? { phase, message: report['message'] }
      : undefined
  }
  return undefined
}

/** Run a route body, mapping a throw onto the envelope instead of crashing. */
async function handle(
  res: ServerResponseLike,
  body: () => Promise<DesktopUpdateResult>,
  req?: Parameters<typeof readJsonBody>[0],
): Promise<void> {
  try {
    const value = await body()
    result(res, value.ok ? 200 : 400, value)
  } catch (err) {
    result(res, 400, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
