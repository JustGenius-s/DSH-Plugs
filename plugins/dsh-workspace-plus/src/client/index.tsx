/**
 * Browser half of @just-genius/dsh-workspace-plus.
 *
 * The plugin adds four things and takes nothing away:
 *
 *  1. **Pinned area** — a compact list above the official sidebar browsing
 *     region. Mounted into the sidebar's flexible region rather than by claiming
 *     a slot, because DSH declares `sidebar.workspaces` as a single occupant
 *     with no hole above it. The official browser keeps its own node, its own
 *     scroll container, and its own ordering.
 *  2. **Extra rows in the official Project row menu** — DSH exposes no slot for
 *     that menu, so its opening is watched and our rows are portaled into it.
 *  3. **Extra rows in the official Session menu** — DSH DOES expose a slot
 *     (`sidebar.workspaces.session.menu.item`), so this is an ordinary
 *     contribution placed after the host's rows by `order`.
 *  4. **Multi-folder bindings** — the folder flow, persisted by the Host half.
 *
 * The previous version patched `workspaces.create`, `uiWorkspace.pickDirectory`,
 * and scanned React fibers to identify rows. All of that is gone: DSH 0.1.7
 * exposes `data-row-key`, `data-slot`, and the row-menu slots, so the plugin no
 * longer guesses at host internals.
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import {
  CLIENT_SERVICES,
  getSessions,
  getUiWorkspace,
  getWorkspaces,
} from '@just-genius/dsh-plugin-runtime/client'
import { Toast, writeClipboard } from '@just-genius/dsh-plugin-ui'

import { BindingDialog } from './BindingDialog.tsx'
import { DialogLayer } from './DialogLayer.tsx'
import {
  DIRECTORY_FLOW_PRIORITY,
  DIRECTORY_FLOW_SLOTS,
  DirectoryFlow,
} from './DirectoryFlow.tsx'
import { MenuSettingsItem } from './MenuSettingsItem.tsx'
import { PinnedPanel } from './PinnedPanel.tsx'
import { SessionMenuExtra, SESSION_MENU_ORDER } from './SessionMenuExtra.tsx'
import { WorkspaceMenuRows } from './WorkspaceMenuRows.tsx'
import { pinSession } from './actions.ts'
import { TOP_SCOPE, projectScope } from './pinned-order.ts'
import { getBindings, pruneStaleBindings, refreshBindings } from './bindings.ts'
import { commitBinding, type WorkspaceFace } from './commit.ts'
import { askEditBinding, type ConfirmDecision } from './flow.ts'
import { askArchive, askRemove, askRename } from './dialogs.ts'
import {
  adoptWorkspacePins,
  getPluginState,
  isEnabled,
  listenForPluginStateChanges,
  setPinsCollapsed,
  setProjectCollapsed,
  setPinnedOrder,
  setWorkspacePin,
  subscribePluginState,
} from './features.ts'
import { en, zh, type WorkspacePlusKey } from './locales.ts'
import { createPinPersistence } from './pin-persistence.ts'
import { sessionExporter } from './session-export.ts'
import { clearToastOnUnmount, dismissToast, getToast, showToast, subscribeToast } from './toast.ts'
import {
  applyRename,
  pluginProjectRows,
  copySessionReference,
  reorderWorkspaceSessions,
  runProjectAction,
  runSessionAction,
  type ActionDeps,
} from './row-actions.ts'
import { createWorkspaceMenuWatcher, useWorkspaceMenuTarget } from './workspace-menu.ts'
import type { RepoFolder, WorkspaceBinding } from '../shared.ts'
import { samePath } from '../shared.ts'

declare module '@just-genius/dsh-plugin-runtime/client' {
  interface PluginLocaleNamespaceMap {
    'workspace-plus': WorkspacePlusKey
  }
}

const NS = 'workspace-plus'
const BUNDLE_NAME = '@just-genius/dsh-workspace-plus'

export const inject = [
  CLIENT_SERVICES.slots,
  CLIENT_SERVICES.locale,
  CLIENT_SERVICES.workspaces,
  CLIENT_SERVICES.uiWorkspace,
  CLIENT_SERVICES.sessions,
  CLIENT_SERVICES.uiSession,
] as const

/** One store binding, so every host below reads state the same way. */
function usePluginState() {
  return useSyncExternalStore(subscribePluginState, getPluginState, getPluginState)
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-workspace-plus: dictionaries')
  const t = ctx.locale.bind(NS)

  const persistence = createPinPersistence({
    initial: getPluginState().workspacePins,
    apply: adoptWorkspacePins,
    // Legacy session pins are adopted by DSH's own registry, then cleared.
    adoptSessionPin: async (sessionId) => { await pinSession(ctx, sessionId, true) },
    onError: (error) => { console.warn('[dsh-workspace-plus] pin persistence retrying', error) },
  })
  ctx.effect(() => {
    void persistence.flush().catch((error: unknown) => {
      console.warn('[dsh-workspace-plus] pin persistence unavailable; will retry', error)
    })
    return () => { persistence.dispose() }
  }, 'dsh-workspace-plus: project pins')
  ctx.effect(() => listenForPluginStateChanges(), 'dsh-workspace-plus: sync local state')
  ctx.effect(() => {
    void refreshBindings().catch(() => undefined)
    // Then, once the Host has actually reported its workspaces, drop bindings
    // whose workspace is gone (a delete through the official row menu cannot
    // reach this plugin's store). Gated on a non-empty snapshot by the helper,
    // so a not-yet-connected list never prunes real data.
    return observeWorkspacePaths(ctx, (paths) => {
      void pruneStaleBindings(paths).catch(() => undefined)
    })
  }, 'dsh-workspace-plus: load bindings')

  // 1. The pinned area. A shell.overlay entry so it shares one React root with
  //    the rest of the plugin; it portals into the sidebar region.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'workspace-plus-panel',
    order: 40,
    locale: NS,
    inject: () => ({ ctx, t, persistence }),
  }, PinnedPanelHost as never))

  // 2. Extra rows in the official Project row menu (no slot exists: injected).
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'workspace-plus-project-menu',
    order: 41,
    locale: NS,
    inject: () => ({ ctx, t, persistence }),
  }, ProjectMenuHost as never))

  // 2b. The dialogs the row menus open. Mounted separately from the rows that
  //     request them, so a dialog survives its row unmounting (unpin, delete).
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'workspace-plus-dialogs',
    order: 44,
    locale: NS,
    inject: () => ({ ctx, t }),
  }, DialogHost as never))

  // 3. Extra rows in the official Session menu.
  ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
    name: 'sidebar.workspaces.session.menu.item',
    id: 'workspace-plus-session-extra',
    order: SESSION_MENU_ORDER,
    locale: NS,
    inject: () => ({
      copyReference: (sessionId: string) => {
        // Shares one body with the panel's row (`runSessionAction`), so the two
        // surfaces cannot copy different text for the same session.
        void copySessionReference(ctx, sessionId).then(
          (copied) => { showToast(copied ? 'toast.referenceCopied' : 'toast.copyFailed') },
        )
      },
      exportSession: (sessionId: string) => {
        if (sessionExporter.getPending().has(sessionId)) return
        showToast('toast.exporting')
        void sessionExporter.run(sessionId).then(
          (started) => { if (started) showToast('toast.exported') },
          () => { showToast('toast.exportFailed') },
        )
      },
      isExporting: (sessionId: string) => sessionExporter.getPending().has(sessionId),
      hasFolder: (sessionId: string) => sessionCwd(ctx, sessionId) !== undefined,
      enabled: {
        copyReference: isEnabled('sessionCopyReference'),
        export: isEnabled('sessionExport'),
        openFolder: isEnabled('sessionOpenFolder'),
      },
    }),
  }, SessionMenuExtra as never))

  // 4. Multi-folder workspaces.
  //
  //    The dialog is mounted ONCE here, and the two directory-flow holes drive
  //    it renderlessly. Keeping one dialog for both entry points is what lets
  //    "Add workspace…" (a hole) and "Edit multi-folder…" (a project row menu,
  //    which is in no hole) share one instance and one pending-request store.
  //
  //    Two facts make the hole route need no patching:
  //      - `uiWorkspace.pickDirectory()` IS the real OS picker (the picker
  //        backend is a separate layer from this hole), so the dialog's own
  //        "add folder" button can call it without re-entering the hole.
  //      - `workspaces.create({ path })` is idempotent, so persisting the binding
  //        here cannot create a second workspace alongside the owner's adoption.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'workspace-plus-binding',
    order: 42,
    locale: NS,
    inject: () => ({ t, pickDirectory: () => pickRealFolder(ctx) }),
  }, BindingDialog as never))

  const commit = (decision: ConfirmDecision & { kind: 'multi' }): Promise<void> =>
    commitBinding(decision, { workspaces: workspaceFaceOf(ctx) })
  for (const hole of DIRECTORY_FLOW_SLOTS) {
    ctx.slots.inject(hole, () => ctx.slots.register({
      name: hole,
      priority: DIRECTORY_FLOW_PRIORITY,
      inject: () => ({ commit }),
    }, DirectoryFlow as never))
  }

  // Transient feedback shared by the injected menu rows.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'workspace-plus-toast',
    order: 43,
    locale: NS,
    inject: () => ({ t }),
  }, ToastHost as never))

  // Switches for every addition, on the bundle's page in the Plugins manager.
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: BUNDLE_NAME,
    locale: NS,
    inject: () => ({ t }),
  }, MenuSettingsItem as never))
}

