// Settings card for the `desktop-update` namespace, rendered inside the
// Plugins section's configurable tab (`settings.plugin.item`).
// Chrome comes from @just-genius/dsh-plugin-ui (the official PluginCard look:
// collapsible header, staged edits, save/discard footer). Writes go through
// ctx.settingsScope (generic settings RPC → settings.yaml); DSH-Desktop's
// main process watches the same file, so both write paths converge. The
// version line + manual check ride the preload bridge and only appear inside
// the desktop shell. On hosts that do not serve the namespace (pre-rc.7, or
// a remote browser in memory mode) the card leaves no trace.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import { Menu, IconChevronDownOutline14 } from '@just-genius/dsh-plugin-ui'
import type { MenuEntry } from '@just-genius/dsh-plugin-ui'
import {
  ActionButton,
  CardFooter,
  DiscardButton,
  Field,
  FieldHead,
  FieldHint,
  InlineNotice,
  PendingBadge,
  SaveButton,
  SettingsCard,
  SwitchField,
} from '@just-genius/dsh-plugin-ui'
import { bridge, type DesktopUpdateState, type DshChannel } from './bridge'
import { ensureCardStyles } from './styles'

ensureCardStyles()

/** Shape of the `desktop-update` settings section (mirrors Config in src/index.ts). */
export interface DesktopUpdateConfig {
  checkApp: boolean
  checkDsh: boolean
  dshChannel?: DshChannel
  dshVersion?: string
}

/** Card props: locale `t` from the slot entry, scope from the entry's inject. */
export interface UpdateCardProps {
  t: (key: string) => string
  scope: SettingsScope<DesktopUpdateConfig>
}

