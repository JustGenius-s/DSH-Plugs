import type { SessionSummary } from '@just-genius/dsh-plugin-runtime/client'
import type { WorkspaceView } from '../shared.ts'
import { pinKey, readPins, type Pin } from '../pin-state.ts'
export { isPinned, pinKey, readPins, updatePin, type Pin, type PinTarget } from '../pin-state.ts'

export interface PinnedWorkspace {
  kind: 'workspace'
  pin: Pin & { kind: 'workspace' }
  workspace: WorkspaceView
}

export interface PinnedSession {
  kind: 'session'
  pin: Pin & { kind: 'session' }
  session: SessionSummary
  workspace: WorkspaceView | undefined
}

export type PinnedItem = PinnedWorkspace | PinnedSession

/** Missing rows are omitted, not forgotten: a reconnect can supply them again. */
export function pinnedItems(
  pins: readonly Pin[],
  workspaces: readonly WorkspaceView[],
  sessions: Readonly<Record<string, SessionSummary | undefined>>,
  archivedSessionIds: readonly string[],
): PinnedItem[] {
  const byWorkspace = new Map(workspaces.map((workspace) => [String(workspace.workspaceId), workspace]))
  const archived = new Set(archivedSessionIds)
  const items: PinnedItem[] = []
  for (const pin of readPins({ pins })) {
    if (pin.kind === 'workspace') {
      const workspace = byWorkspace.get(pin.id)
      if (workspace !== undefined) items.push({ kind: 'workspace', pin, workspace })
      continue
    }
    const session = sessions[pin.id]
    if (session === undefined || session.blank || session.origin === 'subagent' || archived.has(pin.id)) continue
    const workspace = workspaces.find((item) => item.sessionIds.some((id) => String(id) === pin.id))
    items.push({ kind: 'session', pin, session, workspace })
  }
  return items
}

export interface PinLayout {
  headerOrder: number
  dividerOrder: number
  entries: { key: string; order: number; item: PinnedItem }[]
}

/** Native project groups and session shortcuts share the same negative orders. */
export function pinLayout(items: readonly PinnedItem[]): PinLayout {
  return {
    headerOrder: -items.length - 2,
    dividerOrder: -1,
    entries: items.map((item, index) => ({
      key: pinKey(item.pin),
      order: index - items.length - 1,
      item,
    })),
  }
}
