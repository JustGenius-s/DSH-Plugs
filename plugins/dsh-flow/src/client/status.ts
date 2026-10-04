import type { ReactElement } from 'react'
import {
  IconPauseOutline16,
  IconPlayOutline16,
  IconSkipOutline16,
  IconStopFill16,
} from '@just-genius/dsh-plugin-ui'
import type { NodeStatus } from '../shared.ts'
import type { NodeActionKind } from './actions.ts'

/** The icon components the card actions use: a `size` prop, nothing else. */
type IconComponent = (props: { size?: number | undefined; className?: string | undefined }) => ReactElement

/** Chinese labels for node status, shown on the card and in the legend. */
export const STATUS_LABEL: Record<NodeStatus, string> = {
  pending: '等待中',
  ready: '就绪',
  running: '执行中',
  expanded: '已展开',
  paused: '已暂停',
  done: '已完成',
  failed: '失败',
  skipped: '已跳过',
}

/** Chinese labels for the card's action buttons; also their tooltips. */
export const ACTION_LABEL: Record<NodeActionKind, string> = {
  skip: '跳过',
  cancel: '停止',
  pause: '暂停',
  resume: '继续',
}

/**
 * The icon behind each card action.
 *
 * Icon-only buttons need an accessible name, which `ACTION_LABEL` supplies as
 * both `aria-label` and `title`. Kept beside the label so adding an action
 * cannot land one without the other.
 */
export const ACTION_ICON: Record<NodeActionKind, IconComponent> = {
  skip: IconSkipOutline16,
  cancel: IconStopFill16,
  pause: IconPauseOutline16,
  resume: IconPlayOutline16,
}

/** Statuses that mean "this node will not run again". */
export const TERMINAL: readonly NodeStatus[] = ['done', 'skipped']

/** Statuses that mean a child agent owns this node right now. */
export const LIVE: readonly NodeStatus[] = ['running', 'paused']

/** Rough progress fraction for the header meter. */
export function progressOf(statuses: readonly NodeStatus[]): number {
  if (statuses.length === 0) return 0
  const settled = statuses.filter((status) => TERMINAL.includes(status)).length
  return settled / statuses.length
}
