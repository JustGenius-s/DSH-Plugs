import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context, Entry } from '@just-genius/dsh-plugin-runtime/host'
import type {} from '@just-genius/dsh-plugin-runtime'
import { HOST_SERVICES, errorMessage, readJsonBody, sendJson as json } from '@just-genius/dsh-plugin-runtime/host'
import { parsePrivacyPane, privacyUrl, resolveDshBin } from './diagnose.ts'
import { probeCuaDriver, restartCuaDriver } from './cua-driver.ts'
import { reapOrphans, type ReapReport } from './reaper.ts'
import { readLedger, writeLedger } from './ledger.ts'
import { ComputerToolsManager, parseInstallRequest, parseMutateRequest } from './manager.ts'
import {
  APPLY_PATH,
  INSTALL_PATH,
  OPEN_PRIVACY_PATH,
  PREVIEW_PATH,
  RESTART_DRIVER_PATH,
  STATUS_PATH,
  type FiberPhase,
} from './shared.ts'
import type { LoaderRow } from './status.ts'
import { createToolchainProbe } from './toolchain.ts'

export const name = 'dsh-computer-tools'
export const inject = [HOST_SERVICES.pluginProfile, HOST_SERVICES.webServer, HOST_SERVICES.loader] as const

export function apply(ctx: Context): void {
  const hostStartedAt = Date.now()

  // Reap browser/MCP processes orphaned by a previous abnormal exit. This runs
  // once, at boot, which is the only moment a leftover is unambiguously garbage:
  // nothing from this run exists yet, so anything matching is from the last one.
  // It is also the failure this sweep prevents — a surviving Chromium holds the
  // provider's browser slot and makes new sessions fail to start.
  if (process.platform !== 'win32') {
    void reapOrphans().then(
      (report) => { logReap(report) },
      (error: unknown) => { ctx.logger?.warn?.(`dsh-computer-tools: orphan sweep failed: ${errorMessage(error)}`) },
    )
  }

  const manager = new ComputerToolsManager({
    snapshot: () => ctx.pluginProfile.snapshot(),
    reconcile: (input) => ctx.pluginProfile.reconcile(input),
    install: (spec) => ctx.pluginProfile.install(spec),
    probeDriver: (command) => probeCuaDriver({ command }),
    probeToolchain: createToolchainProbe(() => ctx.get(HOST_SERVICES.tools)),
    restartDriver: (command) => restartCuaDriver({ command }),
    wait: (ms) => new Promise<void>((resolve) => { setTimeout(resolve, ms) }),
    loaderRows: () => collectLoaderRows(ctx),
    pathExists: existsSync,
    dshBin: () => resolveDshBin(),
    now: () => Date.now(),
    hostStartedAt,
    platform: process.platform,
    pathEnv: process.env.PATH ?? '',
    readLedger,
    writeLedger,
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATUS_PATH,
    handler: (req, res) => handleStatus(manager, req, res),
  }), 'dsh-computer-tools: status')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PREVIEW_PATH,
    handler: (req, res) => handlePreview(manager, req, res),
  }), 'dsh-computer-tools: preview')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: APPLY_PATH,
    handler: (req, res) => handleApply(manager, req, res),
  }), 'dsh-computer-tools: apply')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: INSTALL_PATH,
    handler: (req, res) => handleInstall(manager, req, res),
  }), 'dsh-computer-tools: install')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: RESTART_DRIVER_PATH,
    handler: (req, res) => handleRestartDriver(manager, req, res),
  }), 'dsh-computer-tools: restart-driver')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: OPEN_PRIVACY_PATH,
    handler: (req, res) => handleOpenPrivacy(req, res),
  }), 'dsh-computer-tools: open-privacy')
}

/**
 * Report one sweep to the host log. Silence when there was nothing to do keeps
 * a normal boot clean; a real reap is worth a line because it explains why a
 * browser slot that looked taken was free.
 */
