// Transport lifecycle without React or DOM state. Watching belongs to the host:
// every operation here reads an existing watch and never starts another one.

import type { FrameResponse } from '../shared/types.ts'

export type FrameFeedConnection = 'connecting' | 'connected' | 'reconnecting' | 'closed'

export interface FrameStreamEvent {
  readonly type: string
  readonly data?: unknown
}

export interface FrameEventSource {
  readonly readyState: number
  addEventListener(type: string, listener: (event: FrameStreamEvent) => void): void
  removeEventListener(type: string, listener: (event: FrameStreamEvent) => void): void
  close(): void
}

export interface FrameFeedOptions {
  /** Omit when streaming is unsupported. EventSource owns transient reconnects. */
  connect?: () => FrameEventSource
  read: (sessionId: string, signal: AbortSignal) => Promise<FrameResponse>
  onFrame: (response: FrameResponse) => void
  onConnection: (connection: FrameFeedConnection) => void
  pollIntervalMs?: number
  retryIntervalMs?: number
}

export interface FrameFeed {
  close(): void
}

function isFrameResponse(value: unknown): value is FrameResponse {
  if (value === null || typeof value !== 'object') return false
  const body = value as Partial<FrameResponse>
  if (typeof body.ok !== 'boolean' || typeof body.watching !== 'boolean') return false
  if (!body.watching) return true
  const state = body.state
  return state !== undefined && state !== null &&
    typeof state.sessionId === 'string' &&
    typeof state.updatedAt === 'number' && Number.isFinite(state.updatedAt) &&
    state.target !== undefined && state.target !== null &&
    typeof state.target.pid === 'number' && typeof state.target.windowId === 'number' &&
    (state.frame === null || (
      typeof state.frame === 'object' &&
      typeof state.frame.base64 === 'string' && typeof state.frame.mime === 'string' &&
      typeof state.frame.width === 'number' && typeof state.frame.height === 'number' &&
      typeof state.frame.appName === 'string' && typeof state.frame.windowTitle === 'string'
    ))
}

export function startFrameFeed(sessionId: string, options: FrameFeedOptions): FrameFeed {
  let alive = true
  let polling = false
  let source: FrameEventSource | undefined
  let request: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let connection: FrameFeedConnection | undefined
  const pollIntervalMs = options.pollIntervalMs ?? 250
  const retryIntervalMs = options.retryIntervalMs ?? 1000

  const setConnection = (next: FrameFeedConnection): void => {
    if (!alive || connection === next) return
    connection = next
    options.onConnection(next)
  }

  const detachSource = (): void => {
    const previous = source
    source = undefined
    if (previous === undefined) return
    previous.removeEventListener('open', onOpen)
    previous.removeEventListener('error', onError)
    previous.removeEventListener('frame', onFrame)
    previous.close()
  }

  const close = (): void => {
    if (!alive) return
    alive = false
    clearTimeout(timer)
    request?.abort()
    request = undefined
    detachSource()
  }

  const receive = (body: FrameResponse): void => {
    if (!alive || !body.ok || (body.watching && body.state?.sessionId !== sessionId)) return
    setConnection(body.watching ? 'connected' : 'closed')
    options.onFrame(body)
    // A terminal host event must not reconnect, poll, or resurrect the preview.
    if (!body.watching) close()
  }

  const pull = async (): Promise<void> => {
    if (!alive || !polling || request !== undefined) return
    const current = new AbortController()
    request = current
    let delay = pollIntervalMs
    try {
      const body = await options.read(sessionId, current.signal)
      if (!alive || current.signal.aborted) return
      if (!isFrameResponse(body) || !body.ok) throw new Error('Invalid PiP frame response')
      receive(body)
    } catch {
      if (alive && !current.signal.aborted) {
        setConnection('reconnecting')
        delay = retryIntervalMs
      }
    } finally {
      if (request === current) request = undefined
      // Serial fallback: never overlap requests, including across a slow fetch.
      if (alive && polling) timer = setTimeout(() => void pull(), delay)
    }
  }

  const startPolling = (): void => {
    if (!alive || polling) return
    detachSource()
    polling = true
    void pull()
  }

  function onOpen(): void {
    if (source !== undefined) setConnection('connected')
  }

  function onError(): void {
    if (!alive || source === undefined) return
    setConnection('reconnecting')
    // CONNECTING (0) means native EventSource is already reconnecting. Only a
    // terminal source (2, e.g. an older host without this endpoint) falls back.
    if (source.readyState === 2) startPolling()
  }

  function onFrame(event: FrameStreamEvent): void {
    if (!alive || source === undefined || typeof event.data !== 'string') return
    try {
      const body: unknown = JSON.parse(event.data)
      if (isFrameResponse(body)) receive(body)
    } catch {
      // One malformed event must not discard the current image or open a watch.
    }
  }

  setConnection('connecting')
  if (options.connect === undefined) startPolling()
  else {
    try {
      source = options.connect()
      source.addEventListener('open', onOpen)
      source.addEventListener('error', onError)
      source.addEventListener('frame', onFrame)
      if (source.readyState === 2) startPolling()
    } catch {
      startPolling()
    }
  }
  return { close }
}