const CHANNEL_OPTIONS: readonly { value: DshChannel; label: string }[] = [
  { value: 'latest', label: 'channel.latest' },
  { value: 'next', label: 'channel.next' },
  { value: 'custom', label: 'channel.custom' },
]

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
  const [channelOpen, setChannelOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'ok' | 'suppressed' | 'failed' | null>(null)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    const b = bridge()
    if (b === undefined) return
    let alive = true
    void b.updates.getState().then((s) => { if (alive) setState(s) }).catch(() => {})
    const off = b.updates.onState((s) => { if (alive) setState(s) })
    return () => { alive = false; off() }
  }, [])

  // 主进程广播的 updatingDsh 为准；本地 updating 兜底防连点。
  const busyUpdating = Boolean(state?.updatingDsh) || updating
  const needsRelaunch = Boolean(state?.needsRelaunch)
  const updateMessage = state?.updateMessage ?? null
  const canUpdateDsh = state?.dsh != null && !busyUpdating

  // Namespace not served by this Host: render nothing rather than a dead card.
  if (snap.status === 'unavailable') return null

  const committed: DesktopUpdateConfig = snap.value ?? {
    checkApp: true,
    checkDsh: true,
    dshChannel: 'latest',
    dshVersion: '',
  }
  const staged = draft ?? committed
  const channel = staged.dshChannel ?? 'latest'
  const dirty = draft !== null
    && (
      draft.checkApp !== committed.checkApp
      || draft.checkDsh !== committed.checkDsh
      || draft.dshChannel !== committed.dshChannel
      || draft.dshVersion !== committed.dshVersion
    )
  const writable = snap.status === 'ready' && snap.writable
  const disabled = !writable || saving

  const edit = (field: keyof DesktopUpdateConfig, value: DesktopUpdateConfig[keyof DesktopUpdateConfig]): void => {
    setDraft({ ...staged, [field]: value } as DesktopUpdateConfig)
  }

  const save = (): void => {
    if (!dirty) return
    setSaving(true)
    setFailed(false)
    void Promise.all([
      scope.set('checkApp', staged.checkApp),
      scope.set('checkDsh', staged.checkDsh),
      scope.set('dshChannel', staged.dshChannel ?? 'latest'),
      scope.set('dshVersion', staged.dshVersion ?? ''),
    ])
      .then(() => {
        setDraft(null)
        // 渠道变更后立即让主进程按新渠道重查一轮。
        const b = bridge()
        if (b !== undefined) {
          void b.updates
            .setDshChannel(staged.dshChannel ?? 'latest', staged.dshVersion ?? '')
            .then((s) => setState(s))
            .catch(() => {})
        }
      })
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

  const testNotify = (): void => {
    const b = bridge()
    if (b === undefined) return
    setTesting(true)
    setTestResult(null)
    void b.notify.show({
      contributor: 'desktop-update',
      id: 'test-notify',
      title: t('card.title'),
      body: t('action.testNotifyBody'),
    })
      .then((result) => {
        setTestResult(result?.shown === false ? 'suppressed' : 'ok')
      })
      .catch(() => { setTestResult('failed') })
      .finally(() => { setTesting(false) })
  }

  const updateDshNow = (): void => {
    const b = bridge()
    if (b === undefined || !canUpdateDsh) return
    setUpdating(true)
    void b.updates.updateDsh()
      .catch(() => {})
      .finally(() => { setUpdating(false) })
  }

  const relaunchNow = (): void => {
    bridge()?.updates.relaunch()
  }

  const versionText = (name: string, current: string, latest: string | undefined): string =>
    latest === undefined ? `${name} ${current}` : `${name} ${current} → ${latest}`

  const channelItems: readonly MenuEntry[] = CHANNEL_OPTIONS.map((option) => ({
    id: option.value,
    label: t(option.label),
  }))

  const title = t('card.title')
  return (
    <SettingsCard
      title={title}
      description={t('card.description')}
      open={open}
      onToggle={() => { setOpen(!open) }}
      toggleLabel={`${t(open ? 'card.collapse' : 'card.expand')}: ${title}`}
      pending={dirty ? <PendingBadge>{t('card.unsaved')}</PendingBadge> : undefined}
    >
      {!writable ? <p className="dsh-du-readonly" role="status">{t('card.readOnly')}</p> : null}
      {state !== null && (
        <Field>
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
            <ActionButton disabled={checking || busyUpdating} onClick={checkNow}>
              {checking ? t('action.checking') : t('action.check')}
            </ActionButton>
          </div>
          {(canUpdateDsh || busyUpdating || needsRelaunch || updateMessage !== null) && (
            <div className="dsh-du-update-row">
              <p
                className={
                  updateMessage !== null && updateMessage.startsWith('更新失败')
                    ? 'dsh-du-status dsh-du-status-error'
                    : 'dsh-du-status'
                }
                role="status"
              >
                {updateMessage
                  ?? (busyUpdating
                    ? t('status.updating')
                    : needsRelaunch
                      ? t('status.needsRelaunch')
                      : state.dsh
                        ? t('action.updateDsh') + ` → ${state.dsh.latest}`
                        : '')}
              </p>
              {needsRelaunch ? (
                <ActionButton onClick={relaunchNow}>{t('action.relaunch')}</ActionButton>
              ) : canUpdateDsh || busyUpdating ? (
                <ActionButton disabled={!canUpdateDsh} onClick={updateDshNow}>
                  {busyUpdating ? t('action.updatingDsh') : t('action.updateDsh')}
                </ActionButton>
              ) : null}
            </div>
          )}
        </Field>
      )}
      <Field>
        <div className="dsh-du-versions">
          <span>
            {testResult === 'ok'
              ? t('action.testNotifyDone')
              : testResult === 'suppressed'
                ? t('action.testNotifySuppressed')
                : testResult === 'failed'
                  ? t('action.testNotifyFailed')
                  : t('action.testNotifyBody')}
          </span>
          <ActionButton disabled={testing || busyUpdating} onClick={testNotify}>
            {testing ? t('action.checking') : t('action.testNotify')}
          </ActionButton>
        </div>
      </Field>
      <SwitchField
        id="plugin-config-desktop-update-check-app"
        label={t('gate.app')}
        hint={t('gate.appHint')}
        checked={staged.checkApp}
        disabled={disabled}
        onChange={(enabled) => { edit('checkApp', enabled) }}
      />
      <SwitchField
        id="plugin-config-desktop-update-check-dsh"
        label={t('gate.dsh')}
        hint={t('gate.dshHint')}
        checked={staged.checkDsh}
        disabled={disabled}
        onChange={(enabled) => { edit('checkDsh', enabled) }}
      />
      <Field>
        <div className="dsh-ui-field-head">
          <span className="dsh-ui-label">{t('channel.dsh')}</span>
          <Menu
            open={channelOpen}
            items={channelItems}
            selectedId={channel}
            onSelect={(value) => { edit('dshChannel', value as DshChannel) }}
            onClose={() => { setChannelOpen(false) }}
            align="end"
            side="bottom"
            portal
            anchor={(
              <button
                type="button"
                disabled={disabled}
                data-menu-open={channelOpen || undefined}
                onClick={() => { setChannelOpen((current) => !current) }}
                className="dsh-du-channel-trigger"
              >
                <span>{t(CHANNEL_OPTIONS.find((o) => o.value === channel)?.label ?? 'channel.latest')}</span>
                <IconChevronDownOutline14 />
              </button>
            )}
          />
        </div>
        <FieldHint>{t('channel.dshHint')}</FieldHint>
      </Field>
      {channel === 'custom' && (
        <Field>
          <FieldHead htmlFor="plugin-config-desktop-update-dsh-version" label={t('version.custom')} />
          <FieldHint>{t('version.customHint')}</FieldHint>
          <input
            id="plugin-config-desktop-update-dsh-version"
            className="dsh-du-input"
            type="text"
            inputMode="text"
            spellCheck={false}
            placeholder="0.1.0-rc.8"
            value={staged.dshVersion ?? ''}
            disabled={disabled}
            onChange={(event) => { edit('dshVersion', event.target.value.trim()) }}
          />
        </Field>
      )}
      {staged.checkDsh && (
        <InlineNotice kind="info">{t('channel.note')}</InlineNotice>
      )}
      <CardFooter>
        {failed ? <p className="dsh-du-failed" role="status">{t('card.saveFailed')}</p> : null}
        <DiscardButton disabled={!dirty || saving} onClick={discard}>
          {t('card.discard')}
        </DiscardButton>
        <SaveButton disabled={!dirty || saving} onClick={save}>
          {t(saving ? 'card.saving' : 'card.save')}
        </SaveButton>
      </CardFooter>
    </SettingsCard>
  )
}
