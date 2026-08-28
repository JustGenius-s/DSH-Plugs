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
 * Absolute paths are rerouted whether they sit inside the session's working
 * directory or not — the host's worktree read is plain file IO and happily
 * previews outside files. What still falls through to the original system
 * opener: the workspace folder itself (`.`), and relative paths with no
 * known cwd.
 */

import type { ClientContext, SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import { getSessions, getWorkspaces } from '@just-genius/dsh-plugin-runtime/client'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../../../shared/config'
import type { CodexFeature } from '../../core/feature-manager'
import type {} from '../side-panels/contract'
import type { SidePanelsStore } from '../side-panels/service'
import { currentSessionLocation } from '../../host-adapters/sessions'

export function createFileLinksFeature(
  ctx: ClientContext,
  scope: SettingsScope<DshCodexConfig>,
): CodexFeature {
  return {
    id: 'file-links',
    requires: ['sidePanels', 'files'],
    activate() {
      const workspaces = getWorkspaces(ctx)
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
 * The panel target for `path`, or undefined when the link should keep the
 * system opener. `path` arrives already resolved against the session cwd by
 * the conversation's `openFile` inject, so it is absolute whenever a cwd was
 * known. Paths inside the workspace stay repo-relative (so a chat link reuses
 * a tree-opened tab of the same file); paths outside go to the panel as
 * absolute — the host's worktree read is not confined to the cwd.
 */
function panelTarget(
  ctx: ClientContext,
  path: string,
): { sessionId: string; file: string } | undefined {
  const normalized = path.replace(/\\/g, '/')
  if (!normalized.startsWith('/') && !/^[A-Za-z]:\//.test(normalized)) {
    return undefined
  }
  const { sessionId, cwd: rawCwd } = currentSessionLocation(getSessions(ctx))
  if (sessionId === undefined) return undefined
  const cwd = rawCwd?.replace(/\\/g, '/')
  if (cwd === undefined || cwd === '') return undefined
  const root = cwd.endsWith('/') ? cwd : cwd + '/'
  const trimmed = normalized.replace(/\/+$/, '')
  // The workspace folder itself (the produced-files `.` link) keeps the
  // system opener — previewing a directory is the tree's job.
  if (trimmed === cwd) return undefined
  if (normalized.startsWith(root)) {
    const relative = normalized.slice(root.length)
    // The host endpoint rejects `..`; never hand it one.
    if (relative === '' || relative.split('/').includes('..')) return undefined
    return { sessionId, file: relative }
  }
  // Outside the workspace: pass the absolute path through. The host rejects
  // NUL bytes; everything else is a read-only preview.
  return { sessionId, file: normalized }
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
