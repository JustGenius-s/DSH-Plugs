import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button, IconChevronDownOutline14, Input, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { clampPanelLauncherWidth, DEFAULT_CONFIG, PANEL_LAUNCHER_WIDTH_MAX, PANEL_LAUNCHER_WIDTH_MIN, type DshCodexConfig, type TerminalShell } from '../../shared/config'
import type { CodexKey } from '../locales'

export interface CodexSettingsInjected {
  scope: SettingsScope<DshCodexConfig>
  t: (key: CodexKey) => string
}

export type CodexSettingsSectionProps = Partial<CodexSettingsInjected>
type Field = keyof DshCodexConfig

function FieldRow(props: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: 16, minHeight: 36 }}>
      <span style={{ minWidth: 0 }}>{props.label}</span>
      {props.children}
    </div>
  )
}

function Group(props: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 8, padding: '16px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' }}>
      <h3 style={{ margin: 0, fontSize: 14, lineHeight: '20px' }}>{props.title}</h3>
      {props.children}
    </section>
  )
}

// 与官方 fields 开关（及 dsh-desktop-update 卡片里的复刻）逐 token 对齐，
// 保证所有插件设置页的 Switch 尺寸、配色、动效完全一致。
const SWITCH_STYLES = `
.dsh-codex-switch{appearance:none;margin:0;flex:none;width:32px;height:18px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);position:relative;cursor:pointer;transition:background .16s,border-color .16s}
.dsh-codex-switch::after{content:'';position:absolute;top:1px;left:1px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary);transition:transform .16s,background .16s}
.dsh-codex-switch:checked{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dsh-codex-switch:checked::after{transform:translateX(14px);background:var(--dsw-alias-bg-layer-3,#fff)}
.dsh-codex-switch:hover:not(:disabled):not(:checked){border-color:var(--dsw-alias-label-dimmed)}
.dsh-codex-switch:disabled{opacity:.4;cursor:default}
.dsh-codex-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
`

function ensureSwitchStyles() {
  if (typeof document === 'undefined') return
  if (document.head.querySelector('style[data-dsh-codex-switch]')) return
  const el = document.createElement('style')
  el.setAttribute('data-dsh-codex-switch', '')
  el.textContent = SWITCH_STYLES
  document.head.appendChild(el)
}

function SettingToggle(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const { label, checked, onChange } = props
  ensureSwitchStyles()
  return (
    <input
      type="checkbox"
      role="switch"
      aria-label={label}
      className="dsh-codex-switch"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  )
}

function ShellMenu(props: { label: string; value: TerminalShell; t: (key: CodexKey) => string; onChange: (value: TerminalShell) => void }) {
  const { label, value, t, onChange } = props
  const [open, setOpen] = useState(false)
  const items: readonly MenuItem[] = [
    { id: 'auto', label: t('terminalShellAuto') },
    { id: 'bash', label: t('terminalShellBash') },
    { id: 'zsh', label: t('terminalShellZsh') },
  ]
  const selectedLabel = items.find(item => item.id === value)?.label ?? value

  return (
    <Menu
      open={open}
      items={items}
      selectedId={value}
      onSelect={id => {
        onChange(id as TerminalShell)
        setOpen(false)
      }}
      onClose={() => setOpen(false)}
      align="end"
      side="bottom"
      portal
      anchor={(
        <Button
          type="button"
          size="sm"
          variant="toolbar"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(current => !current)}
          style={{ minWidth: 116, justifyContent: 'space-between', gap: 8 }}
        >
          <span>{selectedLabel}</span>
          <IconChevronDownOutline14 aria-hidden="true" />
        </Button>
      )}
    />
  )
}

function NumberField(props: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return (
    <Input
      type="number"
      aria-label={props.label}
      min={props.min}
      max={props.max}
      step={props.step}
      value={props.value}
      onChange={event => props.onChange(Number(event.currentTarget.value))}
      style={{ width: 96, textAlign: 'right' }}
    />
  )
}

