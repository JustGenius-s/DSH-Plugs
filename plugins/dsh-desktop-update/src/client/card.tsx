// Settings card for the `desktop-update` namespace, rendered inside the
// Plugins section's configurable tab (rc.7+ keyed `settings.plugin.item`).
// Chrome mirrors the official PluginCard: collapsible header, staged edits,
// save/discard footer. Writes go through ctx.settingsScope (generic settings
// RPC → settings.yaml); DSH-Desktop's main process watches the same file, so
// both write paths converge. The version line + manual check ride the preload
// bridge and only appear inside the desktop shell. On hosts that do not serve
// the namespace (pre-rc.7, or a remote browser in memory mode) the card
// leaves no trace.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { bridge, type DesktopUpdateState } from './bridge'
import { ensureCardStyles } from './styles'

ensureCardStyles()

/** Shape of the `desktop-update` settings section (mirrors Config in src/index.ts). */
export interface DesktopUpdateConfig {
  checkApp: boolean
  checkDsh: boolean
}

/** Card props: locale `t` from the slot entry, scope from the entry's inject. */
export interface UpdateCardProps {
  t: (key: string) => string
  scope: SettingsScope<DesktopUpdateConfig>
}

function ChevronIcon(props: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={'dsh-du-chevron' + (props.open ? ' dsh-du-chevron-open' : '')}
    >
      <path
        d="M3.5 5.25 7 8.75l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function GateField(props: {
  id: string
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  onEdit: (enabled: boolean) => void
}) {
  return (
    <div className="dsh-du-field">
      <div className="dsh-du-field-head">
        <label className="dsh-du-label" htmlFor={props.id}>{props.label}</label>
        <input
          id={props.id}
          type="checkbox"
          role="switch"
          className="dsh-du-switch"
          checked={props.checked}
          disabled={props.disabled}
          onChange={(e) => props.onEdit(e.target.checked)}
        />
      </div>
      <p className="dsh-du-hint">{props.hint}</p>
    </div>
  )
}

export function UpdateCard(props: UpdateCardProps) {
  const { t, scope } = props
  const subscribe = useCallback((cb: () => void) => scope.subscribe(cb), [scope])
  const getSnapshot = useCallback(() => scope.getSnapshot(), [scope])
  const snap = useSyncExternalStore(subscribe, getSnapshot)

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DesktopUpdateConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const [state, setState] = useState<DesktopUpdateState | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    const b = bridge()
    if (b === undefined) return
    let alive = true
    void b.updates.getState().then((s) => { if (alive) setState(s) }).catch(() => {})
    const off = b.updates.onState((s) => { if (alive) setState(s) })
    return () => { alive = false; off() }
  }, [])

  // Namespace not served by this Host: render nothing rather than a dead card.
  if (snap.status === 'unavailable') return null

  const committed: DesktopUpdateConfig = snap.value ?? { checkApp: true, checkDsh: true }
  const staged = draft ?? committed
  const dirty = draft !== null
    && (draft.checkApp !== committed.checkApp || draft.checkDsh !== committed.checkDsh)
  const writable = snap.status === 'ready' && snap.writable
  const disabled = !writable || saving

  const edit = (field: keyof DesktopUpdateConfig, enabled: boolean): void => {
    setDraft({ ...staged, [field]: enabled })
  }

  const save = (): void => {
    if (!dirty) return
    setSaving(true)
    setFailed(false)
    void Promise.all([
      scope.set('checkApp', staged.checkApp),
      scope.set('checkDsh', staged.checkDsh),
    ])
      .then(() => { setDraft(null) })
      .catch(() => { setFailed(true) })
      .finally(() => { setSaving(false) })
  }

  const discard = (): void => { setDraft(null) }

  const checkNow = (): void => {
    const b = bridge()
    if (b === undefined) return
    setChecking(true)
    void b.updates.checkNow()
      .then((s) => setState(s))
      .catch(() => {})
      .finally(() => setChecking(false))
  }

  const versionText = (name: string, current: string, latest: string | undefined): string =>
    latest === undefined ? `${name} ${current}` : `${name} ${current} → ${latest}`

  const title = t('card.title')
  return (
    <li className={'dsh-du-card' + (open ? ' dsh-du-card-open' : '')}>
      <button
        type="button"
        className="dsh-du-header"
        aria-expanded={open}
        aria-label={`${t(open ? 'card.collapse' : 'card.expand')}: ${title}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className="dsh-du-headtext">
          <span className="dsh-du-name">{title}</span>
          <span className="dsh-du-description">{t('card.description')}</span>
        </span>
        {dirty ? <span className="dsh-du-pending">{t('card.unsaved')}</span> : null}
        <ChevronIcon open={open} />
      </button>
      {open
        ? (
          <div className="dsh-du-body">
            {!writable ? <p className="dsh-du-readonly" role="status">{t('card.readOnly')}</p> : null}
            {state !== null && (
              <div className="dsh-du-field">
                <div className="dsh-du-versions">
                  <span>
                    {[
                      state.versions.app !== ''
                        ? versionText(t('version.app'), state.versions.app, state.app?.latest)
                        : '',
                      state.versions.dsh !== null
                        ? versionText(t('version.dsh'), state.versions.dsh, state.dsh?.latest)
                        : '',
                    ].filter((s) => s !== '').join(' · ')}
                  </span>
                  <button
                    type="button"
                    className="dsh-du-check"
                    disabled={checking}
                    onClick={checkNow}
                  >
                    {checking ? t('action.checking') : t('action.check')}
                  </button>
                </div>
              </div>
            )}
            <GateField
              id="plugin-config-desktop-update-check-app"
              label={t('gate.app')}
              hint={t('gate.appHint')}
              checked={staged.checkApp}
              disabled={disabled}
              onEdit={(enabled) => { edit('checkApp', enabled) }}
            />
            <GateField
              id="plugin-config-desktop-update-check-dsh"
              label={t('gate.dsh')}
              hint={t('gate.dshHint')}
              checked={staged.checkDsh}
              disabled={disabled}
              onEdit={(enabled) => { edit('checkDsh', enabled) }}
            />
            <div className="dsh-du-footer">
              {failed ? <p className="dsh-du-failed" role="status">{t('card.saveFailed')}</p> : null}
              <button
                type="button"
                className="dsh-du-discard"
                disabled={!dirty || saving}
                onClick={discard}
              >
                {t('card.discard')}
              </button>
              <button
                type="button"
                className="dsh-du-save"
                disabled={!dirty || saving}
                onClick={save}
              >
                {t(saving ? 'card.saving' : 'card.save')}
              </button>
            </div>
          </div>
        )
        : null}
    </li>
  )
}
