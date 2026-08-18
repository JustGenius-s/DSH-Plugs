// DSH-native UI primitives shared by the plugins in this monorepo. Every
// component pulls the official DSH look (design tokens, geometry, motion)
// from ./styles and self-injects it on first render, so consumers only pay
// a component import.

import type { ReactNode } from 'react'
import { ensureStyles } from './styles'

/** Toggle switch matching the official fields switch (32x18, sliding knob). */
export function Switch(props: {
  id?: string
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  ensureStyles()
  return (
    <input
      id={props.id}
      type="checkbox"
      role="switch"
      aria-label={props.label}
      className="dsh-ui-switch"
      checked={props.checked}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.target.checked)}
    />
  )
}

/** Field head row: label on the left, optional action (e.g. ResetButton) right. */
export function FieldHead(props: {
  htmlFor?: string
  label: string
  action?: ReactNode
}) {
  ensureStyles()
  return (
    <div className="dsh-ui-field-head">
      <label className="dsh-ui-label" htmlFor={props.htmlFor}>{props.label}</label>
      {props.action}
    </div>
  )
}

/** Text-only reset/clear button for a field head's right edge. */
export function ResetButton(props: {
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  ensureStyles()
  return (
    <button
      type="button"
      className="dsh-ui-reset"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

/** Bordered rectangular secondary action, e.g. "test connection". */
export function ActionButton(props: {
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  ensureStyles()
  return (
    <button
      type="button"
      className="dsh-ui-action"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

/** Dashed full-row "add" slot closing a list, e.g. "add credential". */
export function AddButton(props: {
  disabled?: boolean
  icon?: ReactNode
  onClick: () => void
  children: ReactNode
}) {
  ensureStyles()
  return (
    <button
      type="button"
      className="dsh-ui-add"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.icon}
      {props.children}
    </button>
  )
}

/** Status tag, e.g. "installed" (on) vs "not installed" (off). */
export function Tag(props: { on: boolean; children: ReactNode }) {
  ensureStyles()
  return (
    <span className="dsh-ui-tag" data-on={props.on ? 'true' : 'false'}>
      {props.children}
    </span>
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

export { ensureStyles }
