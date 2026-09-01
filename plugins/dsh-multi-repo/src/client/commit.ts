import type { WorkspaceId } from '@just-genius/dsh-plugin-runtime/client'
import { PROJECT_PATH, samePath, type WorkspaceView } from '../shared'
import type { ConfirmDecision } from './flow'
import { postJson } from './http'
import { refreshProjects } from './projects'

export interface WorkspaceFace {
  create: (input: { path: string }) => Promise<WorkspaceView>
  rename: (workspaceId: WorkspaceId, title: string) => Promise<WorkspaceView>
}

/** Persist a multi-folder binding and keep the official workspace title in sync. */
export async function commitBinding(
  decision: ConfirmDecision & { kind: 'multi' },
  options?: {
    workspaces?: WorkspaceFace
    workspaceId?: WorkspaceId
    previousPrimaryPath?: string
  },
): Promise<void> {
  if (decision.repos.length < 2) {
    if (options?.previousPrimaryPath !== undefined) {
      await postJson(PROJECT_PATH, { action: 'delete', root: options.previousPrimaryPath }).catch(() => undefined)
    }
    await refreshProjects().catch(() => undefined)
    await syncTitle(decision, options)
    return
  }

  await postJson(PROJECT_PATH, {
    action: 'bind',
    root: decision.primaryPath,
    repos: decision.repos,
    title: decision.title,
    primaryPath: decision.primaryPath,
  })
  await refreshProjects().catch(() => undefined)
  await syncTitle(decision, options)
}

async function syncTitle(
  decision: ConfirmDecision & { kind: 'multi' },
  options?: {
    workspaces?: WorkspaceFace
    workspaceId?: WorkspaceId
    previousPrimaryPath?: string
  },
): Promise<void> {
  const workspaces = options?.workspaces
  const title = decision.title.trim()
  if (workspaces === undefined || title === '') return

  const samePrimary = options?.previousPrimaryPath !== undefined
    && samePath(options.previousPrimaryPath, decision.primaryPath)
  if (samePrimary && options.workspaceId !== undefined) {
    await workspaces.rename(options.workspaceId, title)
    return
  }

  const created = await workspaces.create({ path: decision.primaryPath })
  if (title !== created.title) {
    await workspaces.rename(created.workspaceId, title)
  }
}

export function matchWorkspaceId(
  items: readonly { workspaceId: WorkspaceId; path?: string }[],
  primaryPath: string,
): WorkspaceId | undefined {
  return items.find((item) => typeof item.path === 'string' && samePath(item.path, primaryPath))?.workspaceId
}
