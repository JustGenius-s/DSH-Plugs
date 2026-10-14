/**
 * The actions behind both additive surfaces.
 *
 * Row ids arrive here as plain strings (read from `data-row-key` and from the
 * official slot's owner props, neither of which carries the platform's branded
 * types), so the casts into the services are localized to this module and the
 * rest of the plugin stays in plain strings.
 *
 * Nothing in here writes an ORDER. Project pins are the plugin's own list;
 * session pins are DSH's registry. Neither reorders the official browser.
 */

import type {
  ClientContext,
  SessionId,
  SessionSummary,
  WorkspaceId,
} from '@just-genius/dsh-plugin-runtime/client'
import { getSessions, getUiWorkspace, getWorkspaces } from '@just-genius/dsh-plugin-runtime/client'
import { writeClipboard } from '@just-genius/dsh-plugin-ui'

import { OPEN_PATH, type WorkspaceView } from '../shared.ts'
import { postJson } from './http.ts'

// Pin, rename, fork and archive are DSH's own rows now, so this module carries
// only the actions the plugin ADDS. Session navigation lives in
// `session-commands.ts`.
export { openSession, openWorkspace, sessionTitleOf } from './session-commands.ts'

function asWorkspaceId(id: string): WorkspaceId {
  return id as WorkspaceId
}

function asSessionId(id: string): SessionId {
  return id as SessionId
}

export function findWorkspace(ctx: ClientContext, id: string): WorkspaceView | undefined {
  return getWorkspaces(ctx).list.getSnapshot().items.find((item) => String(item.workspaceId) === id)
}

export function findSession(ctx: ClientContext, id: string): SessionSummary | undefined {
  const summary = getSessions(ctx).list.getSnapshot().byId[asSessionId(id)]
  return summary === undefined ? undefined : summary
}

/** Ask the Host to reveal `path` in the OS file manager. */
export async function openInExplorer(path: string): Promise<void> {
  await postJson(OPEN_PATH, { path })
}

export async function copyText(text: string): Promise<boolean> {
  return await writeClipboard(text)
}

/** Rename a workspace through the official controller (same call the Host UI makes). */
export async function renameWorkspace(ctx: ClientContext, id: string, title: string): Promise<void> {
  await getWorkspaces(ctx).rename(asWorkspaceId(id), title)
}

/** Remove the workspace registration. Its directory and session logs stay. */
export async function removeWorkspace(ctx: ClientContext, id: string): Promise<void> {
  await getWorkspaces(ctx).delete(asWorkspaceId(id))
}

/** Pin or unpin a session in DSH's own registry — the write the official row button makes. */
export async function pinSession(ctx: ClientContext, sessionId: string, pinned: boolean): Promise<void> {
  const workspaces = getWorkspaces(ctx)
  if (pinned) await workspaces.pinSession(asSessionId(sessionId))
  else await workspaces.unpinSession(asSessionId(sessionId))
}

/** Open a folder picker owned by the OS backend, for the binding dialog. */
export function pickDirectory(ctx: ClientContext): Promise<string | null> {
  return getUiWorkspace(ctx).pickDirectory()
}

/** A session's working directory, when the Host has projected one. */
export function cwdOf(ctx: ClientContext, sessionId: string): string | undefined {
  return findSession(ctx, sessionId)?.cwd
}
