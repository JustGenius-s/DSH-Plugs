/**
 * Thin typed client for the dsh-codex side-chat host routes. Same-origin
 * fetch (the GUI and the host webServer share one origin).
 */

import {
  SIDE_CHAT_CLOSE_PATH,
  SIDE_CHAT_LIST_PATH,
  SIDE_CHAT_OPEN_PATH,
  SIDE_CHAT_DISABLED_REASON,
  type SideChatContextState,
  type SideChatOpenResult,
  type SideChatSummary,
} from '../../../shared/side-chat'

export type { SideChatSummary }

/**
 * Side chat is switched off in the settings.
 *
 * The Host answers `409 { disabled: true, reason }` instead of a plain error,
 * and this carries that fact as a type so the panel can render a translated
 * "switched off" state rather than an error bar with a stack — a feature the
 * user turned off is not a failure.
 */
export class SideChatDisabledError extends Error {
  constructor(readonly reason: string = SIDE_CHAT_DISABLED_REASON) {
    super(reason)
    this.name = 'SideChatDisabledError'
  }
}

/**
 * Structured request failure surfaced to the panel.
 *
 * Carries the Host's own stack when it sent one: a server-side throw is
 * otherwise unlocatable from the browser, and the message alone does not say
 * which call in the route handler failed.
 */
export class SideChatApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The Host-reported stack, verbatim, when the response carried one. */
    readonly hostStack?: string,
  ) {
    super(message)
    this.name = 'SideChatApiError'
    // Keep the Host stack reachable from the client stack too, so a report
    // pasted from the panel shows both sides of the boundary.
    if (hostStack !== undefined && hostStack !== '') {
      this.stack = `${this.stack ?? ''}\n--- host ---\n${hostStack}`
    }
  }
}

/** Pull the Host-reported stack out of one error payload, if present. */
export function hostStackOf(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== 'object') return undefined
  const stack = (payload as { stack?: unknown }).stack
  return typeof stack === 'string' && stack !== '' ? stack : undefined
}

/**
 * Whether one open-response payload is the "feature switched off" answer.
 *
 * Keyed off `disabled`, never off the status code alone: 409 is a shape the
 * Host can also reach for unrelated conflicts, and the panel must not mistake
 * one of those for the user's own switch.
 */
export function isDisabledPayload(payload: unknown, status: number): boolean {
  if (status !== 409) return false
  return typeof payload === 'object' && payload !== null
    && (payload as { disabled?: unknown }).disabled === true
}

async function request(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
    cache: 'no-store',
  })
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new SideChatApiError(response.status, `unexpected response from ${path}`)
  }
  if (!response.ok) {
    // A switched-off feature is reported as a state, not a failure: it carries
    // no `error` and no stack, so surfacing it through the error bar would show
    // an empty message with an empty stack instead of "侧聊已关闭".
    if (isDisabledPayload(payload, response.status)) {
      throw new SideChatDisabledError()
    }
    const message = (payload as { error?: unknown })?.error
    throw new SideChatApiError(
      response.status,
      typeof message === 'string' ? message : `request to ${path} failed`,
      hostStackOf(payload),
    )
  }
  return payload
}

/** The plugin's host API surface. */
export const sideChatApi = {
  /**
   * Open a side chat for a parent session.
   *
   * Resolves the new session id plus whether the parent's context came along —
   * the injected context is not visible in the transcript until the first turn,
   * so this is the only place the outcome is observable up front.
   */
  open(parentSessionId: string): Promise<SideChatOpenResult> {
    return request(SIDE_CHAT_OPEN_PATH, {
      method: 'POST',
      body: JSON.stringify({ parentSessionId }),
    }).then((payload: { sideSessionId?: unknown; context?: unknown }) => {
      if (typeof payload.sideSessionId !== 'string') {
        throw new SideChatApiError(500, 'open response missing sideSessionId')
      }
      // `context` is absent on a host built before context inheritance, and
      // 'off' only exists on a host that knows the setting — both collapse to
      // 'none' rather than letting an older host make the panel claim more
      // than it was told.
      const context: SideChatContextState =
        payload.context === 'inherited' ? 'inherited'
          : payload.context === 'off' ? 'off'
            : 'none'
      return { sideSessionId: payload.sideSessionId, context }
    })
  },

  /** List a parent session's side chats, newest first. */
  list(parentSessionId: string): Promise<SideChatSummary[]> {
    return request(`${SIDE_CHAT_LIST_PATH}?parentSessionId=${encodeURIComponent(parentSessionId)}`)
      .then((payload: { sideChats?: unknown }) => {
        const rows = payload.sideChats
        if (!Array.isArray(rows)) {
          throw new SideChatApiError(500, 'list response missing sideChats')
        }
        return rows as SideChatSummary[]
      })
  },

  /** Close (dispose) a side chat. */
  close(sideSessionId: string): Promise<void> {
    return request(SIDE_CHAT_CLOSE_PATH, {
      method: 'POST',
      body: JSON.stringify({ sideSessionId }),
    }).then(() => undefined)
  },
}
