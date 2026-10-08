import {
  ACTIVITY_PATH, CLOSE_PATH, FOCUS_PATH, FRAME_PATH, STREAM_PATH, UNWATCH_PATH, WATCH_PATH, WINDOWS_PATH,
} from '../shared/routes.ts'
import type { ActivityResponse, FrameResponse, WindowsResponse, WatchTarget } from '../shared/types.ts'
import { startFrameFeed, type FrameFeed, type FrameFeedOptions } from './frame-feed.ts'

async function responseJson<T>(res: Response): Promise<T> {
  const body = await res.json()
  if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : `PiP request failed (${res.status})`)
  return body as T
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(10_000)
  return responseJson<T>(await fetch(path, {
    cache: 'no-store',
    signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
  }))
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  return responseJson<T>(await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  }))
}

export const api = {
  windows: () => getJson<WindowsResponse>(WINDOWS_PATH),
  watch: (sessionId: string, pid: number, windowId: number) =>
    postJson<{ ok: boolean }>(WATCH_PATH, { sessionId, pid, windowId }),
  close: (sessionId: string, openedAt?: number) =>
    postJson<{ ok: boolean; status?: { open: boolean } }>(CLOSE_PATH, { sessionId, openedAt }),
  unwatch: (sessionId: string) => postJson<{ ok: boolean }>(UNWATCH_PATH, { sessionId }),
  frame: (sessionId: string, signal?: AbortSignal) =>
    getJson<FrameResponse>(`${FRAME_PATH}?session=${encodeURIComponent(sessionId)}`, signal),
  focus: (sessionId: string, target?: WatchTarget) =>
    postJson<{ ok: boolean }>(FOCUS_PATH, { sessionId, ...target }),
  activity: () => getJson<ActivityResponse>(ACTIVITY_PATH),
}

export function subscribeFrames(
  sessionId: string,
  callbacks: Pick<FrameFeedOptions, 'onFrame' | 'onConnection'>,
): FrameFeed {
  return startFrameFeed(sessionId, {
    ...callbacks,
    connect: typeof EventSource === 'undefined'
      ? undefined
      : () => new EventSource(`${STREAM_PATH}?session=${encodeURIComponent(sessionId)}`),
    read: api.frame,
  })
}
