import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { corsHeaders } from './cors.ts'
import { DEBUG_INGEST_HOST, DEBUG_INGEST_PORT, LOGS_PATH } from './shared.ts'

export function browserIngestUrl(port = DEBUG_INGEST_PORT): string {
  return `http://${DEBUG_INGEST_HOST}:${port}${LOGS_PATH}`
}

/**
 * A localhost ingest listener that does not move when Desktop's webServer
 * port changes. Browser probes should target this URL, not the GUI port.
 */
export function startIngestSidecar(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  onError?: (error: Error) => void,
): { url: string; close: () => void } {
  const server = createServer((req, res) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(origin))
      res.end()
      return
    }
    const path = (req.url ?? '').split('?')[0]
    if (path !== LOGS_PATH) {
      res.writeHead(404, corsHeaders(origin))
      res.end()
      return
    }
    void Promise.resolve(handler(req, res)).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, corsHeaders(origin))
        res.end()
      }
    })
  })
  server.on('error', error => {
    onError?.(error instanceof Error ? error : new Error(String(error)))
  })
  server.listen(DEBUG_INGEST_PORT, DEBUG_INGEST_HOST)
  return {
    url: browserIngestUrl(),
    close: () => {
      server.close()
    },
  }
}
