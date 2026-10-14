/**
 * The row action sets, in ONE place.
 *
 * Three surfaces show these actions and they must not drift:
 *
 *   1. the official Project row's `...` menu, which DSH owns and this plugin
 *      only APPENDS to (`WorkspaceMenuRows.tsx`);
 *   2. the pinned area's own Project row menu;
 *   3. the pinned area's own Session row menu, whose additions the official
 *      Session menu also takes (via `SessionMenuExtra.tsx`).
 *
 * Both surfaces route their selections through the executors here, so a pinned row
 * and the row inside a workspace group do the same thing. WHICH rows they list is
 * `row-menu.ts`'s business; this module only performs an id.
 *
 * A test imports this module's pure sibling rather than this one: executing an
 * action reaches the UI layer, which pulls in stylesheets Node cannot load.
 */

import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import {
  formatSessionReferenceMention,
  getSessions,
  getUiWorkspace,
  getWorkspaces,
} from '@just-genius/dsh-plugin-runtime/client'
import { writeClipboard } from '@just-genius/dsh-plugin-ui'

import { findWorkspace, openInExplorer, pinSession, removeWorkspace, renameWorkspace } from './actions.ts'
import { classifyArchiveOutcome } from './archive-confirm.ts'
import { canDrop, moveBeside, successorAfter, type DragSource, type DropTarget } from './pinned-order.ts'
import type { ActivityEntry } from './archive-confirm.ts'
import type { WorkspacePlusKey } from './locales.ts'

// The row INVENTORY lives in `row-menu.ts` (pure data, testable in Node); this
// module only EXECUTES an id. Re-exported so callers keep one import site.
export {
  PLUGIN_PROJECT_ACTIONS,
  PLUGIN_SESSION_ACTIONS,
  OFFICIAL_PROJECT_ACTIONS,
  OFFICIAL_SESSION_ACTIONS,
  pluginProjectRows,
  projectMenuActions,
  sessionMenuActions,
  type RowAction,
} from './row-menu.ts'

/** How a row reaches the rest of the plugin. */
export interface ActionDeps {
  ctx: ClientContext
  toast: (key: WorkspacePlusKey) => void
  /** Project pin state (the plugin's own store) and its writer. */
  isProjectPinned: (workspaceId: string) => boolean
  setProjectPin: (workspaceId: string, pinned: boolean) => Promise<void>
  /** Opens the plugin's rename dialog. */
  requestRename: (target: RenameTarget) => void
  /** Opens the plugin's multi-folder binding dialog. */
  requestBinding: (workspaceId: string) => void
  /** Opens the plugin's delete confirmation. Resolves true when confirmed. */
  confirmRemove: (workspaceId: string, title: string) => Promise<boolean>
  /**
   * Confirms stopping a session's running work so it can be archived. Resolves
   * true when the user accepts.
   */
  confirmArchive: (sessionId: string, title: string, activity: readonly ActivityEntry[]) => Promise<boolean>
  /** Markdown export, and whether one is already running. */
  isExporting: (sessionId: string) => boolean
  exportSession: (sessionId: string) => void
}

export interface RenameTarget {
  kind: 'workspace' | 'session'
  id: string
  title: string
}

/**
 * Run one Project row action.
 *
 * Unknown ids are IGNORED rather than throwing: the id set is assembled from two
 * lists, and a future official row arriving here must not break the row.
 */
export async function runProjectAction(
  deps: ActionDeps,
  workspaceId: string,
  actionId: string,
): Promise<void> {
  const { ctx } = deps
  const workspace = findWorkspace(ctx, workspaceId)
  try {
    switch (actionId) {
      case 'pin': {
        const pinned = !deps.isProjectPinned(workspaceId)
        await deps.setProjectPin(workspaceId, pinned)
        deps.toast(pinned ? 'toast.pinned' : 'toast.unpinned')
        return
      }
      case 'rename': {
        if (workspace === undefined) return
        deps.requestRename({ kind: 'workspace', id: workspaceId, title: workspace.title })
        return
      }
      case 'delete': {
        if (workspace === undefined) return
        // Deleting a workspace registration is destructive and not undoable from
        // the UI, so it goes through a confirmation rather than one click.
        if (!await deps.confirmRemove(workspaceId, workspace.title)) return
        await removeWorkspace(ctx, workspaceId)
        deps.toast('toast.removed')
        return
      }
      case 'editBinding': {
        deps.requestBinding(workspaceId)
        return
      }
      case 'openExplorer': {
        if (workspace === undefined) return
        await openInExplorer(workspace.path)
        return
      }
      case 'copyPath': {
        if (workspace === undefined) return
        const copied = await writeClipboard(workspace.path)
        deps.toast(copied ? 'toast.pathCopied' : 'toast.copyFailed')
        return
      }
      case 'newSession': {
        const uiWorkspace = getUiWorkspace(ctx)
        if (typeof uiWorkspace.startSession !== 'function') return
        uiWorkspace.startSession(workspaceId as never)
        return
      }
      default:
        return
    }
  } catch (error) {
    console.warn('[dsh-workspace-plus] project action failed', error)
    deps.toast('toast.failed')
  }
}

