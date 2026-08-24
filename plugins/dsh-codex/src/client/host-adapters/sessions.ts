export interface CurrentSessionLocation {
  sessionId: string | undefined
  cwd: string | undefined
}

interface SessionsReadFace {
  list: {
    getSnapshot(): {
      current?: string
      byId: Record<string, { cwd?: string }>
    }
  }
  binding?(sessionId: string): {
    session: { loadOlder(): Promise<void> }
  } | undefined
  scope?(sessionId: string): ClientContext | undefined
}

function sessionsReadFace(sessions: unknown): SessionsReadFace {
  return sessions as SessionsReadFace
}

/** Read the current session identity and cwd from the public sessions face. */
export function currentSessionLocation(sessions: unknown): CurrentSessionLocation {
  const snapshot = sessionsReadFace(sessions).list.getSnapshot()
  const sessionId = snapshot.current
  return {
    sessionId,
    cwd: sessionId === undefined ? undefined : snapshot.byId[sessionId]?.cwd,
  }
}

export function loadOlderSessionHistory(sessions: unknown, sessionId: string): Promise<void> {
  return sessionsReadFace(sessions).binding?.(sessionId)?.session.loadOlder() ?? Promise.resolve()
}

/** Resolve the session-scoped client context behind the Host's merged type seam. */
export function clientSessionScope(
  sessions: unknown,
  sessionId: string,
): ClientContext | undefined {
  return sessionsReadFace(sessions).scope?.(sessionId)
}

export function sessionCwd(
  sessionsById: unknown,
  sessionId: string,
): string | undefined {
  return (sessionsById as Record<string, { cwd?: string }> | undefined)?.[sessionId]?.cwd
}
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
