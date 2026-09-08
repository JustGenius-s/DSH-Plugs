/**
 * Routes conversation file links into the `files` side-panel preview.
 *
 * Since DSH 0.1.3 the chat view opens file links through the Host Remote
 * `session/openWorkspacePath` — `ctx.remote.session.openWorkspacePath({ path })`
 * — which hands the path to the operating system's default application. Before
 * that, the same gesture went through the client-side `ctx.workspaces.openPath`.
 * The Remote call is a generated namespace method installed as a getter on the
 * namespace service, so shadowing `openWorkspacePath` with an own property here
 * reroutes every chat file-open (markdown links, produced-files chips) without
 * forking the conversation package.
 *
 * Absolute paths are rerouted whether they sit inside the session's working
 * directory or not — the host's worktree read is plain file IO and happily
 * previews outside files. What still falls through to the original system
 * opener: the workspace folder itself (`.`), and relative paths with no
 * known cwd.
 */

import type { ClientContext, SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import { getSessions } from '@just-genius/dsh-plugin-runtime/client'
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
      const session = sessionRemote(ctx)
      if (session === undefined) return () => {}
      const store = ctx.sidePanels as SidePanelsStore
      // The generated namespace installs each method as an own accessor, so
      // the descriptor — not just its current value — is what a restore owes
      // back. Deleting the property instead would leave the namespace without
      // the method for the rest of the page's life.
      const descriptor = findAccessor(session, 'openWorkspacePath')
      if (descriptor === undefined) return () => {}
      const readOriginal = (): OpenWorkspacePath =>
        descriptor.get === undefined
          ? descriptor.value as OpenWorkspacePath
          : descriptor.get.call(session) as OpenWorkspacePath

      const patched = async (request: OpenPathRequest): Promise<OpenPathResult> => {
        const config = scope.getSnapshot().value ?? DEFAULT_CONFIG
        if (config.fileLinksInPanel && config.filesEnabled) {
          const target = panelTarget(ctx, request.path)
          if (target !== undefined) {
            openPreview(store, target.sessionId, target.file)
            // The chat view treats a non-ok result as a failed open and shows
            // its error dialog; a rerouted link needs the same success shape
            // the Host returns when the native opener accepts the path.
            return { ok: true, value: { opened: true } }
          }
        }
        // Read through the saved getter on every call: a method the Gateway
        // remounts (a Remote contribution re-loaded under HMR) installs a new
        // closure, so a value captured once could go stale.
        return readOriginal()(request)
      }

      Object.defineProperty(session, 'openWorkspacePath', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: patched,
      })

      return () => {
        // Another feature may have re-patched after us; leave its patch alone.
        if (session.openWorkspacePath !== patched) return
        Object.defineProperty(session, 'openWorkspacePath', descriptor)
      }
    },
  }
}

/** The wire shapes of `session/openWorkspacePath` (see dsh-api-session-controller). */
interface OpenPathRequest {
  path: string
}

interface OpenPathResult {
  ok: boolean
  value?: { opened: true }
  error?: { code: string; message: string }
}

/**
 * The `session` Remote namespace, or undefined when this Host does not expose
 * it. `ctx.remote.session` throws when the namespace is not injected, so the
 * read is guarded: an older Host keeps its own file-link behavior intact.
 */
function sessionRemote(ctx: ClientContext): SessionRemote | undefined {
  const remote = ctx.remote as { session?: SessionRemote } | undefined
  return remote?.session
}

interface SessionRemote {
  openWorkspacePath(request: OpenPathRequest): Promise<OpenPathResult>
}

type OpenWorkspacePath = (request: OpenPathRequest) => Promise<OpenPathResult>

/**
 * Walk the prototype chain for `key`'s own property descriptor.
 *
 * The Gateway's namespace service defines methods on the instance, but a
 * Remote namespace is reached through Cordis service tracing, so the object
 * read off `ctx.remote.session` may proxy or shadow that instance.
 */
function findAccessor(target: object, key: string): PropertyDescriptor | undefined {
  let current: object | null = target
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key)
    if (descriptor !== undefined && descriptor.configurable) return descriptor
    current = Object.getPrototypeOf(current)
  }
  return undefined
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