function logReap(report: ReapReport): void {
  const parts: string[] = []
  if (report.terminated.length > 0) parts.push(`${report.terminated.length} exited on SIGTERM`)
  if (report.killed.length > 0) parts.push(`${report.killed.length} needed SIGKILL`)
  if (report.failed.length > 0) parts.push(`${report.failed.length} failed`)
  if (parts.length === 0) return
  const kinds = report.found.map((target) => target.kind).join(', ')
  process.stderr.write(`dsh-computer-tools: reaped ${report.found.length} orphaned browser process(es) [${kinds}]: ${parts.join('; ')}\n`)
}

function handleStatus(manager: ComputerToolsManager, req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET') {
    json(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  // Async now: the status carries a subprocess probe of the Cua Driver.
  void manager.status().then(
    (status) => { json(res, 200, { ok: true, value: status }) },
    (error: unknown) => { json(res, 500, { ok: false, message: errorMessage(error) }) },
  )
}

async function handleRestartDriver(
  manager: ComputerToolsManager,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  try {
    json(res, 200, await manager.restartDriver())
  } catch (error) {
    json(res, 500, { ok: false, message: errorMessage(error) })
  }
}

async function handlePreview(manager: ComputerToolsManager, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const request = await readMutate(req, res)
  if (request === undefined) return
  try {
    json(res, 200, manager.preview(request))
  } catch (error) {
    json(res, 500, { ok: false, message: errorMessage(error) })
  }
}

async function handleApply(manager: ComputerToolsManager, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const request = await readMutate(req, res)
  if (request === undefined) return
  try {
    json(res, 200, await manager.apply(request))
  } catch (error) {
    json(res, 500, { ok: false, message: errorMessage(error) })
  }
}

async function handleInstall(manager: ComputerToolsManager, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    json(res, 400, { ok: false, message: errorMessage(error) })
    return
  }
  const request = parseInstallRequest(body)
  if (request === null) {
    json(res, 400, { ok: false, message: 'card must be browser or computer' })
    return
  }
  try {
    json(res, 200, { ok: true, value: await manager.install(request.card, request.desired) })
  } catch (error) {
    json(res, 500, { ok: false, message: errorMessage(error) })
  }
}

async function handleOpenPrivacy(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    json(res, 400, { ok: false, message: errorMessage(error) })
    return
  }
  const pane = parsePrivacyPane((body as { pane?: unknown } | null)?.pane)
  if (pane === null) {
    json(res, 400, { ok: false, message: 'pane must be accessibility or screen' })
    return
  }
  const url = privacyUrl(pane)
  if (process.platform !== 'darwin') {
    json(res, 200, { ok: true, value: { opened: false, url } })
    return
  }
  spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
  json(res, 200, { ok: true, value: { opened: true, url } })
}

async function readMutate(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, message: 'method not allowed' })
    return undefined
  }
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    json(res, 400, { ok: false, message: errorMessage(error) })
    return undefined
  }
  const request = parseMutateRequest(body)
  if (request === null) {
    json(res, 400, { ok: false, message: 'invalid body' })
    return undefined
  }
  return request
}

function collectLoaderRows(ctx: Context): LoaderRow[] {
  const entries = [...ctx.loader.entries()] as Entry[]
  const rows: LoaderRow[] = []
  for (const entry of entries) {
    if (entry.options.group) continue
    rows.push({
      localId: localIdOf(String(entry.id)),
      moduleName: String(entry.options.name ?? ''),
      disabled: Boolean(entry.disabled),
      fiberPhase: entry.fiber === undefined ? null : fiberPhaseOf(entry.fiber.state),
    })
  }
  return rows
}

function localIdOf(entryId: string): string {
  const sep = entryId.lastIndexOf(':')
  return sep >= 0 ? entryId.slice(sep + 1) : entryId
}

function fiberPhaseOf(state: number): FiberPhase {
  switch (state) {
    case 0: return 'pending'
    case 1: return 'loading'
    case 2: return 'active'
    case 3: return 'failed'
    case 5: return 'unloading'
    default: return null
  }
}
