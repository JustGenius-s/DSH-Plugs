import type { ClientContext, UiWorkspaceFace } from '@just-genius/dsh-plugin-runtime/client'
import {
  CLIENT_SERVICES,
  getSessions,
  getUiWorkspace,
  getWorkspaces,
} from '@just-genius/dsh-plugin-runtime/client'

import { BindingDialog } from './BindingDialog.tsx'
import { openSession } from './actions.ts'
import { MenuSettingsItem } from './MenuSettingsItem.tsx'
import { RowMenuOverlay } from './RowMenuOverlay.tsx'
import { WorkspaceRowChrome } from './WorkspaceRowChrome.tsx'
import { commitBinding, type WorkspaceFace } from './commit.ts'
import { askCreateBinding, type ConfirmDecision } from './flow.ts'
import { en, zh, type WorkspacePlusKey } from './locales.ts'
import { normalizeCompare, SETTINGS_NS } from '../shared.ts'
import { installSessionTitleRepair } from './session-title-repair.ts'
import { installPinPersistence, listenForMenuStateChanges } from './features.ts'

declare module '@just-genius/dsh-plugin-runtime/client' {
  interface PluginLocaleNamespaceMap {
    'workspace-plus': WorkspacePlusKey
  }
}

const NS = 'workspace-plus'

export const inject = [
  CLIENT_SERVICES.slots,
  CLIENT_SERVICES.locale,
  CLIENT_SERVICES.workspaces,
  CLIENT_SERVICES.uiWorkspace,
  CLIENT_SERVICES.sessions,
] as const

/** Decision made by the entry picker; consumed by the next create() call. */
let pendingDecision: ConfirmDecision | null = null

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-workspace-plus: dictionaries')
  const t = ctx.locale.bind(NS)
  const workspaces = getWorkspaces(ctx)
  const uiWorkspace = getUiWorkspace(ctx)

  // Capture BEFORE patching: the confirm dialog's "add folder" button must
  // open the real OS picker, not re-enter our own pickDirectory wrapper.
  const originalPickDirectory = uiWorkspace.pickDirectory.bind(uiWorkspace)
  const workspaceFace: WorkspaceFace = {
    create: (input) => workspaces.create(input),
    rename: (workspaceId, title) => workspaces.rename(workspaceId, title),
  }

  ctx.effect(() => patchPickDirectory(uiWorkspace), 'dsh-workspace-plus: intercept directory pick')
  ctx.effect(() => patchCreate(ctx, workspaceFace), 'dsh-workspace-plus: intercept workspace create')
  ctx.effect(() => installSessionTitleRepair(ctx), 'dsh-workspace-plus: repair cold session titles')
  ctx.effect(() => listenForMenuStateChanges(), 'dsh-workspace-plus: sync local pin state')
  ctx.effect(() => installPinPersistence(), 'dsh-workspace-plus: persist and restore pins')

  // Multi-folder binding: add/edit dialog and the sidebar row decorations.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'workspace-plus-binding',
    order: 40,
    locale: NS,
    inject: () => ({
      t,
      pickDirectory: originalPickDirectory,
    }),
  }, BindingDialog as never))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'workspace-plus-rows',
    order: 41,
    locale: NS,
    inject: () => ({
      t,
      workspaces: workspaceFace,
    }),
  }, WorkspaceRowChrome as never))

  // Row menus (merged from dsh-workspace-menu v1.2.0).
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'workspace-plus-menu',
    order: 42,
    locale: NS,
    inject: () => ({ t, ctx }),
  }, RowMenuOverlay as never))

  // Switches for every menu action, in the Plugins settings page.
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: SETTINGS_NS,
    locale: NS,
    inject: () => ({ t }),
  }, MenuSettingsItem as never))

  ctx.effect(() => handleDeepLink(ctx), 'dsh-workspace-plus: deep link')
}

/**
 * Entry interception: when the official "add workspace" flow asks the host for
 * a folder, show OUR picker dialog first. Finder opens only when the user
 * clicks "add folder" inside it. On confirm we hand the primary path back and
 * stash the full decision for create() to bind.
 */
function patchPickDirectory(uiWorkspace: UiWorkspaceFace): () => void {
  const hadOwn = Object.prototype.hasOwnProperty.call(uiWorkspace, 'pickDirectory')
  const original = uiWorkspace.pickDirectory.bind(uiWorkspace)

  const patched = async (): Promise<string | null> => {
    pendingDecision = null
    const decision = await askCreateBinding()
    if (decision.kind === 'current') return null
    pendingDecision = decision
    return decision.primaryPath
  }

  uiWorkspace.pickDirectory = patched

  return () => {
    if (uiWorkspace.pickDirectory !== patched) return
    if (hadOwn) {
      uiWorkspace.pickDirectory = original
      return
    }
    Reflect.deleteProperty(uiWorkspace, 'pickDirectory')
  }
}

function patchCreate(ctx: ClientContext, workspaceFace: WorkspaceFace): () => void {
  const workspaces = ctx.workspaces
  const hadOwn = Object.prototype.hasOwnProperty.call(workspaces, 'create')
  const original = workspaces.create.bind(workspaces)
  let bypass = false

  const patched = async (input: { path: string }) => {
    if (bypass) return original(input)

    const pending = pendingDecision
    if (pending !== null && pending.kind === 'multi' && normalizeCompare(pending.primaryPath) === normalizeCompare(input.path)) {
      pendingDecision = null
      return bindAndCreate(pending)
    }

    return original(input)
  }

  async function bindAndCreate(decision: ConfirmDecision & { kind: 'multi' }) {
    bypass = true
    try {
      const workspace = await original({ path: decision.primaryPath })
      await commitBinding(decision, {
        workspaces: workspaceFace,
        workspaceId: workspace.workspaceId,
        previousPrimaryPath: decision.primaryPath,
      })
      return workspace
    } finally {
      bypass = false
    }
  }

  workspaces.create = patched

  return () => {
    if (workspaces.create !== patched) return
    if (hadOwn) {
      workspaces.create = original
      return
    }
    Reflect.deleteProperty(workspaces, 'create')
  }
}

/** Open the session named by `?session=<id>` once the session list has it. */
function handleDeepLink(ctx: ClientContext): () => void {
  const target = new URLSearchParams(window.location.search).get('session')
  if (target === null) return () => undefined
  const sessions = getSessions(ctx)
  let tries = 0
  const timer = window.setInterval(() => {
    tries += 1
    const byId = sessions.list.getSnapshot().byId
    const found = Object.keys(byId).find((id) => id === target)
    if (found !== undefined) {
      window.clearInterval(timer)
      openSession(ctx, found)
      return
    }
    if (tries >= 30) {
      window.clearInterval(timer)
      // Try one explicit refresh before giving up. `refresh` is absent on
      // some supported faces, so a missing one just ends the retry loop.
      const refresh = (sessions as { refresh?: () => Promise<unknown> }).refresh?.bind(sessions)
      if (refresh === undefined) return
      refresh().then(() => {
        const refreshed = Object.keys(sessions.list.getSnapshot().byId).find((id) => id === target)
        if (refreshed !== undefined) openSession(ctx, refreshed)
      }).catch(() => undefined)
    }
  }, 250)
  return () => window.clearInterval(timer)
}
