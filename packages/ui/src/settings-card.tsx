// Settings-card chrome: the collapsible PluginCard shell, its pending badge,
// and the save/discard footer.

import type { ReactNode } from 'react'
import { ensureStyles } from './styles'
import { Chevron } from './tree'

/** "Unsaved" pill riding a settings card header. */
export function PendingBadge(props: { children: ReactNode }) {
  ensureStyles()
  return <span className="dsh-ui-pending">{props.children}</span>
}

/**
 * Collapsible settings card (the official PluginCard chrome): a header with
 * title, description, an optional pending badge and a chevron; the body
 * renders only while open.
 */
export function SettingsCard(props: {
  title: string
  description?: string
  open: boolean
  onToggle: () => void
  /** aria-label for the header toggle; defaults to the title. */
  toggleLabel?: string
  /** Header slot between the description and the chevron, e.g. PendingBadge. */
  pending?: ReactNode
  children?: ReactNode
}) {
  ensureStyles()
  return (
    <li className="dsh-ui-card" data-open={props.open ? 'true' : 'false'}>
      <button
        type="button"
        className="dsh-ui-card-header"
        aria-expanded={props.open}
        aria-label={props.toggleLabel ?? props.title}
        onClick={props.onToggle}
      >
        <span className="dsh-ui-card-headtext">
          <span className="dsh-ui-card-name">{props.title}</span>
          {props.description === undefined
            ? null
            : <span className="dsh-ui-card-desc">{props.description}</span>}
        </span>
        {props.pending}
        <Chevron open={props.open} />
      </button>
      {props.open
        ? <div className="dsh-ui-card-body">{props.children}</div>
        : null}
    </li>
  )
}

/** Right-aligned card footer with a top divider, hosting save/discard. */
export function CardFooter(props: { children: ReactNode }) {
  ensureStyles()
  return <div className="dsh-ui-footer">{props.children}</div>
}

/** Outlined discard button for a CardFooter. */
export function DiscardButton(props: {
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  ensureStyles()
  return (
    <button
      type="button"
      className="dsh-ui-discard"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

/** Solid save button for a CardFooter. */
export function SaveButton(props: {
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  ensureStyles()
  return (
    <button
      type="button"
      className="dsh-ui-save"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}
