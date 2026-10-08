import type { IncomingMessage, ServerResponse } from 'node:http'
import type { FrameResponse, WatcherSnapshot } from './shared/types.ts'

interface FrameSource {
  subscribe(sessionId: string, listener: (state: WatcherSnapshot | null) => void): () => void
}

export const STREAM_HEARTBEAT_MS = 15_000
export const STREAM_BACKPRESSURE_TIMEOUT_MS = 30_000

/**
 * Push each completed capture immediately. A slow socket holds at most one
 * pending update: replace it with the newest frame rather than replaying stale
 * frames after the client catches up. Subscribing never opens a preview.
 */
export function streamFrames(
  source: FrameSource,
  sessionId: string,
  req: IncomingMessage,
  res: ServerResponse,
): () => void {
  let closed = false
  let terminal = false
  let blocked = false
  let pending: FrameResponse | undefined
  let unsubscribe: (() => void) | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let blockedTimer: ReturnType<typeof setTimeout> | undefined

  const detachSource = (): void => {
    const detach = unsubscribe
    unsubscribe = undefined
    detach?.()
  }
  const cleanup = (): void => {
    if (closed) return
    closed = true
    pending = undefined
    clearInterval(heartbeat)
    clearTimeout(blockedTimer)
    detachSource()
    req.off('aborted', close)
    res.off('close', cleanup)
    res.off('error', close)
    res.off('drain', flush)
  }
  const close = (): void => {
    cleanup()
    if (!res.destroyed && !res.writableEnded) res.end()
  }
  const markBlocked = (): void => {
    blocked = true
    clearTimeout(blockedTimer)
    blockedTimer = setTimeout(() => {
      cleanup()
      res.destroy()
    }, STREAM_BACKPRESSURE_TIMEOUT_MS)
    blockedTimer.unref?.()
  }
  const write = (body: FrameResponse): void => {
    if (closed) return
    try {
      const accepted = res.write(`event: frame\ndata: ${JSON.stringify(body)}\n\n`)
      if (!body.watching) {
        close()
        return
      }
      if (!accepted) markBlocked()
    } catch {
      close()
    }
  }
  function flush(): void {
    if (closed) return
    blocked = false
    clearTimeout(blockedTimer)
    const latest = pending
    pending = undefined
    if (latest !== undefined) write(latest)
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  res.flushHeaders?.()
  req.on('aborted', close)
  res.on('close', cleanup)
  res.on('error', close)
  res.on('drain', flush)
  unsubscribe = source.subscribe(sessionId, (state) => {
    if (closed || terminal) return
    if (state === null) {
      // Closure is a boundary, not another replaceable frame. A later explicit
      // open must use a new stream even if this socket has not drained yet.
      terminal = true
      detachSource()
    }
    const body: FrameResponse = state === null
      ? { ok: true, watching: false }
      : { ok: true, watching: true, state }
    if (blocked) pending = body
    else write(body)
  })
  // A subscription can synchronously emit null for an already closed PiP.
  if (terminal) detachSource()
  if (closed) {
    detachSource()
    return close
  }
  heartbeat = setInterval(() => {
    if (closed || blocked) return
    try {
      if (!res.write(': keepalive\n\n')) markBlocked()
    } catch { close() }
  }, STREAM_HEARTBEAT_MS)
  heartbeat.unref?.()
  return close
}