interface HostInjected {
  t: (key: WorkspacePlusKey) => string
  ctx: ClientContext
  persistence: ReturnType<typeof createPinPersistence>
}

/**
 * Open the real OS folder chooser.
 *
 * Mirrors the official native picker's own preference: DSH-Desktop exposes
 * `globalThis.__DSH_DIRECTORY_PICKER__`, and its chooser is NOT interchangeable
 * with the web picker (it can reach native panels the browser cannot), so the
 * bridge is used first and the service is the fallback.
 */
function pickRealFolder(ctx: ClientContext): Promise<string | null> {
  const bridge = (globalThis as { __DSH_DIRECTORY_PICKER__?: { pick?: () => Promise<string | null> } }).__DSH_DIRECTORY_PICKER__
  if (typeof bridge?.pick === 'function') return bridge.pick()
  return getUiWorkspace(ctx).pickDirectory()
}

/**
 * Run `onPaths` once the Host has reported a usable workspace list.
 *
 * Fires on the first non-empty snapshot and then only when the set of paths
 * actually changes, so the prune is a startup/reconnect reconcile rather than a
 * write on every render. `phase` is checked as well: a `ready` snapshot with no
 * items is a real empty install, and pruning against it is still refused by
 * `pruneStaleBindings`, which keeps the guard in one place.
 */
