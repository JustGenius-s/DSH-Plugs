// Page-level conventions: the column settings tabs render in, the tertiary
// status line, and the load-failure row.

import type { ReactNode } from 'react'
import { ensureStyles } from './styles'

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