/**
 * Copy a session's reference to the clipboard.
 *
 * Exported separately because TWO callers need it and they reach it from
 * different directions: the panel goes through `runSessionAction`, while the
 * official Session menu's injected rows call it directly (that registration has
 * only `ctx`, no `ActionDeps`). Sharing the body is what keeps the two from
 * producing different text for the same row.
 *
 * The mention's label is the row's title, so what lands on the clipboard reads
 * as the session it points at; the host resolves the id from the URI.
 */
export async function copySessionReference(ctx: ClientContext, sessionId: string): Promise<boolean> {
  const summary = getSessions(ctx).list.getSnapshot().byId[sessionId as never]
  return writeClipboard(formatSessionReferenceMention({
    sessionId,
    ...(summary?.displayTitle === undefined ? {} : { label: summary.displayTitle }),
  }))
}

/** Run one Session row action. */
export async function runSessionAction(
  deps: ActionDeps,
  sessionId: string,
  actionId: string,
): Promise<void> {
  const { ctx } = deps
  try {
    switch (actionId) {
      case 'unpinSession': {
        await pinSession(ctx, sessionId, false)
        deps.toast('toast.unpinned')
        return
      }
      case 'pinSession': {
        await pinSession(ctx, sessionId, true)
        deps.toast('toast.pinned')
        return
      }
      case 'copyReference': {
        const copied = await copySessionReference(ctx, sessionId)
        deps.toast(copied ? 'toast.referenceCopied' : 'toast.copyFailed')
        return
      }
      case 'renameSession': {
        const summary = getSessions(ctx).list.getSnapshot().byId[sessionId as never]
        if (summary === undefined) return
        deps.requestRename({ kind: 'session', id: sessionId, title: summary.displayTitle })
        return
      }
      case 'archive': {
        const uiWorkspace = getUiWorkspace(ctx)
        if (typeof uiWorkspace.archiveSession !== 'function') return
        // The Host refuses to archive a session with work still running, and
        // stopping that work is NOT undoable — a killed turn does not resume. So
        // the refusal becomes a question rather than being silently overridden.
        // Mirrors the official sidebar, which asks through the same refusal.
        try {
          await uiWorkspace.archiveSession(sessionId as never)
          deps.toast('toast.archived')
          return
        } catch (reason) {
          const outcome = classifyArchiveOutcome(reason)
          if (outcome.kind !== 'active') throw reason
          const title = getSessions(ctx).list.getSnapshot().byId[sessionId as never]?.displayTitle ?? sessionId
          if (!await deps.confirmArchive(sessionId, title, outcome.activity)) return
          await uiWorkspace.archiveSession(sessionId as never, { stopActivity: true })
          deps.toast('toast.archived')
          return
        }
      }
      case 'forkSession': {
        const uiWorkspace = getUiWorkspace(ctx)
        if (typeof uiWorkspace.forkSession !== 'function') return
        await uiWorkspace.forkSession(sessionId as never)
        return
      }
      case 'export': {
        if (deps.isExporting(sessionId)) return
        deps.exportSession(sessionId)
        return
      }
      case 'openFolder': {
        const summary = getSessions(ctx).list.getSnapshot().byId[sessionId as never]
        if (summary?.cwd === undefined) return
        await openInExplorer(summary.cwd)
        return
      }
      default:
        return
    }
  } catch (error) {
    console.warn('[dsh-workspace-plus] session action failed', error)
    deps.toast('toast.failed')
  }
}

/**
 * Reorder one workspace's sessions through the official controller.
 *
 * This is the host call the official sidebar's own manual ordering uses, and
 * `WorkspaceView.sessionIds` is the array both surfaces read, so a drop inside a
 * project edits the SAME order the official list shows.
 *
 * `moveBeside` computes the resulting list here rather than asking the host to
 * move by delta: the host API is DOM-`insertBefore`-shaped (move X before Y), so
 * expressing the drop as "the moved id now sits before its successor" keeps the
 * two in step without a second round-trip to learn the new order.
 */
export async function reorderWorkspaceSessions(
  ctx: ClientContext,
  workspaceId: string,
  orderedIds: readonly string[],
  movedId: string,
): Promise<void> {
  // The host speaks insertBefore; `successorAfter` is the translation, and it
  // returns undefined at the tail, which the host reads as "move to the end".
  const beforeId = successorAfter(orderedIds, movedId)
  if (orderedIds.indexOf(movedId) < 0) return
  await getWorkspaces(ctx).insertSessionBefore(
    workspaceId as never,
    movedId as never,
    beforeId === undefined ? undefined : (beforeId as never),
  )
}

/** Rename a workspace or a session through the controller the official UI uses. */
export async function applyRename(
  ctx: ClientContext,
  target: RenameTarget,
  title: string,
): Promise<void> {
  const trimmed = title.trim()
  if (trimmed === '' || trimmed === target.title) return
  if (target.kind === 'workspace') {
    await renameWorkspace(ctx, target.id, trimmed)
    return
  }
  const binding = getSessions(ctx).binding(target.id as never)
  if (binding === undefined) throw new Error('会话未加载')
  const result = await binding.session.rename(trimmed)
  if (!result.ok) throw new Error(result.error?.message ?? '重命名失败')
}
