import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { runAction } from './actions.ts'
import { collectInventory } from './inventory.ts'
import { ACTION_PATH, INVENTORY_PATH, type ActionRequest } from './types.ts'

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

function json(res: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readJsonBody(req: IncomingMessage, limit = 16384): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}
