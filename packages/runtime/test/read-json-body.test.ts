/**
 * Oversized request bodies must not poison the keep-alive socket.
 *
 * `readJsonBody` used to `throw` from inside `for await (const chunk of req)`.
 * Leaving an `IncomingMessage`'s async iterator early destroys the socket
 * while the client is still sending: the unread remainder sits in the receive
 * buffer, so the next reply written on that connection arrives truncated and
 * Node's parser aborts it with `ERR_CONNECTION_RESET`. The browser reports that
 * as `Failed to fetch` against whatever unrelated request reused the socket —
 * which is how this surfaced, as every API failing after the session-map
 * plugin pushed a ~134 KB sync past its 32 KB limit.
 *
 * The size matters. Under roughly one socket receive buffer (~128 KB) the
 * kernel absorbs the rest of the body and the socket survives, so a small
 * fixture proves nothing: these cases use bodies well past that threshold.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Agent, createServer, request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readJsonBody } from '../src/host.ts'

const LIMIT = 32 * 1024

type Harness = {
  send: (path: string, body?: string) => Promise<{ status: number; body: string }>
  sockets: Set<unknown>
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function withServer(run: (h: Harness) => Promise<void>): Promise<void> {
  const sockets = new Set<unknown>()
  const server = createServer((req, res) => {
    sockets.add(req.socket)
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
      return
    }
    void readJsonBody(req, LIMIT).then(
      () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"ok":true}')
      },
      (error: { status?: number; message: string }) => {
        res.writeHead(error.status ?? 400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: error.message }))
      },
    )
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const agent = new Agent({ keepAlive: true, maxSockets: 1 })
  const send = (path: string, body?: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: (server.address() as AddressInfo).port,
        path,
        method: body === undefined ? 'GET' : 'POST',
        agent,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('error', reject)
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }))
      },
    )
    req.on('error', reject)
    req.setTimeout(2000, () => req.destroy(new Error('connection stalled after a rejected body')))
    if (body !== undefined) req.write(body)
    req.end()
  })
  cleanups.push(async () => {
    agent.destroy()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  await run({ send, sockets })
}

describe('readJsonBody', () => {
  it('refuses an oversized body and leaves the shared connection usable', async () => {
    await withServer(async ({ send, sockets }) => {
      const rejected = await send('/plugin', JSON.stringify({ sessions: [], padding: 'x'.repeat(256 * 1024) }))
      expect(rejected.status).toBe(413)
      expect(JSON.parse(rejected.body).error).toBe('body too large')
      // The next request reuses the same socket; it must not stall or truncate.
      expect(await send('/health')).toEqual({ status: 200, body: 'ok' })
      expect(sockets.size).toBe(1)
    })
  })

  it('refuses a 4 MB body without stalling the next request', async () => {
    await withServer(async ({ send }) => {
      const rejected = await send('/plugin', JSON.stringify({ padding: 'x'.repeat(4 * 1024 * 1024) }))
      expect(rejected.status).toBe(413)
      expect(await send('/health')).toEqual({ status: 200, body: 'ok' })
    })
  })

  it('still parses a body at the limit', async () => {
    await withServer(async ({ send }) => {
      const accepted = await send('/plugin', JSON.stringify({ padding: 'x'.repeat(LIMIT - 400) }))
      expect(accepted.status).toBe(200)
      expect(JSON.parse(accepted.body).ok).toBe(true)
      expect(await send('/health')).toEqual({ status: 200, body: 'ok' })
    })
  })

  it('refuses malformed JSON without closing a reusable connection', async () => {
    await withServer(async ({ send, sockets }) => {
      const rejected = await send('/plugin', '{"sessions":')
      expect(rejected.status).toBe(400)
      expect(await send('/health')).toEqual({ status: 200, body: 'ok' })
      expect(sockets.size).toBe(1)
    })
  })
})
