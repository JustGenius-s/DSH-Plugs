/**
 * Navigation and title helpers shared by the pinned area.
 *
 * Every call goes through DSH's own `uiWorkspace` service, so the plugin never
 * re-implements blank-session reuse, fork semantics, or title projection. Ids
 * arrive as plain strings from DOM attributes and slot owner props; the casts
 * are localized here.
 */

import type { ClientContext, SessionId, WorkspaceId } from '@just-genius/dsh-plugin-runtime/client'
import { getUiWorkspace } from '@just-genius/dsh-plugin-runtime/client'

function asWorkspaceId(id: string): WorkspaceId {
  return id as WorkspaceId
}

function asSessionId(id: string): SessionId {
  return id as SessionId
}

/**
 * The session's human-facing label.
 *
 * `displayTitle` is the projected label the official sidebar shows (durable
 * title, else project basename, else id), so reading it keeps this plugin's rows
 * word-for-word consistent with the row the user clicked.
 */
export function sessionTitleOf(session: unknown, fallback: string): string {
  if (session !== null && typeof session === 'object') {
    const value = session as { title?: unknown; displayTitle?: unknown }
    if (typeof value.title === 'string' && value.title.trim() !== '') return value.title
    if (typeof value.displayTitle === 'string' && value.displayTitle.trim() !== '') return value.displayTitle
  }
  return fallback
}

/** Open a session, letting the host own selection and history loading. */
export function openSession(ctx: ClientContext, sessionId: string): void {
  const uiWorkspace = getUiWorkspace(ctx)
  if (typeof uiWorkspace.openSession !== 'function') throw new Error('workspace navigation cannot open sessions')
  uiWorkspace.openSession(asSessionId(sessionId))
}

/**
 * Open a workspace: connect it and open its session, reusing or creating its
 * blank session exactly as the official sidebar's own "new session" does.
 */
export async function openWorkspace(ctx: ClientContext, workspaceId: string): Promise<void> {
  const uiWorkspace = getUiWorkspace(ctx)
  if (typeof uiWorkspace.openWorkspace !== 'function') throw new Error('workspace navigation cannot open workspaces')
  await uiWorkspace.openWorkspace(asWorkspaceId(workspaceId))
}
