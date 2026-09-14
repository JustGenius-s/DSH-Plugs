import type {
  ClientContext,
  SessionId,
  SessionSummary,
  WorkspaceId,
} from '@just-genius/dsh-plugin-runtime/client'
import { getSessions, getWorkspaces } from '@just-genius/dsh-plugin-runtime/client'
import { writeClipboard } from '@just-genius/dsh-plugin-ui'
import { OPEN_PATH, type WorkspaceView } from '../shared.ts'
import { postJson } from './http.ts'
export {
  archiveSession,
  forkSession,
  newSession,
  openSession,
  sessionTitleOf,
} from './session-commands.ts'

/**
 * Row ids arrive as plain strings: they are read off React fiber props and
 * localStorage, which cannot carry the platform's branded types. Every call
 * into a service casts at this boundary — the casts are localized here so the
 * rest of the plugin works in plain strings.
 */
type ClientCtx = ClientContext

function workspacesOf(ctx: ClientCtx) {
  return getWorkspaces(ctx)
}

function sessionsOf(ctx: ClientCtx) {
  return getSessions(ctx)
}

function asWorkspaceId(id: string): WorkspaceId {
  return id as WorkspaceId
}

function asSessionId(id: string): SessionId {
  return id as SessionId
}

export function findWorkspace(ctx: ClientCtx, id: string): WorkspaceView | undefined {
  return workspacesOf(ctx).list.getSnapshot().items
    .find((item: WorkspaceView) => String(item.workspaceId) === id)
}

export function findSession(ctx: ClientCtx, id: string): SessionSummary | undefined {
  return sessionsOf(ctx).list.getSnapshot().byId[asSessionId(id)]
}

export function workspaceIdForSession(ctx: ClientCtx, sessionId: string): string | undefined {
  const found = workspacesOf(ctx).list.getSnapshot().items
    .find((item: WorkspaceView) => item.sessionIds.some((id) => String(id) === sessionId))
  return found === undefined ? undefined : String(found.workspaceId)
}

/** Ask the host to reveal `path` in the OS file manager. */
export async function openInExplorer(path: string): Promise<void> {
  await postJson(OPEN_PATH, { path })
}

export async function copyText(text: string): Promise<boolean> {
  return await writeClipboard(text)
}

export async function renameWorkspace(ctx: ClientCtx, id: string, title: string): Promise<void> {
  await workspacesOf(ctx).rename(asWorkspaceId(id), title)
}

export async function renameSession(ctx: ClientCtx, id: string, title: string): Promise<void> {
  const session = sessionsOf(ctx).binding(asSessionId(id))?.session
  if (session === undefined) throw new Error('session not loaded')
  const result = await session.rename(title)
  if (!result.ok) throw new Error(result.error?.message ?? 'rename failed')
}

/** Remove the workspace from the DSH list. Disk contents and records stay. */
export async function removeWorkspace(ctx: ClientCtx, workspaceId: string): Promise<void> {
  await workspacesOf(ctx).delete(asWorkspaceId(workspaceId))
}

/**
 * Refresh after a structural change.
 *
 * `sessions.refresh` is absent on some supported faces, so it is called only
 * when present and a failure never surfaces to the user.
 */
export function refreshSessions(ctx: ClientCtx): void {
  const sessions = sessionsOf(ctx) as { refresh?: () => Promise<unknown> }
  void sessions.refresh?.().catch(() => undefined)
}