function observeWorkspacePaths(
  ctx: ClientContext,
  onPaths: (paths: readonly string[]) => void,
): () => void {
  const list = getWorkspaces(ctx).list
  let last = ''
  const read = (): void => {
    const snapshot = list.getSnapshot()
    if (snapshot.phase !== 'ready') return
    const paths = snapshot.items
      .map((item) => item.path)
      .filter((path): path is string => typeof path === 'string' && path !== '')
      .sort()
    const key = paths.join('\u0000')
    if (key === last) return
    last = key
    onPaths(paths)
  }
  read()
  return list.subscribe(read)
}

/** The official workspace commands the binding commit needs. */
function workspaceFaceOf(ctx: ClientContext): WorkspaceFace {
  const workspaces = getWorkspaces(ctx)
  return {
    create: (input) => workspaces.create(input),
    rename: (id, title) => workspaces.rename(id, title),
  }
}

/**
 * The shared action wiring every surface uses.
 *
 * Built once per render but kept tiny and pure: it only closes over the plugin's
 * stores and `ctx`, so the panel and the injected menus cannot disagree about
 * what an action DOES — only about which rows they list.
 */
function useActionDeps(
  ctx: ClientContext,
  t: (key: WorkspacePlusKey) => string,
  persistence: ReturnType<typeof createPinPersistence>,
): ActionDeps {
  return {
    ctx,
    toast: (key) => { showToast(key) },
    isProjectPinned: (workspaceId) => getPluginState().workspacePins.includes(workspaceId),
    setProjectPin: async (workspaceId, pinned) => {
      setWorkspacePin(workspaceId, pinned)
      await persistence.set(workspaceId, pinned)
    },
    requestRename: (target) => {
      void askRename(target).then(async (title) => {
        if (title === undefined) return
        try {
          await applyRename(ctx, target, title)
        } catch (error) {
          console.warn('[dsh-workspace-plus] rename failed', error)
          showToast('toast.renameFailed')
        }
      })
    },
    requestBinding: (workspaceId) => { void openBindingEditor(ctx, workspaceId) },
    confirmRemove: (workspaceId, title) => askRemove(workspaceId, title),
    confirmArchive: (sessionId, title, activity) => askArchive(sessionId, title, activity),
    isExporting: (sessionId) => sessionExporter.getPending().has(sessionId),
    exportSession: (sessionId) => {
      if (sessionExporter.getPending().has(sessionId)) return
      showToast('toast.exporting')
      void sessionExporter.run(sessionId).then(
        (started) => { if (started) showToast('toast.exported') },
        () => { showToast('toast.exportFailed') },
      )
    },
  }
}

