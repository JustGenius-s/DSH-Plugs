/**
 * Map a built-in sidebar row DOM node back to its workspace or session id.
 *
 * The official package does not expose the row components, so this walks the
 * React fiber attached to the node and reads the props the row was rendered
 * with (ported from dsh-workspace-menu v1.2.0). It never mutates host state —
 * it only reads — and bails out as soon as a row's own props are found.
 */

import { isPinned, type Pin } from './pins.ts'

export type RowKind = 'workspace' | 'session'

export interface RowInfo {
  kind: RowKind
  id: string
  title: string
}

interface FiberLike {
  memoizedProps?: Record<string, unknown> | null
  return?: FiberLike | null
}

/** How many ancestors to walk before giving up on finding row props. */
const MAX_FIBER_HOPS = 30

function fiberOf(el: Element): FiberLike | undefined {
  const key = Object.keys(el).find((name) => name.startsWith('__reactFiber$'))
  return key === undefined
    ? undefined
    : (el as unknown as Record<string, FiberLike | undefined>)[key]
}

function fiberPropsOf(el: Element): Record<string, unknown> | undefined {
  let fiber = fiberOf(el)
  for (let hop = 0; fiber != null && hop < MAX_FIBER_HOPS; hop += 1) {
    const props = fiber.memoizedProps
    if (props != null && (
      props.group !== undefined
      || isSessionNode(props)
      || isSessionSearchResult(props)
      || isPluginRow(props.workspacePlusRow)
    )) return props
    fiber = fiber.return ?? undefined
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

/** Current DSH search rows carry request-local session data under `result`. */
function isSessionSearchResult(props: Record<string, unknown>): boolean {
  const result = props.result
  if (result === null || typeof result !== 'object') return false
  const value = result as Record<string, unknown>
  return value.id !== undefined
    && typeof value.title === 'string'
    && typeof value.workspace === 'string'
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined ? '' : String(value)
}

function isPluginRow(value: unknown): value is RowInfo {
  if (value === null || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (row.kind === 'workspace' || row.kind === 'session')
    && typeof row.id === 'string' && row.id !== ''
    && typeof row.title === 'string'
}

export function rowInfo(el: Element): RowInfo | undefined {
  const props = fiberPropsOf(el)
  if (props === undefined) return undefined
  if (isPluginRow(props.workspacePlusRow)) return props.workspacePlusRow

  if (isSessionNode(props)) {
    const node = props.node as Record<string, unknown>
    if (node.blank === true) return undefined
    return {
      kind: 'session',
      id: asText(node.id),
      title: asText(node.title ?? node.displayTitle),
    }
  }

  if (isSessionSearchResult(props)) {
    const result = props.result as Record<string, unknown>
    return {
      kind: 'session',
      id: asText(result.id),
      title: asText(result.title),
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

/** Guard the grouped, flat and search trees before attaching the pinned section. */
export function isWorkspaceBrowserTree(el: Element): boolean {
  let fiber = fiberOf(el)
  const seen = new Set<FiberLike>()
  for (let hop = 0; fiber != null && hop < 80 && !seen.has(fiber); hop += 1) {
    seen.add(fiber)
    const props = fiber.memoizedProps
    if (typeof props?.useSessions === 'function'
      && typeof props.open === 'function'
      && (typeof props.setSessionOrder === 'function' || Array.isArray(props.workspaces))) return true
    fiber = fiber.return ?? undefined
  }
  return false
}

/**
 * Mark each sidebar row with its identity and pin/unread state.
 *
 * The dataset attributes feed the CSS badges and let the menu resolve a row
 * without walking the fiber again.
 */
export function tagRows(state: {
  pins: readonly Pin[]
  unreadSessions: string[]
}): void {
  for (const row of document.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
    const info = rowInfo(row)
    if (info === undefined) continue
    if (info.kind === 'workspace') {
      row.dataset.dshWorkspaceId = info.id === '' ? undefined : info.id
      row.dataset.dshPinned = isPinned(state.pins, info) ? 'true' : 'false'
      row.dataset.dshUnread = 'false'
      continue
    }
    row.dataset.dshSessionId = info.id
    row.dataset.dshPinned = isPinned(state.pins, info) ? 'true' : 'false'
    row.dataset.dshUnread = state.unreadSessions.includes(info.id) ? 'true' : 'false'
  }
}
