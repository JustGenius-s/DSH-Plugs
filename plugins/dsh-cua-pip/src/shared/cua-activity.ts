// Pure helpers that decide when Computer Use (Cua) is active and which
// window the PiP overlay should follow. No React, no DOM, no Node APIs.

import type { CuaActivity, CuaWindow, WatchTarget } from './types.ts'

export interface DismissedBurst {
  sessionId: string
  turn: number
}

function asPositiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isSafeInteger(n) || n <= 0) return undefined
  return n
}

function parseArgsObject(argsRaw: unknown): Record<string, unknown> | undefined {
  let value: unknown = argsRaw
  if (typeof argsRaw === 'string') {
    const trimmed = argsRaw.trim()
    if (trimmed === '') return undefined
    try {
      value = JSON.parse(trimmed)
    } catch {
      return undefined
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * True when a session tool name is a Cua Driver / Cua MCP Computer Use call.
 * Bare `computer-use` and this plugin's own name do not match.
 */
export function isCuaToolName(name: string): boolean {
  const n = name.toLowerCase()
  if (n.includes('dsh-cua-pip')) return false
  return (
    n.includes('cua-driver')
    || n.includes('cua_driver')
    || n.includes('computer-use-cua')
    || n.includes('mcp__cua-driver')
  )
}

/** pid + window_id from Cua tool args (top-level or nested `target`). */
export function extractWatchTarget(argsRaw: unknown): WatchTarget | undefined {
  const rec = parseArgsObject(argsRaw)
  if (rec === undefined) return undefined
  const from = (src: Record<string, unknown>): WatchTarget | undefined => {
    const pid = asPositiveInt(src.pid)
    const windowId = asPositiveInt(src.window_id) ?? asPositiveInt(src.windowId)
    if (pid === undefined || windowId === undefined) return undefined
    return { pid, windowId }
  }
  if (rec.target !== null && typeof rec.target === 'object' && !Array.isArray(rec.target)) {
    const nested = from(rec.target as Record<string, unknown>)
    if (nested !== undefined) return nested
  }
  return from(rec)
}

/**
 * System Screen Recording / Accessibility consent overlays. Cua can still
 * capture them (even under a stale window_id), so auto-watch must not latch.
 */
export function isHijackCapture(appName: string, title: string): boolean {
  const app = appName.toLowerCase()
  if (app.includes('universalaccess')) return true
  const trimmed = title.trim()
  if (trimmed === '录屏' || /^screen recording$/i.test(trimmed)) return true
  return false
}

/**
 * Pick a replacement window for a pid whose window_id died (window closed and
 * reopened, or the id was recycled). Prefer the largest on-screen window.
 * Consent overlays are never candidates.
 */
export function pickRebindCandidate(
  windows: readonly CuaWindow[],
  pid: number,
): CuaWindow | undefined {
  const mine = windows.filter((w) => w.pid === pid && !isHijackCapture(w.appName, w.title))
  if (mine.length === 0) return undefined
  const onScreen = mine.filter((w) => w.isOnScreen)
  const pool = onScreen.length > 0 ? onScreen : mine
  return [...pool].sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height)[0]
}

/**
 * Keep a requested (or previous) target only if it is a live, non-overlay
 * window. Stale ids rebind on the same pid; a pid that only owns the Screen
 * Recording dialog yields null so the picker stays empty.
 */
export function coalesceUsableTarget(
  windows: readonly CuaWindow[],
  requested: WatchTarget | null | undefined,
  pidOnly?: number,
): WatchTarget | null {
  if (requested !== null && requested !== undefined) {
    const exact = windows.find((w) => w.pid === requested.pid && w.windowId === requested.windowId)
    if (exact !== undefined && !isHijackCapture(exact.appName, exact.title)) {
      return { pid: exact.pid, windowId: exact.windowId }
    }
    const rebound = pickRebindCandidate(windows, requested.pid)
    if (rebound !== undefined) return { pid: rebound.pid, windowId: rebound.windowId }
  }
  if (pidOnly !== undefined) {
    const rebound = pickRebindCandidate(windows, pidOnly)
    if (rebound !== undefined) return { pid: rebound.pid, windowId: rebound.windowId }
  }
  return null
}

/** pid only — used to pick the pid's largest on-screen window. */
export function extractPid(argsRaw: unknown): number | undefined {
  const rec = parseArgsObject(argsRaw)
  if (rec === undefined) return undefined
  const top = asPositiveInt(rec.pid)
  if (top !== undefined) return top
  if (rec.target !== null && typeof rec.target === 'object' && !Array.isArray(rec.target)) {
    return asPositiveInt((rec.target as Record<string, unknown>).pid)
  }
  return undefined
}

export function readToolCall(
  event: unknown,
): { name: string; arguments: unknown; turn: number; callId?: string } | null {
  if (event === null || typeof event !== 'object') return null
  const type = (event as { type?: unknown }).type
  if (type !== 'tool/call' && type !== 'tool/code-dispatch-start') return null
  const data = (event as { data?: unknown }).data
  const rec = data !== null && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : undefined
  if (rec === undefined) return null
  const name = typeof rec.name === 'string' ? rec.name : ''
  if (name === '') return null
  const turn = typeof rec.turn === 'number' && Number.isSafeInteger(rec.turn) ? rec.turn : 0
  const id = rec.callId ?? rec.subCallId
  return { name, arguments: rec.arguments, turn, ...(typeof id === 'string' ? { callId: id } : {}) }
}

export function isTurnEnd(event: unknown): boolean {
  if (event === null || typeof event !== 'object') return false
  return (event as { type?: unknown }).type === 'turn/end'
}

/**
 * Tool events only update an explicitly opened preview. A turn ending marks
 * the agent idle, without closing its session-owned preview.
 */
export function applyCuaEvent(
  prev: CuaActivity | undefined,
  sessionId: string,
  event: unknown,
  now: number,
): CuaActivity | undefined {
  if (prev === undefined || prev.visible !== true) return prev
  const call = readToolCall(event)
  if (call !== null) {
    if (!isCuaToolName(call.name)) return prev
    return {
      ...prev,
      sessionId,
      active: true,
      tool: call.name,
      // Target resolution happens in the controller with generation checks.
      turn: call.turn || prev.turn,
      updatedAt: now,
    }
  }
  if (isTurnEnd(event)) {
    if (!prev.active) return prev
    return { ...prev, active: false, tool: null, updatedAt: now }
  }
  return prev
}

/** Prefer the current session when it is in a Cua burst; else the newest burst. */
export function pickActivity(
  sessions: readonly CuaActivity[],
  currentSessionId?: string,
): CuaActivity | undefined {
  const active = sessions.filter((row) => row.visible === true)
  if (active.length === 0) return undefined
  if (currentSessionId !== undefined && currentSessionId !== '') {
    const current = active.find((row) => row.sessionId === currentSessionId)
    if (current !== undefined) return current
  }
  return [...active].sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

/**
 * Only the conversation stream that is currently open. Another session's
 * Cua burst must not paint a card on this thread.
 */
export function pickConversationActivity(
  sessions: readonly CuaActivity[],
  currentSessionId: string | undefined,
): CuaActivity | undefined {
  if (currentSessionId === undefined || currentSessionId === '') return undefined
  return sessions.find((row) => row.sessionId === currentSessionId && row.visible === true)
}

/**
 * `dsh.sessions.current` is `{ sessionId }` or a bare id. The session list
 * snapshot itself does not carry `current` — navigation is a view-owner field.
 */
export function readPersistedCurrentSessionId(raw: string | null): string | undefined {
  if (raw === null || raw === '') return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'string' && parsed !== '') return parsed
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const id = (parsed as { sessionId?: unknown }).sessionId
      if (typeof id === 'string' && id !== '') return id
    }
  } catch {
    if (raw.startsWith('session-')) return raw
  }
  return undefined
}

/** List snapshot `current`, then persisted `dsh.sessions.current`. */
export function resolveCurrentSessionId(
  fromList: unknown,
  persistedRaw: string | null,
): string | undefined {
  if (typeof fromList === 'string' && fromList !== '') return fromList
  if (fromList !== null && typeof fromList === 'object' && !Array.isArray(fromList)) {
    const id = (fromList as { sessionId?: unknown }).sessionId
    if (typeof id === 'string' && id !== '') return id
  }
  return readPersistedCurrentSessionId(persistedRaw)
}

/**
 * Only explicit agent opens create a visible preview. A local dismissal can
 * hide it immediately while its close request is in flight.
 */
export function shouldOpenOverlay(
  activity: CuaActivity | undefined,
  dismissed: DismissedBurst | null,
): boolean {
  if (activity === undefined || activity.visible !== true) return false
  if (dismissed === null) return true
  return dismissed.sessionId !== activity.sessionId || dismissed.turn !== activity.turn
}
