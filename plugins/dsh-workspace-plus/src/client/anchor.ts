/**
 * Read sidebar row identity off the official DOM's stable markers.
 *
 * DSH 0.1.7 gives its rows a `data-row-key` contract — `workspace:<id>`,
 * `session:<id>`, `overflow:<id>`, `empty` — and stamps every render site with
 * `data-slot="<slotKey>"`. Both are declared by the owning packages, so they
 * survive the hash-suffixed CSS class names that change on every build.
 *
 * Everything here is a pure function over strings and element references: no
 * queries, no observers, no mutation. Locating elements lives in
 * `sidebar-host.ts` so the decisions stay testable without a DOM.
 */

/** The two sidebar row kinds this plugin decorates. */
export type RowKind = 'workspace' | 'session'

export interface RowRef {
  kind: RowKind
  id: string
}

/** Prefix of the official workspace (Project) row key. */
export const WORKSPACE_ROW_PREFIX = 'workspace:'

/** Prefix of the official session row key. */
export const SESSION_ROW_PREFIX = 'session:'

/** Prefix of the official "show more rows" control key. */
export const OVERFLOW_ROW_PREFIX = 'overflow:'

function readKey(value: string | null | undefined, prefix: string): string | undefined {
  if (typeof value !== 'string' || !value.startsWith(prefix)) return undefined
  const id = value.slice(prefix.length)
  return id === '' ? undefined : id
}

/**
 * Identity of a row from its `data-row-key`, or `undefined` for the many keys
 * that are not a row this plugin owns (`overflow:<group>`, `empty`, future
 * shapes). Unknown keys are dropped rather than guessed at.
 */
export function parseRowKey(value: string | null | undefined): RowRef | undefined {
  const workspaceId = readKey(value, WORKSPACE_ROW_PREFIX)
  if (workspaceId !== undefined) return { kind: 'workspace', id: workspaceId }
  const sessionId = readKey(value, SESSION_ROW_PREFIX)
  if (sessionId !== undefined) return { kind: 'session', id: sessionId }
  return undefined
}

/** The official row key for one workspace id. */
export function workspaceRowKey(workspaceId: string): string {
  return `${WORKSPACE_ROW_PREFIX}${workspaceId}`
}

/** The official row key for one session id. */
export function sessionRowKey(sessionId: string): string {
  return `${SESSION_ROW_PREFIX}${sessionId}`
}

/**
 * Whether a `data-slot` value is the sidebar's workspace-browsing hole.
 *
 * The hole wraps the official browser (`display: contents`), so its PARENT is
 * the sidebar's flexible region.
 */
export function isWorkspaceSlot(value: string | null | undefined): boolean {
  return value === 'sidebar.workspaces'
}

/**
 * The accessible label of the BROWSING tree.
 *
 * The browser renders two different `role="tree"` elements into the same slot:
 * the grouped/flat session list (labelled "会话" / "Sessions") and, while a
 * search query is active, the search-results tree ("搜索结果" / "Search
 * results"). Only the browsing one may host the pinned area — the search tree is
 * replaced wholesale on every keystroke, so anything of ours inside it is
 * discarded, and a pinned list among search hits would be meaningless anyway.
 *
 * The label is the accessibility contract the official code passes to
 * `aria-label`, which outlives the hashed class names.
 */
export const BROWSING_TREE_LABELS: readonly string[] = ['会话', 'Sessions']

/**
 * Whether a `role="tree"` element is the browsing list rather than the
 * search-results tree.
 *
 * Matched against a known set rather than "anything that is not search": a
 * future third tree must be left alone until it is understood, not adopted.
 */
export function isBrowsingTree(label: string | null | undefined): boolean {
  return typeof label === 'string' && BROWSING_TREE_LABELS.includes(label)
}

/** Whether the sidebar is showing its icon rail instead of the wide column. */
export function isCollapsedRail(classes: string | null | undefined): boolean {
  if (typeof classes !== 'string') return false
  return classes.split(/\s+/).includes('hHd-Xa_collapsed')
}
