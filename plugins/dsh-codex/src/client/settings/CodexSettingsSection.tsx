import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button, IconChevronDownOutline14, Input, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { DEFAULT_CONFIG, type DshCodexConfig, type TerminalShell } from '../../shared/config'
import type { CodexKey } from '../locales'
import { clearLocalOverride, getLocalOverrides, setLocalOverride, subscribeLocalOverrides } from '../config/local-preferences'

export interface CodexSettingsInjected {
  scope: SettingsScope<DshCodexConfig>
  t: (key: CodexKey) => string
}

export type CodexSettingsSectionProps = Partial<CodexSettingsInjected>
type Field = keyof DshCodexConfig

const CONFIG_FIELDS: readonly Field[] = [
  'navigatorEnabled',
  'terminalEnabled',
  'terminalShell',
  'terminalScrollback',
  'terminalFontSize',
  'panelDefaultWidth',
  'panelRememberTabs',
]

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

function SettingToggle(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const { label, checked, onChange } = props
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: checked ? 'flex-end' : 'flex-start',
        flex: '0 0 auto',
        width: 36,
        height: 20,
        padding: 2,
        border: 'none',
        borderRadius: 999,
        background: checked ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-bg-layer-3)',
        cursor: 'pointer',
        transition: 'background 120ms ease',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'block',
          width: 16,
          height: 16,
          borderRadius: 999,
          background: 'var(--dsw-alias-bg-base, #ffffff)',
          boxShadow: '0 1px 2px rgba(0, 0, 0, .18)',
        }}
      />
    </button>
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
  const localOverrides = useSyncExternalStore(
    subscribeLocalOverrides,
    getLocalOverrides,
    getLocalOverrides,
  )
  const value = { ...DEFAULT_CONFIG, ...snapshot.value, ...localOverrides }

  useEffect(() => {
    if (snapshot.value === undefined) return
    for (const field of CONFIG_FIELDS) {
      if (localOverrides[field] !== undefined && Object.is(localOverrides[field], snapshot.value[field])) {
        clearLocalOverride(field)
      }
    }
  }, [localOverrides, snapshot.value])

  const set = <K extends Field>(field: K, next: DshCodexConfig[K]): void => {
    setLocalOverride(field, next)
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
      </Group>

      <Group title={t('groupPanel')}>
        <FieldRow label={t('panelDefaultWidth')}>
          <NumberField label={t('panelDefaultWidth')} min={300} max={520} step={10} value={value.panelDefaultWidth} onChange={next => set('panelDefaultWidth', next)} />
        </FieldRow>
        <FieldRow label={t('panelRememberTabs')}>
          <SettingToggle label={t('panelRememberTabs')} checked={value.panelRememberTabs} onChange={next => set('panelRememberTabs', next)} />
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
