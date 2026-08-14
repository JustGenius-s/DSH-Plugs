import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { CATALOG_PATH, INSTALL_PATH } from './catalog.ts'
import { loadMergedCatalog } from './host-catalog.ts'
import { installCatalogSpec } from './install.ts'

export const name = 'dsh-plugin-marketplace'

/** Wait for the web carrier so same-origin catalog/install routes can bind. */
export const inject = ['webServer'] as const

export function apply(ctx: Context) {
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: CATALOG_PATH,
      handler: handleCatalog,
    }),
    'dsh-plugin-marketplace: catalog route',
  )
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: INSTALL_PATH,
      handler: handleInstall,
    }),
    'dsh-plugin-marketplace: install route',
  )
}

async function handleCatalog(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, 405, { ok: false, error: 'method not allowed' })
    return
  }
  try {
    const catalog = await loadMergedCatalog()
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