function SettingsBody(props: CodexSettingsInjected) {
  const { scope, t } = props
  const snapshot = useSyncExternalStore(
    listener => scope.subscribe(listener),
    () => scope.getSnapshot(),
    () => scope.getSnapshot(),
  )
  const value = { ...DEFAULT_CONFIG, ...snapshot.value }

  const set = <K extends Field>(field: K, next: DshCodexConfig[K]): void => {
    void scope.set(field, next)
  }

  return (
    <div style={{ maxWidth: 640, padding: '4px 0 24px' }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 20, lineHeight: '28px' }}>{t('title')}</h2>
      <p style={{ margin: '0 0 12px', color: 'var(--dsw-alias-label-secondary)', lineHeight: '20px' }}>{t('description')}</p>
      {snapshot.status === 'loading' ? <p style={{ color: 'var(--dsw-alias-label-secondary)' }}>{t('statusLoading')}</p> : null}
      {snapshot.status === 'unavailable' ? <p style={{ color: 'var(--dsw-alias-label-secondary)' }}>{t('statusUnavailable')}</p> : null}

      <Group title={t('groupNavigator')}>
        <FieldRow label={t('navigatorEnabled')}>
          <SettingToggle label={t('navigatorEnabled')} checked={value.navigatorEnabled} onChange={next => set('navigatorEnabled', next)} />
        </FieldRow>
        <FieldRow label={t('conversationCollapseEnabled')}>
          <SettingToggle label={t('conversationCollapseEnabled')} checked={value.conversationCollapseEnabled} onChange={next => set('conversationCollapseEnabled', next)} />
        </FieldRow>
      </Group>

      <Group title={t('groupPanel')}>
        <FieldRow label={t('panelLauncherWidth')}>
          <NumberField label={t('panelLauncherWidth')} min={PANEL_LAUNCHER_WIDTH_MIN} max={PANEL_LAUNCHER_WIDTH_MAX} step={10} value={value.panelLauncherWidth} onChange={next => set('panelLauncherWidth', clampPanelLauncherWidth(next))} />
        </FieldRow>
        <FieldRow label={t('panelDefaultWidth')}>
          <NumberField label={t('panelDefaultWidth')} min={300} max={720} step={10} value={value.panelDefaultWidth} onChange={next => set('panelDefaultWidth', next)} />
        </FieldRow>
        <FieldRow label={t('panelMaxWidth')}>
          <NumberField label={t('panelMaxWidth')} min={300} max={720} step={10} value={value.panelMaxWidth} onChange={next => set('panelMaxWidth', next)} />
        </FieldRow>
        <FieldRow label={t('panelRememberTabs')}>
          <SettingToggle label={t('panelRememberTabs')} checked={value.panelRememberTabs} onChange={next => set('panelRememberTabs', next)} />
        </FieldRow>
      </Group>

      <Group title={t('groupGitGraph')}>
        <FieldRow label={t('gitGraphEnabled')}>
          <SettingToggle label={t('gitGraphEnabled')} checked={value.gitGraphEnabled} onChange={next => set('gitGraphEnabled', next)} />
        </FieldRow>
      </Group>

      <Group title={t('groupTerminal')}>
        <FieldRow label={t('terminalEnabled')}>
          <SettingToggle label={t('terminalEnabled')} checked={value.terminalEnabled} onChange={next => set('terminalEnabled', next)} />
        </FieldRow>
        <FieldRow label={t('terminalShell')}>
          <ShellMenu label={t('terminalShell')} value={value.terminalShell} t={t} onChange={next => set('terminalShell', next)} />
        </FieldRow>
        <FieldRow label={t('terminalScrollback')}>
          <NumberField label={t('terminalScrollback')} min={500} max={20000} step={500} value={value.terminalScrollback} onChange={next => set('terminalScrollback', next)} />
        </FieldRow>
        <FieldRow label={t('terminalFontSize')}>
          <NumberField label={t('terminalFontSize')} min={10} max={24} step={1} value={value.terminalFontSize} onChange={next => set('terminalFontSize', next)} />
        </FieldRow>
      </Group>

      <p style={{ margin: '16px 0 0', color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px' }}>{t('scaffoldNote')}</p>
    </div>
  )
}

export function CodexSettingsSection(props: CodexSettingsSectionProps) {
  if (props.scope === undefined || props.t === undefined) return null
  return <SettingsBody scope={props.scope} t={props.t} />
}
