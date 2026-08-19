// DSH-native UI primitives shared by the plugins in this monorepo. Every
// component pulls the official DSH look (design tokens, geometry, motion)
// from ./styles and self-injects it on first render, so consumers only pay
// a component import. These components cover the official settings/list
// chrome that @deepseek-ai/dsh-client-ui-primitives does not export
// (PluginCard, fields, inventory rows); anything the primitives package
// already ships (Button, Input, Menu, StateDot, ...) is used from there
// instead of being re-created here.

import type { ReactNode } from 'react'
import { ensureStyles, injectStyles } from './styles'

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

/** "Unsaved" pill riding a settings card header. */
export function PendingBadge(props: { children: ReactNode }) {
  ensureStyles()
  return <span className="dsh-ui-pending">{props.children}</span>
}

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

/** Settings tab column: the 760px container the official tabs render in. */
export function SettingsSection(props: { busy?: boolean; children: ReactNode }) {
  ensureStyles()
  return (
    <div
      className="dsh-ui-section"
      aria-busy={props.busy === true ? true : undefined}
    >
      {props.children}
    </div>
  )
}

/** Tertiary status line: loading, empty states, section hints. */
export function StatusText(props: { children: ReactNode }) {
  ensureStyles()
  return <p className="dsh-ui-status">{props.children}</p>
}

/** Load-failure row: error-colored text beside a retry action. */
export function FailureRow(props: { children: ReactNode }) {
  ensureStyles()
  return <div className="dsh-ui-failure">{props.children}</div>
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

export { ensureStyles, injectStyles }
