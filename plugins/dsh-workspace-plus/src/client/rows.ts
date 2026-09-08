/**
 * Map a built-in sidebar row DOM node back to its workspace or session id.
 *
 * The official package does not expose the row components, so this walks the
 * React fiber attached to the node and reads the props the row was rendered
 * with (ported from dsh-workspace-menu v1.2.0). It never mutates host state —
 * it only reads — and bails out as soon as a row's own props are found.
 */

export type RowKind = 'workspace' | 'session'

export interface RowInfo {
  kind: RowKind
  id: string
  title: string
}

interface FiberLike {
  memoizedProps?: Record<string, unknown>
  return?: FiberLike
}

/** How many ancestors to walk before giving up on finding row props. */
const MAX_FIBER_HOPS = 30

function fiberPropsOf(el: Element): Record<string, unknown> | undefined {
  const key = Object.keys(el).find((name) => name.startsWith('__reactFiber$'))
  if (key === undefined) return undefined
  let fiber = (el as unknown as Record<string, FiberLike | undefined>)[key]
  for (let hop = 0; fiber !== undefined && hop < MAX_FIBER_HOPS; hop += 1) {
    const props = fiber.memoizedProps
    if (props !== undefined && (props.group !== undefined || isSessionNode(props))) return props
    fiber = fiber.return
  }
  return undefined
}

/**
 * Session rows carry a node with an id, a numeric updatedAt and a boolean
 * blank flag. Workspace rows carry a `group`. Both shapes are structural
 * guesses, so each field is checked before use.
 */
function isSessionNode(props: Record<string, unknown>): boolean {
  const node = props.node
  if (node === null || typeof node !== 'object') return false
  const value = node as Record<string, unknown>
  return value.id !== undefined
    && typeof value.updatedAt === 'number'
    && typeof value.blank === 'boolean'
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined ? '' : String(value)
}

export function rowInfo(el: Element): RowInfo | undefined {
  const props = fiberPropsOf(el)
  if (props === undefined) return undefined

  if (isSessionNode(props)) {
    const node = props.node as Record<string, unknown>
    return {
      kind: 'session',
      id: asText(node.id),
      title: asText(node.title ?? node.displayTitle),
    }
  }

  const group = props.group
  if (group !== null && typeof group === 'object') {
    const value = group as Record<string, unknown>
    const id = value.workspaceId === undefined ? '' : asText(value.workspaceId)
    if (id === '') return undefined
    return { kind: 'workspace', id, title: asText(value.label) }
  }
  return undefined
}

/**
 * Mark each sidebar row with its identity and pin/unread state.
 *
 * The dataset attributes feed the CSS badges and let the menu resolve a row
 * without walking the fiber again.
 */
export function tagRows(state: { pinnedWorkspaces: string[]; pinnedSessions: string[]; unreadSessions: string[] }): void {
  for (const row of document.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
    const info = rowInfo(row)
    if (info === undefined) continue
    if (info.kind === 'workspace') {
      row.dataset.dshWorkspaceId = info.id === '' ? undefined : info.id
      row.dataset.dshPinned = state.pinnedWorkspaces.includes(info.id) ? 'true' : 'false'
      row.dataset.dshUnread = 'false'
      continue
    }
    row.dataset.dshSessionId = info.id
    row.dataset.dshPinned = state.pinnedSessions.includes(info.id) ? 'true' : 'false'
    row.dataset.dshUnread = state.unreadSessions.includes(info.id) ? 'true' : 'false'
  }
}
