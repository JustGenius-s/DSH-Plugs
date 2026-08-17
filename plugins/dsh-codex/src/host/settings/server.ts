import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  parseCodexPatch,
  SETTINGS_PATH,
  type DshCodexConfig,
} from '../../shared/config'

export interface DshCodexSettingsServer {
  dispose(): void
}

export function createDshCodexSettingsServer(
  ctx: Context,
  getConfig: () => DshCodexConfig,
  applyPatch: (patch: Partial<DshCodexConfig>) => Promise<DshCodexConfig>,
): DshCodexSettingsServer {
  const disposeRoute = ctx.webServer.register({
    kind: 'exact',
    path: SETTINGS_PATH,
    handler: (req, res) => handleSettings(req, res, getConfig, applyPatch),
  })
  return { dispose: disposeRoute }
}

async function handleSettings(
  req: IncomingMessage,
  res: ServerResponse,
  getConfig: () => DshCodexConfig,
  applyPatch: (patch: Partial<DshCodexConfig>) => Promise<DshCodexConfig>,
): Promise<void> {
  if (req.method === 'GET' || req.method === 'HEAD') {
    json(res, 200, { ok: true, value: getConfig() })
    return
  }
  if (req.method !== 'PATCH' && req.method !== 'POST') {
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
  const patch = parseCodexPatch(body)
  if (patch === undefined) {
    json(res, 400, { ok: false, message: 'invalid patch' })
    return
  }
  try {
    const value = await applyPatch(patch)
    json(res, 200, { ok: true, value })
  } catch (error) {
    json(res, 400, { ok: false, message: errorMessage(error) })
  }
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function readJsonBody(req: IncomingMessage, limit = 8192): Promise<unknown> {
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
