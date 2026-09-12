import type {
  ClientContext,
  SessionId,
  WorkspaceId,
} from '@just-genius/dsh-plugin-runtime/client'
import { getSessions, getUiWorkspace, getWorkspaces } from '@just-genius/dsh-plugin-runtime/client'

function asWorkspaceId(id: string): WorkspaceId {
  return id as WorkspaceId
}

function asSessionId(id: string): SessionId {
  return id as SessionId
}

export function sessionTitleOf(session: unknown, fallback: string): string {
  if (session !== null && typeof session === 'object') {
    const value = session as { title?: unknown; displayTitle?: unknown }
    if (typeof value.title === 'string' && value.title.trim() !== '') return value.title
    if (typeof value.displayTitle === 'string' && value.displayTitle.trim() !== '') return value.displayTitle
  }
  return fallback
}

export function newSession(ctx: ClientContext, workspaceId: string): void {
  const uiWorkspace = getUiWorkspace(ctx)
  if (typeof uiWorkspace.startSession !== 'function') {
    throw new Error('workspace navigation does not support starting sessions')
  }
  uiWorkspace.startSession(asWorkspaceId(workspaceId))
}

export async function openWorkspace(ctx: ClientContext, workspaceId: string): Promise<void> {
  const uiWorkspace = getUiWorkspace(ctx)
  if (typeof uiWorkspace.openWorkspace === 'function') {
    await uiWorkspace.openWorkspace(asWorkspaceId(workspaceId))
    return
  }
  newSession(ctx, workspaceId)
}

export async function archiveSession(ctx: ClientContext, sessionId: string): Promise<void> {
  const uiWorkspace = getUiWorkspace(ctx)
  if (typeof uiWorkspace.archiveSession === 'function') {
    await uiWorkspace.archiveSession(asSessionId(sessionId))
    return
  }
  await getWorkspaces(ctx).archiveSession(asSessionId(sessionId))
}

export async function forkSession(ctx: ClientContext, sessionId: string): Promise<void> {
  const uiWorkspace = getUiWorkspace(ctx)
  if (typeof uiWorkspace.forkSession === 'function') {
    await uiWorkspace.forkSession(asSessionId(sessionId))
    return
  }
  const sessions = getSessions(ctx)
  const childId = await sessions.fork({ sessionId: asSessionId(sessionId), increaseTitle: true })
  sessions.open(childId)
}

export function openSession(ctx: ClientContext, sessionId: string): void {
  const uiWorkspace = getUiWorkspace(ctx)
  if (typeof uiWorkspace.openSession === 'function') {
    uiWorkspace.openSession(asSessionId(sessionId))
    return
  }
  getSessions(ctx).open(asSessionId(sessionId))
}
