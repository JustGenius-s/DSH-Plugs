import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { runAction } from './actions.ts'
import { collectInventory } from './inventory.ts'
import { json, readJsonBody } from './http.ts'
import { CATALOG_PATH, INSTALL_PATH } from './market/types.ts'
import { loadMarketplaceCatalog } from './market/host-catalog.ts'
import { installCatalogSpec } from './market/install.ts'
import { collectOutdated, updateNpmPackage } from './updates.ts'
import {
  ACTION_PATH,
  INVENTORY_PATH,
  OUTDATED_PATH,
  UPDATE_PATH,
  type ActionRequest,
} from './types.ts'

export const name = 'dsh-plugin-config'

export const inject = ['webServer', 'loader'] as const

export function apply(ctx: Context) {
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: INVENTORY_PATH,
      handler: (req, res) => handleInventory(ctx, req, res),
    }),
    'dsh-plugin-config: inventory route',
  )
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: ACTION_PATH,
      handler: (req, res) => handleAction(ctx, req, res),
    }),
    'dsh-plugin-config: action route',
  )
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: CATALOG_PATH,
      handler: handleCatalog,
    }),
    'dsh-plugin-config: catalog route',
  )
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: INSTALL_PATH,
      handler: handleInstall,
    }),
    'dsh-plugin-config: install route',
  )
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: OUTDATED_PATH,
      handler: handleOutdated,
    }),
    'dsh-plugin-config: outdated route',
  )
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: UPDATE_PATH,
      handler: handleUpdate,
    }),
    'dsh-plugin-config: update route',
  )
}

function handleInventory(ctx: Context, req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, 405, { ok: false, error: 'method not allowed' })
    return
  }
  try {
    json(res, 200, collectInventory(ctx))
  } catch (error) {
    json(res, 500, { ok: false, error: 'inventory unavailable', detail: String(error) })
  }
}

async function handleAction(ctx: Context, req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'method not allowed' })
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    json(res, 400, { ok: false, error: String(error) })
    return
  }
  const request = parseAction(body)
  if (!request) {
    json(res, 400, { ok: false, error: 'action, and entryId or packageName, are required.' })
    return
  }
  const result = await runAction(ctx, request)
  json(res, result.ok ? 200 : 400, result)
}

async function handleCatalog(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, 405, { ok: false, error: 'method not allowed' })
    return
  }
  try {
    const catalog = await loadMarketplaceCatalog()
    json(res, 200, catalog)
  } catch (error) {
    json(res, 502, { ok: false, error: 'catalog unavailable', detail: String(error) })
  }
}

async function handleInstall(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'method not allowed' })
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    json(res, 400, { ok: false, error: String(error) })
    return
  }
  const spec = body !== null && typeof body === 'object' && 'spec' in body
    ? String((body as { spec: unknown }).spec ?? '')
    : ''
  const result = await installCatalogSpec(spec)
  json(res, result.ok ? 200 : 400, result)
}

async function handleOutdated(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, 405, { ok: false, error: 'method not allowed' })
    return
  }
  try {
    json(res, 200, await collectOutdated())
  } catch (error) {
    json(res, 502, { ok: false, error: 'outdated check failed', detail: String(error) })
  }
}

async function handleUpdate(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'method not allowed' })
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    json(res, 400, { ok: false, error: String(error) })
    return
  }
  const packageName = body !== null && typeof body === 'object' && 'packageName' in body
    ? String((body as { packageName: unknown }).packageName ?? '')
    : ''
  const result = await updateNpmPackage(packageName)
  json(res, result.ok ? 200 : 400, result)
}

function parseAction(body: unknown): ActionRequest | null {
  if (body === null || typeof body !== 'object') return null
  const value = body as { action?: unknown; entryId?: unknown; packageName?: unknown }
  const action = value.action
  if (action !== 'disable' && action !== 'enable' && action !== 'uninstall') return null
  const entryId = typeof value.entryId === 'string' ? value.entryId : undefined
  const packageName = typeof value.packageName === 'string' ? value.packageName : undefined
  if (!entryId && !packageName) return null
  return { action, entryId, packageName }
}