/** Open the multi-folder editor seeded from the stored binding. */
async function openBindingEditor(ctx: ClientContext, workspaceId: string): Promise<void> {
  const workspace = getWorkspaces(ctx).list.getSnapshot().items
    .find((item) => String(item.workspaceId) === workspaceId)
  if (workspace === undefined) return
  const decision = await askEditBinding(seedBinding(workspaceId, workspace.path, workspace.title))
  if (decision.kind !== 'multi') return
  const workspaces = getWorkspaces(ctx)
  await commitBinding(decision, {
    workspaces: {
      create: (input) => workspaces.create(input),
      rename: (id, title) => workspaces.rename(id, title),
    },
    workspaceId: workspace.workspaceId,
    previousPrimaryPath: workspace.path,
  })
}

function PinnedPanelHost(props: Partial<HostInjected>) {
  const state = usePluginState()
  if (props.ctx === undefined || props.t === undefined || props.persistence === undefined) return null
  // Captured after the guard: TypeScript does not carry the narrowing into the
  // closures below, and these are used inside them.
  const ctx = props.ctx
  const deps = useActionDeps(ctx, props.t, props.persistence)
  if (!isEnabled('pinnedPanel', state)) return null
  return (
    <PinnedPanel
      ctx={ctx}
      t={props.t}
      workspacePins={state.workspacePins}
      collapsed={state.pinsCollapsed}
      setCollapsed={setPinsCollapsed}
      collapsedProjects={state.collapsedProjects}
      setProjectCollapsed={setProjectCollapsed}
      pinnedOrder={state.pinnedOrder}
      onReorder={(request) => {
        // The panel's own arrangement is ALWAYS recorded, for both scopes: the
        // panel re-sorts its rows for display, so a host write on its own is
        // invisible until a stored order overrides that sort (see pinned-order.ts).
        setPinnedOrder(
          request.kind === 'top' ? TOP_SCOPE : projectScope(request.workspaceId),
          request.order,
        )
        // A project's children are additionally written through to the host, so
        // the official sidebar's manual order changes with them — it reads the
        // same `sessionIds` array.
        if (request.kind === 'children') {
          void reorderWorkspaceSessions(ctx, request.workspaceId, request.order, request.movedId).catch(
            (error: unknown) => {
              console.warn('[dsh-workspace-plus] reordering sessions failed', error)
              showToast('toast.failed')
            },
          )
        }
      }}
      setWorkspacePin={(workspaceId, pinned) => { void deps.setProjectPin(workspaceId, pinned) }}
      onProjectAction={(workspaceId, actionId) => { void runProjectAction(deps, workspaceId, actionId) }}
      onSessionAction={(sessionId, actionId) => { void runSessionAction(deps, sessionId, actionId) }}
      onNewSession={(workspaceId) => {
        const uiWorkspace = getUiWorkspace(props.ctx as ClientContext)
        if (typeof uiWorkspace.startSession !== 'function') return
        setProjectCollapsed(workspaceId, false)
        uiWorkspace.startSession(workspaceId as never)
      }}
      isExporting={deps.isExporting}
      sessionHasFolder={(sessionId) => sessionCwd(props.ctx as ClientContext, sessionId) !== undefined}
      onError={() => { showToast('toast.openFailed') }}
    />
  )
}

