import type { NodeStatus } from '../shared.ts'

/** Chinese labels for node status, shown on the card and in the legend. */
export const STATUS_LABEL: Record<NodeStatus, string> = {
  pending: '等待中',
  ready: '就绪',
  running: '执行中',
  expanded: '已展开',
  done: '已完成',
  failed: '失败',
  skipped: '已跳过',
}

/** Statuses that mean "this node will not run again". */
export const TERMINAL: readonly NodeStatus[] = ['done', 'skipped']

/** Rough progress fraction for the header meter. */
export function progressOf(statuses: readonly NodeStatus[]): number {
  if (statuses.length === 0) return 0
  const settled = statuses.filter((status) => TERMINAL.includes(status)).length
  return settled / statuses.length
}
