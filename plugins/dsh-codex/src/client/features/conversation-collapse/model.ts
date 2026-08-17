export const TURN_COLLAPSE_KIND = 'codex-turn-collapse' as const

export const WORK_ATTR = 'data-dsh-codex-work'
export const TURN_ATTR = 'data-dsh-codex-turn'
export const COLLAPSED_ATTR = 'data-dsh-codex-collapsed'

/** Chat node kinds that stay visible while a turn's trace is collapsed. */
const KEEP_VISIBLE = new Set([
  'user',
  'steering',
  'context',
  'command',
  'turn-tail',
  'turn-error',
  'turn-max-tokens',
  'compaction',
  'manual-compaction',
  TURN_COLLAPSE_KIND,
])

export interface CodexTurnCollapseData {
  readonly turn: number
  readonly closed: boolean
  readonly startTime?: number
  readonly endTime?: number
}

export interface CollapseState {
  readonly turn: number
  readonly startTime: number
  readonly endTime?: number
  readonly hasWork: boolean
  /** Earliest think/tool seq in the turn; the header sits just before it. */
  readonly firstWorkSeq?: number
}

export interface ChatNodeLike {
  readonly kind: string
  readonly anchorSeq: number
  readonly data: unknown
}

/**
 * Cursor-style compact duration: `45s`, `2m 57s`, `1h 3m`.
 */
export function formatWorkedDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export function fillTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''))
}

export function cssEscape(value: string): string {
  const escape = window.CSS?.escape
  if (typeof escape === 'function') return escape(value)
  return value.replace(/["'\\\0-\x1f]/g, (char: string) => '\\' + char)
}

/**
 * The assistant row that should stay outside the disclosure: the turn-tail
 * closing message when present, otherwise the live streaming row, otherwise
 * the last assistant in the turn. That row is the conclusion — no extra
 * model summary is required.
 */
export function closingAssistantKey(
  keys: readonly string[],
  getNode: (key: string) => ChatNodeLike | undefined,
  closingSeq: number | undefined,
): string | undefined {
  let last: string | undefined
  let running: string | undefined
  let matched: string | undefined
  for (const key of keys) {
    const node = getNode(key)
    if (node?.kind !== 'assistant-step') continue
    last = key
    const data = node.data as {
      status?: string
      finalNode?: { seq?: number }
    }
    if (data.status === 'running') running = key
    const seq = data.finalNode?.seq ?? node.anchorSeq
    if (closingSeq !== undefined && seq === closingSeq) matched = key
  }
  return matched ?? running ?? last
}

/**
 * True for a Chat node that belongs in the collapsed "worked" disclosure.
 */
export function isWorkNode(
  key: string,
  node: ChatNodeLike | undefined,
  closingAssistant: string | undefined,
): boolean {
  if (node === undefined) return false
  if (KEEP_VISIBLE.has(node.kind)) return false
  if (key === closingAssistant) return false
  return true
}

export function turnFromEvent(event: {
  data?: unknown
}): number | undefined {
  if (event.data === null || typeof event.data !== 'object') return undefined
  const turn = (event.data as { turn?: unknown }).turn
  return typeof turn === 'number' ? turn : undefined
}
