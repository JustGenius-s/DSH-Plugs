// Field-level primitives: the toggle, the field column/head/hint structure,
// the composed switch and number rows, and the field-adjacent buttons
// (reset, secondary action, dashed add slot).

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

/** Field column; sibling fields are divided by a hairline. */
export function Field(props: { children: ReactNode }) {
  ensureStyles()
  return <div className="dsh-ui-field">{props.children}</div>
}

/** Field head row: label on the left, optional action on the right. */
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

/** Caption line under a field head. */
export function FieldHint(props: { children: ReactNode }) {
  ensureStyles()
  return <p className="dsh-ui-hint">{props.children}</p>
}

/** A complete switch row: label, toggle, and an optional hint below. */
export function SwitchField(props: {
  id: string
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  ensureStyles()
  return (
    <Field>
      <FieldHead
        htmlFor={props.id}
        label={props.label}
        action={(
          <Switch
            id={props.id}
            label={props.label}
            checked={props.checked}
            disabled={props.disabled}
            onChange={props.onChange}
          />
        )}
      />
      {props.hint === undefined ? null : <FieldHint>{props.hint}</FieldHint>}
    </Field>
  )
}

/** A complete number row: label, fixed-width numeric input, optional hint. */
export function NumberField(props: {
  id: string
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step?: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  ensureStyles()
  return (
    <Field>
      <div className="dsh-ui-field-head">
        <label className="dsh-ui-label" htmlFor={props.id}>{props.label}</label>
        <input
          id={props.id}
          type="number"
          className="dsh-ui-number"
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          value={props.value}
          disabled={props.disabled}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (Number.isFinite(next)) props.onChange(next)
          }}
        />
      </div>
      {props.hint === undefined ? null : <FieldHint>{props.hint}</FieldHint>}
    </Field>
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
