/**
 * Routes conversation file links into the `files` side-panel preview.
 *
 * The stock chat view opens file links through `ctx.workspaces.openPath`,
 * which hands the path to the Host operating system's default application.
 * That service is a shared instance captured by the conversation plugin at
 * apply time, so shadowing its `openPath` method here reroutes every chat
 * file-open (markdown links, produced-files chips) without forking the
 * conversation package.
 *
 * Only paths inside the current session's working directory are rerouted;
 * everything else — the workspace folder itself (`.`), absolute paths
 * outside the workspace, relative paths with no known cwd — falls through
 * to the original system opener.
 */

import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../../../shared/config'
import type { CodexFeature } from '../../core/feature-manager'
import type {} from '../side-panels/contract'
import type { SidePanelsStore } from '../side-panels/service'

/**
 * The client runtime's sessions face, narrowed structurally. This package
 * compiles host and client entries in one program, and the host-side
 * `sessions` augmentation (dsh-host-apiproxy's SessionStore) wins the
 * merged `Context` interface — so the client face is read through a cast,
 * the same way the shell narrows `useSessions` state.
 */
interface ClientSessionsLike {
  list: {
    getSnapshot(): {
      current?: string
      byId?: Record<string, { cwd?: string }>
    }
  }
}

export function createFileLinksFeature(
  ctx: ClientContext,
  scope: SettingsScope<DshCodexConfig>,
): CodexFeature {
  return {
    id: 'file-links',
    activate() {
      const workspaces = ctx.workspaces
      const store = ctx.sidePanels as SidePanelsStore
      const hadOwn = Object.prototype.hasOwnProperty.call(workspaces, 'openPath')
      const original = workspaces.openPath

      const patched = async (path: string): Promise<void> => {
        const config = scope.getSnapshot().value ?? DEFAULT_CONFIG
        if (config.fileLinksInPanel && config.filesEnabled) {
          const target = panelTarget(ctx, path)
          if (target !== undefined) {
            openPreview(store, target.sessionId, target.file)
            return
          }
        }
        return original.call(workspaces, path)
      }

      workspaces.openPath = patched

      return () => {
        // Another feature may have re-patched after us; leave its patch alone.
        if (workspaces.openPath !== patched) return
        if (hadOwn) {
          workspaces.openPath = original
        } else {
          // The stock method lives on the prototype; dropping the own
          // property restores it.
          Reflect.deleteProperty(workspaces, 'openPath')
        }
      }
    },
  }
}

/**
 * The panel-relative target for `path`, or undefined when the link should
 * keep the system opener. `path` arrives already resolved against the
 * session cwd by the conversation's `openFile` inject, so it is absolute
 * whenever a cwd was known.
 */
function panelTarget(
  ctx: ClientContext,
  path: string,
): { sessionId: string; file: string } | undefined {
  const normalized = path.replace(/\\/g, '/')
  if (!normalized.startsWith('/')) return undefined
  const sessions = ctx.sessions as unknown as ClientSessionsLike
  const state = sessions.list.getSnapshot()
  const sessionId = state.current
  if (sessionId === undefined) return undefined
  const cwd = state.byId?.[sessionId]?.cwd?.replace(/\\/g, '/')
  if (cwd === undefined || cwd === '') return undefined
  const root = cwd.endsWith('/') ? cwd : cwd + '/'
  const trimmed = normalized.replace(/\/+$/, '')
  // The workspace folder itself (the produced-files `.` link) keeps the
  // system opener — previewing a directory is the tree's job.
  if (trimmed === cwd) return undefined
  if (!normalized.startsWith(root)) return undefined
  const relative = normalized.slice(root.length)
  // The host endpoint rejects `..`; never hand it one.
  if (relative === '' || relative.split('/').includes('..')) return undefined
  return { sessionId, file: relative }
}

/**
 * Open `file` in a preview tab, reusing an existing preview of the same
 * file instead of stacking duplicates (the panel is `multi`, so a bare
 * `open` always adds a tab).
 */
function openPreview(store: SidePanelsStore, sessionId: string, file: string): void {
  // The shell syncs the store's session from a layout effect; a link click
  // can beat it, and an instance opened under a stale session would vanish
  // on that sync.
  if (store.currentSession() !== sessionId) store.setSession(sessionId)
  const current = store.getSnapshot()
  const existing = current.instances.find(
    instance =>
      instance.panelId === 'files'
      && instance.state?.mode === 'preview'
      && instance.state.file === file,
  )
  if (existing !== undefined) {
    store.activateInstance(existing.key)
    return
  }
  store.open('files', { mode: 'preview', file })
}
