// The Computer Use driver block: TCC permission state, with the action living on
// the state itself instead of a row of permanent buttons.
//
// Why this shape:
// - A granted permission needs no action, so its row stays plain text. Only a
//   row that is NOT granted becomes a button that opens the right pane — the
//   action appears exactly where the problem is, and nowhere else.
// - macOS applies a TCC grant to the *next* process, so a daemon started before
//   the user ticked the boxes keeps answering with the old state. That is why the
//   restart offer appears only while something is unresolved.
// - Refreshing is automatic: the user leaves for System Settings and comes back,
//   so the block re-probes on window focus rather than asking for a Refresh click.

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@just-genius/dsh-plugin-ui'
import type { DriverView, PermissionState } from '../shared.ts'
import { driverBlockVisible, driverRestartOffered, driverRows } from '../view-state.ts'
import type { ComputerToolsKey } from './locales.ts'
import styles from './DriverStatus.module.css'

type Translate = (key: ComputerToolsKey) => string

export interface DriverStatusProps {
  driver: DriverView
  translate: Translate
  /** Disable actions while another write is in flight. */
  busy: boolean
  restarting: boolean
  onOpenPrivacy: (pane: 'accessibility' | 'screen') => void
  onRestart: () => void
  /** Re-probe; also called automatically when the window regains focus. */
  onRefresh: () => void
}

export function DriverStatus(props: DriverStatusProps): ReactNode {
  const { driver, translate, onRefresh } = props
  const rows = driverRows(driver)
  const restartOffered = driverRestartOffered(driver)
  const disabled = props.busy || props.restarting

  // Coming back from System Settings is the moment the answer can have changed.
  const refreshRef = useRef(onRefresh)
  refreshRef.current = onRefresh
  useEffect(() => {
    const sync = () => { refreshRef.current() }
    window.addEventListener('focus', sync)
    return () => window.removeEventListener('focus', sync)
  }, [])

  if (!driverBlockVisible(driver)) return null

  return (
    <div className={styles.block}>
      {rows.length === 0 ? null : (
        <ul className={styles.rows}>
          {rows.map((row) => (
            <PermissionRow
              key={row.pane}
              label={translate(row.pane === 'accessibility' ? 'permAccessibility' : 'permScreenRecording')}
              state={row.state}
              actionable={row.actionable}
              disabled={disabled}
              translate={translate}
              onOpen={() => props.onOpenPrivacy(row.pane)}
            />
          ))}
        </ul>
      )}
      {/* The restart offer travels with the unresolved state, not every load. */}
      {restartOffered ? (
        <div className={styles.hint}>
          <span>{translate('permissionStaleHint')}</span>
          <Button size="sm" variant="outline" disabled={disabled} onClick={props.onRestart}>
            {props.restarting ? translate('restartingDriver') : translate('restartDriver')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function PermissionRow(props: {
  label: string
  state: PermissionState
  actionable: boolean
  disabled: boolean
  translate: Translate
  onOpen: () => void
}): ReactNode {
  const { label, state, translate } = props
  const stateLabel = state === 'granted'
    ? translate('permGranted')
    : state === 'denied'
      ? translate('permDenied')
      : translate('permUnknown')

  // Granted needs nothing, so it stays plain text: no button to ignore.
  if (!props.actionable) {
    return (
      <li className={styles.row}>
        <span className={styles.name}>{label}</span>
        <span className={styles.state} data-state={state}>{stateLabel}</span>
      </li>
    )
  }

  // Unresolved: the whole row is the affordance for fixing it.
  return (
    <li className={styles.row}>
      <button
        type="button"
        className={styles.rowAction}
        disabled={props.disabled}
        aria-label={`${label} · ${stateLabel} · ${translate('permOpenSettings')}`}
        onClick={props.onOpen}
      >
        <span className={styles.name}>{label}</span>
        <span className={styles.state} data-state={state}>{stateLabel}</span>
        <span className={styles.go}>{translate('permOpenSettings')}</span>
      </button>
    </li>
  )
}
