// Inline elements: status tags, filter chips, the ghost icon button, the
// one-line notice, and the single-line command row.

import type { ReactNode } from 'react'
import { ensureStyles } from './styles'

/**
 * Status tag. The default pill carries a background (the inventory's
 * configTag); `variant="text"` is plain colored text for row metadata.
 */
export function Tag(props: {
  variant?: 'pill' | 'text'
  tone?: 'success' | 'strong' | 'business'
  children: ReactNode
}) {
  ensureStyles()
  return (
    <span
      className="dsh-ui-tag"
      data-variant={props.variant === 'text' ? 'text' : undefined}
      data-tone={props.tone}
    >
      {props.children}
    </span>
  )
}

/** Rounded filter chip; the active one takes the business color. */
export function FilterChip(props: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  ensureStyles()
  return (
    <button
      type="button"
      className="dsh-ui-chip"
      data-active={props.active ? 'true' : undefined}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

/** A group of FilterChips, announced as one labeled group. */
export function FilterChips(props: { label: string; children: ReactNode }) {
  ensureStyles()
  return (
    <div className="dsh-ui-filters" role="group" aria-label={props.label}>
      {props.children}
    </div>
  )
}

/** 28x28 ghost icon button with an active (business-colored) state. */
export function IconButton(props: {
  label: string
  title?: string
  active?: boolean
  expanded?: boolean
  hasPopup?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  ensureStyles()
  return (
    <button
      type="button"
      className="dsh-ui-icon-button"
      data-active={props.active === true ? 'true' : undefined}
      aria-label={props.label}
      title={props.title ?? props.label}
      aria-expanded={props.expanded}
      aria-haspopup={props.hasPopup === true ? 'menu' : undefined}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

/**
 * One-line notice under a form or row: `info` (secondary), `ok` (business),
 * `error` (error color, keeps line breaks).
 */
export function InlineNotice(props: {
  kind?: 'info' | 'ok' | 'error'
  role?: string
  children: ReactNode
}) {
  ensureStyles()
  return (
    <p className="dsh-ui-notice" data-kind={props.kind ?? 'info'} role={props.role}>
      {props.children}
    </p>
  )
}

/** Single-line command row: scrollable code with a right-edge action. */
export function CommandRow(props: {
  /** Visually hidden label naming the command for assistive tech. */
  label: string
  command: string
  /** Right-edge slot, e.g. a copy Button. */
  action?: ReactNode
}) {
  ensureStyles()
  return (
    <div className="dsh-ui-command">
      <span className="dsh-ui-command-label">{props.label}</span>
      <code>{props.command}</code>
      {props.action}
    </div>
  )
}
