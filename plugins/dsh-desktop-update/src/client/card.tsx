// Settings card for the `desktop-update` namespace, rendered inside the
// Plugins section's configurable tab (`settings.plugin.item`).
// Chrome comes from @just-genius/dsh-plugin-ui (the official PluginCard look:
// collapsible header, staged edits, save/discard footer). Writes go through
// ctx.settingsScope (generic settings RPC → settings.yaml).
//
// The version line and the update actions read state from this plugin's Host
// half (detection lives there now), not from the preload bridge. Executing an
// update still goes through the shell, because only it can run `pnpm add`,
// open the download page, and relaunch — but the outcome is reported back to
// the Host so every window sees the same progress. Everything degrades
// gracefully: without a shell the actions hide, and without a Host-served
// namespace the card leaves no trace.

import { useCallback, useState, useSyncExternalStore } from 'react'
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
import { bridge } from './bridge'
import type { UpdateStore } from './update-store'
import type { DesktopUpdateConfig, DshChannel } from '../shared'
import { ensureCardStyles } from './styles'

ensureCardStyles()

/** Card props: locale `t` from the slot entry, scope from the entry's inject. */
export interface UpdateCardProps {
  t: (key: string) => string
  scope: SettingsScope<DesktopUpdateConfig>
  /** Shared Host-state feed (see update-store.ts). */
  store: UpdateStore
}

const CHANNEL_OPTIONS: readonly { value: DshChannel; label: string }[] = [
  { value: 'latest', label: 'channel.latest' },
  { value: 'next', label: 'channel.next' },
  { value: 'alpha', label: 'channel.alpha' },
  { value: 'custom', label: 'channel.custom' },
]

export function UpdateCard(props: UpdateCardProps) {
  const { t, scope, store } = props
  const subscribe = useCallback((cb: () => void) => scope.subscribe(cb), [scope])
  const getSnapshot = useCallback(() => scope.getSnapshot(), [scope])
  const snap = useSyncExternalStore(subscribe, getSnapshot)

  const subscribeStore = useCallback((cb: () => void) => store.subscribe(() => { cb() }), [store])
  const getStoreSnapshot = useCallback(() => store.get(), [store])

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DesktopUpdateConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  // Detection is Host-side; `state` is the Host's published snapshot, shared
  // with the native seats. The Host refreshes on its own interval and on
  // demand, so consumers only have to keep up.
  const state = useSyncExternalStore(subscribeStore, getStoreSnapshot)
  const [checking, setChecking] = useState(false)
  const [channelOpen, setChannelOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'ok' | 'suppressed' | 'failed' | null>(null)
  const [updating, setUpdating] = useState(false)

  // Host 广播的 updatingDsh 为准；本地 updating 兜底防连点。
  const busyUpdating = Boolean(state.updatingDsh) || updating
  const checkingNow = checking || state.checking
  const needsRelaunch = state.needsRelaunch
  const updateMessage = state.updateMessage
  const canUpdateDsh = state.dsh !== null && !busyUpdating

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
        // 无需再通知主进程改渠道：Host 半侧自己 watch 这个 settings 命名空间，
        // 配置提交后会自动按新渠道重查一轮。
        store.checkNow()
      })
      .catch(() => { setFailed(true) })
      .finally(() => { setSaving(false) })
  }

  const discard = (): void => { setDraft(null) }

  const runCheck = (): void => {
    if (checkingNow) return
    setChecking(true)
    store.checkNow()
    // 给 Host 一个检测窗口再松开按钮；结果由下一次轮询带回。
    window.setTimeout(() => { setChecking(false) }, 1500)
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

  // 执行仍然必须过壳（只有它能跑 pnpm add / 开下载页 / 重启），但结果回报给
  // Host：进度跨窗口一致，刷新页面也不会丢。
  const updateDshNow = (): void => {
    const target = state.dsh?.latest
    if (target === undefined || !canUpdateDsh) return
    setUpdating(true)
    void store.updateDsh(target).finally(() => { setUpdating(false) })
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
      {(state.shell || state.versions.dsh !== null) && (
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
            <ActionButton disabled={checkingNow || busyUpdating} onClick={runCheck}>
              {checkingNow ? t('action.checking') : t('action.check')}
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
      {!state.shell && (state.app !== null || state.dsh !== null) ? (
        <Field>
          <FieldHint>{t('card.noShellHint')}</FieldHint>
        </Field>
      ) : null}
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
