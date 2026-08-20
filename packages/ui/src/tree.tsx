// Tree and list chrome: the disclosure chevron, the expandable inventory
// row, and the grouped tree containers (group head, indent, sub-name).

import type { ReactNode } from 'react'
import { ensureStyles } from './styles'

/**
 * The 14px disclosure chevron. `point="down"` rests pointing down and rotates
 * 180° when open (settings cards); `point="right"` rests pointing right and
 * rotates 90° (tree groups and expandable rows).
 */
export function Chevron(props: {
  open: boolean
  point?: 'down' | 'right'
  className?: string
}) {
  ensureStyles()
  const point = props.point ?? 'down'
  const path = point === 'down'
    ? 'M3.5 5.25 7 8.75l3.5-3.5'
    : 'M5.25 3.5 8.75 7l-3.5 3.5'
  const className = props.className === undefined
    ? 'dsh-ui-chevron'
    : `dsh-ui-chevron ${props.className}`
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={className}
      data-open={props.open ? 'true' : 'false'}
      data-point={point}
    >
      <path
        d={path}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** List wrapper for ExpandableRow items. */
export function RowList(props: { children: ReactNode }) {
  ensureStyles()
  return <ul className="dsh-ui-rows">{props.children}</ul>
}

/**
 * Expandable row card (the plugin inventory row): a head button with a
 * right-pointing chevron, a name/summary title block, a right-edge meta slot,
 * and a divided body that renders only while open.
 */
export function ExpandableRow(props: {
  open: boolean
  onToggle: () => void
  /** aria-label for the head toggle, e.g. "expand: name". */
  toggleLabel: string
  name: ReactNode
  /** title attribute for the name line (hover text for truncated names). */
  nameTitle?: string
  summary?: ReactNode
  /** Clamp the summary to one (default) or two lines. */
  summaryLines?: 1 | 2
  /** Right-edge slot: tags, state dots, primary actions. */
  meta?: ReactNode
  /** Error-tinted border, for rows reporting a conflict. */
  conflict?: boolean
  children?: ReactNode
}) {
  ensureStyles()
  return (
    <li
      className="dsh-ui-row"
      data-open={props.open ? 'true' : 'false'}
      data-conflict={props.conflict === true ? 'true' : undefined}
    >
      <div className="dsh-ui-row-head">
        <button
          type="button"
          className="dsh-ui-row-main"
          aria-expanded={props.open}
          aria-label={props.toggleLabel}
          onClick={props.onToggle}
        >
          <Chevron open={props.open} point="right" className="dsh-ui-row-chevron" />
          <span className="dsh-ui-row-titles">
            <span className="dsh-ui-row-name" title={props.nameTitle}>
              {props.name}
            </span>
            {props.summary === undefined || props.summary === null
              ? null
              : (
                <span
                  className="dsh-ui-row-summary"
                  data-lines={props.summaryLines === 2 ? '2' : undefined}
                >
                  {props.summary}
                </span>
              )}
          </span>
        </button>
        {props.meta === undefined || props.meta === null
          ? null
          : <div className="dsh-ui-row-meta">{props.meta}</div>}
      </div>
      {props.open
        ? <div className="dsh-ui-row-body">{props.children}</div>
        : null}
    </li>
  )
}

/** Vertical stack of TreeGroup sections. */
export function Tree(props: { children: ReactNode }) {
  ensureStyles()
  return <div className="dsh-ui-tree">{props.children}</div>
}

/**
 * One tree section with a head row. With `onToggle` the head is an
 * expand/collapse button with a chevron and an optional actions slot (the
 * marketplace source head); without it the head is a static title-plus-count
 * line (the manage tab's origin head).
 */
export function TreeGroup(props: {
  title: string
  count?: number
  open?: boolean
  onToggle?: () => void
  /** aria-label for the toggle head; defaults to the title. */
  toggleLabel?: string
  /** Right-edge slot of a toggle head, e.g. filter and link IconButtons. */
  actions?: ReactNode
  children?: ReactNode
}) {
  ensureStyles()
  const head = props.onToggle === undefined
    ? (
      <div className="dsh-ui-tgroup-static">
        <h3 className="dsh-ui-tgroup-title">{props.title}</h3>
        {props.count === undefined
          ? null
          : <span className="dsh-ui-tgroup-count">{props.count}</span>}
      </div>
    )
    : (
      <div className="dsh-ui-tgroup-head">
        <button
          type="button"
          className="dsh-ui-tgroup-toggle"
          aria-expanded={props.open}
          aria-label={props.toggleLabel ?? props.title}
          onClick={props.onToggle}
        >
          <Chevron open={props.open === true} point="right" />
          <span className="dsh-ui-tgroup-title">{props.title}</span>
          {props.count === undefined
            ? null
            : <span className="dsh-ui-tgroup-count">{props.count}</span>}
        </button>
        {props.actions === undefined || props.actions === null
          ? null
          : <div className="dsh-ui-tgroup-actions">{props.actions}</div>}
      </div>
    )
  return <section className="dsh-ui-tgroup">{head}{props.children}</section>
}

/** Left-border indented container nesting sub-groups under a TreeGroup. */
export function TreeIndent(props: { children: ReactNode }) {
  ensureStyles()
  return <div className="dsh-ui-indent">{props.children}</div>
}

/** Sub-group caption inside a TreeIndent. */
export function TreeSubName(props: { children: ReactNode }) {
  ensureStyles()
  return <h4 className="dsh-ui-subname">{props.children}</h4>
}
