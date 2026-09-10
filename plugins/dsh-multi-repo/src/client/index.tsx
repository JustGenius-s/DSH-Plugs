import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import { CLIENT_SERVICES } from '@just-genius/dsh-plugin-runtime/client'

import { ConfirmModal } from './ConfirmModal'
import { ProjectRowChrome } from './ProjectRowChrome'
import { commitBinding, type WorkspaceFace } from './commit'
import { askPick, type ConfirmDecision } from './flow'
import { en, zh, type MultiRepoKey } from './locales'
import { normalizeCompare } from '../shared'

declare module '@just-genius/dsh-plugin-runtime/client' {
  interface PluginLocaleNamespaceMap {
    'multi-repo': MultiRepoKey
  }
}

const NS = 'multi-repo'

export const inject = [CLIENT_SERVICES.slots, CLIENT_SERVICES.locale, CLIENT_SERVICES.workspaces, CLIENT_SERVICES.sessions] as const

/** Decision made by the entry picker; consumed by the next create() call. */
let pendingDecision: ConfirmDecision | null = null

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-multi-repo: dictionaries')
  const t = ctx.locale.bind(NS)

  // Capture BEFORE patching: the confirm dialog's "add folder" button must
  // open the real OS picker, not re-enter our own pickDirectory wrapper.
  const originalPickDirectory = ctx.workspaces.pickDirectory.bind(ctx.workspaces)
  const workspaceFace: WorkspaceFace = {
    create: (input) => ctx.workspaces.create(input),
    rename: (workspaceId, title) => ctx.workspaces.rename(workspaceId, title),
  }

  ctx.effect(() => patchPickDirectory(ctx), 'dsh-multi-repo: intercept directory pick')
  ctx.effect(() => patchCreate(ctx, workspaceFace), 'dsh-multi-repo: intercept workspace create')

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'multi-repo-confirm',
    order: 40,
    locale: NS,
    inject: () => ({
      t,
      pickDirectory: originalPickDirectory,
    }),
  }, ConfirmModal as never))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'multi-repo-rows',
    order: 41,
    locale: NS,
    inject: () => ({
      t,
      workspaces: workspaceFace,
    }),
  }, ProjectRowChrome as never))
}

/**
 * Entry interception: when the official "add workspace" flow asks the host for
 * a folder, show OUR picker dialog first. Finder opens only when the user
 * clicks "add folder" inside it. On confirm we hand the primary path back and
 * stash the full decision for create() to bind.
 */
function patchPickDirectory(ctx: ClientContext): () => void {
  const workspaces = ctx.workspaces
  const hadOwn = Object.prototype.hasOwnProperty.call(workspaces, 'pickDirectory')
  const original = workspaces.pickDirectory.bind(workspaces)

  const patched = async (): Promise<string | null> => {
    pendingDecision = null
    const decision = await askPick()
    if (decision.kind === 'current') return null
    pendingDecision = decision
    return decision.primaryPath
  }

  workspaces.pickDirectory = patched

  return () => {
    if (workspaces.pickDirectory !== patched) return
    if (hadOwn) {
      workspaces.pickDirectory = original
      return
    }
    Reflect.deleteProperty(workspaces, 'pickDirectory')
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
      if (pending.repos.length < 2) return original(input)
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