/**
 * The dialogs the row menus open, mounted once in the overlay layer.
 *
 * They live HERE rather than inside the panel because a row menu can be opened
 * from a row that is about to unmount (unpin, delete), and a dialog owned by that
 * row would vanish with it.
 */
function DialogHost(props: Partial<HostInjected>) {
  if (props.ctx === undefined || props.t === undefined) return null
  const { ctx, t } = props
  return (
    <DialogLayer
      t={t}
      applyRename={async (target, title) => { await applyRename(ctx, target, title) }}
    />
  )
}

/**
 * The plugin's rows inside the official Project row menu.
 *
 * The menu belongs to DSH and carries no slot, so its opening is watched and the
 * rows are portaled in as official `MenuItemButton`s — which is what makes them
 * join the list's keyboard walk and dismiss like a shipped row. The host's own
 * rename and delete rows are left untouched.
 */
function ProjectMenuHost(props: Partial<HostInjected>) {
  const [watcher] = useState(() => createWorkspaceMenuWatcher())
  const target = useWorkspaceMenuTarget(watcher)
  const state = usePluginState()

  useEffect(() => {
    watcher.setEnabled(isEnabled('contextmenu', state))
  }, [watcher, state])

  // A deactivated plugin must leave the official menu exactly as it found it.
  useEffect(() => () => { watcher.dispose() }, [watcher])

  if (props.ctx === undefined || props.t === undefined || props.persistence === undefined) return null
  if (target === null) return null

  const { ctx, t, persistence } = props
  const deps = useActionDeps(ctx, t, persistence)
  const pinned = state.workspacePins.includes(target.workspaceId)

  // The SAME list the panel shows, filtered by the per-row switches. `pin` is
  // relabelled rather than swapped so the two surfaces keep one id per action.
  const switches: Record<string, boolean> = {
    pin: isEnabled('workspacePin', state),
    editBinding: isEnabled('workspaceEditBinding', state),
    openExplorer: isEnabled('workspaceOpenExplorer', state),
    copyPath: isEnabled('workspaceCopyPath', state),
    newSession: isEnabled('workspaceNewSession', state),
  }
  const actions = pluginProjectRows({ pinned, enabled: switches })

  return (
    <WorkspaceMenuRows
      target={target}
      t={t}
      actions={actions}
      onSelect={(actionId) => { void runProjectAction(deps, target.workspaceId, actionId) }}
    />
  )
}

/** Seed the edit dialog from the stored multi-folder binding, when there is one. */
function seedBinding(workspaceId: string, path: string, title: string): {
  repos: RepoFolder[]
  primaryPath: string
  title: string
} {
  const binding: WorkspaceBinding | undefined = getBindings().find((item) => (
    samePath(item.root, path) || samePath(item.primaryPath, path)
    || item.repos.some((repo) => samePath(repo.path, path))
  ))
  if (binding === undefined) {
    return { repos: [{ name: basename(path), path, kind: 'folder' }], primaryPath: path, title }
  }
  return { repos: binding.repos, primaryPath: binding.primaryPath, title: binding.title }
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

/** A session's working directory, when the Host has projected one. */
function sessionCwd(ctx: ClientContext, sessionId: string): string | undefined {
  const summary = getSessions(ctx).list.getSnapshot().byId[sessionId as never]
  return summary === undefined ? undefined : summary.cwd
}
/** The plugin's transient notice, rendered through the shared overlay layer. */
function ToastHost({ t }: { t?: (key: WorkspacePlusKey) => string }) {
  const toast = useSyncExternalStore(subscribeToast, getToast, getToast)
  const translate = t ?? ((key: WorkspacePlusKey) => key)
  // The store is module-level and outlives this tree, so a notice left behind by
  // an unmount would reappear on the next mount as a stale message. Clear it on
  // the way out; `dismissToast` (expiry) is a different transition.
  useEffect(() => clearToastOnUnmount, [])
  if (toast === null) return null
  const text = toast.detail === undefined
    ? translate(toast.key)
    : `${translate(toast.key)}: ${toast.detail}`
  return <Toast key={toast.id} text={text} onDone={dismissToast} />
}
