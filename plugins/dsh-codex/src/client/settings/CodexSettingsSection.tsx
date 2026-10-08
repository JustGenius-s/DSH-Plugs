import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button, IconChevronDownOutline14, Input, Menu } from '@just-genius/dsh-plugin-ui'
import type { MenuItem } from '@just-genius/dsh-plugin-ui'
import type { SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import { Switch } from '@just-genius/dsh-plugin-ui'
import { HIGHLIGHT_THEME_OPTIONS, type HighlightThemeKind } from '../features/files/themes'
import {
  clampFullSessionLoadLimit,
  DEFAULT_CONFIG,
  DEFAULT_VOICE_SHORTCUT,
  FULL_SESSION_LOAD_LIMIT_MAX,
  FULL_SESSION_LOAD_LIMIT_MIN,
  type DshCodexConfig,
  type StickyUserBubbleMode,
  type TerminalShell,
} from '../../shared/config'
import type { CodexKey } from '../locales'
import { FontSettings } from './FontSettings'
import { captureVoiceShortcut, formatVoiceShortcut } from '../features/voice-input/shortcut'

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

/** When the pinned question bubble is shown; only offered while pinning is on. */
function StickyModeMenu(props: {
  label: string
  value: StickyUserBubbleMode
  t: (key: CodexKey) => string
  onChange: (value: StickyUserBubbleMode) => void
}) {
  const { label, value, t, onChange } = props
  const [open, setOpen] = useState(false)
  const items: readonly MenuItem[] = [
    { id: 'running', label: t('sticky.modeRunning') },
    { id: 'always', label: t('sticky.modeAlways') },
  ]
  const selectedLabel = items.find(item => item.id === value)?.label ?? value

  return (
    <Menu
      open={open}
      items={items}
      selectedId={value}
      onSelect={id => {
        onChange(id as StickyUserBubbleMode)
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

function HighlightThemeMenu(props: {
  label: string
  kind: HighlightThemeKind
  value: string
  onChange: (value: string) => void
}) {
  const { label, kind, value, onChange } = props
  const [open, setOpen] = useState(false)
  const items: readonly MenuItem[] = HIGHLIGHT_THEME_OPTIONS
    .filter(option => option.kind === kind)
    .map(option => ({ id: option.id, label: option.label }))
  const selectedLabel = items.find(item => item.id === value)?.label ?? value

  return (
    <Menu
      open={open}
      items={items}
      selectedId={value}
      onSelect={id => {
        onChange(id)
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
          style={{ minWidth: 180, justifyContent: 'space-between', gap: 8 }}
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

function VoiceShortcutField(props: {
  value: string
  onChange: (value: string) => void
  t: (key: CodexKey) => string
}) {
  const { value, onChange, t } = props
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<CodexKey | undefined>()
  const mac = navigator.platform.toLowerCase().includes('mac')

  useEffect(() => {
    if (!listening) return
    const capture = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      const result = captureVoiceShortcut(event, mac)
      if (result.kind === 'captured') {
        onChange(result.binding)
        setListening(false)
        setError(undefined)
      } else if (result.kind === 'cancel') {
        setListening(false)
        setError(undefined)
      } else if (result.kind === 'invalid' || result.kind === 'reserved') {
        setError(result.kind === 'invalid' ? 'voiceShortcutInvalid' : 'voiceShortcutReserved')
      }
    }
    window.addEventListener('keydown', capture, true)
    return () => window.removeEventListener('keydown', capture, true)
  }, [listening, mac, onChange])

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
        <Button
          type="button"
          size="sm"
          variant="toolbar"
          aria-label={t('voiceShortcut')}
          onClick={() => { setListening(current => !current); setError(undefined) }}
          onBlur={() => setListening(false)}
          style={{ minWidth: 128 }}
        >
          {listening ? t('voiceShortcutCapture') : formatVoiceShortcut(value, mac)}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="toolbar"
          onClick={() => { onChange(DEFAULT_VOICE_SHORTCUT); setError(undefined) }}
        >
          {t('voiceShortcutReset')}
        </Button>
      </div>
      {error ? <small role="status" style={{ color: 'var(--dsw-alias-state-error-primary)', textAlign: 'right' }}>{t(error)}</small> : null}
    </div>
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

      <Group title={t('groupFonts')}>
        <FontSettings scope={scope} value={value} writable={snapshot.status === 'ready' && snapshot.writable} t={t} />
      </Group>

      <Group title={t('groupConversation')}>
        <FieldRow label={t('longMessageCollapseEnabled')}>
          <Switch label={t('longMessageCollapseEnabled')} checked={value.longMessageCollapseEnabled} onChange={next => set('longMessageCollapseEnabled', next)} />
        </FieldRow>
        <FieldRow label={t('stickyUserBubbleEnabled')}>
          <Switch label={t('stickyUserBubbleEnabled')} checked={value.stickyUserBubbleEnabled} onChange={next => set('stickyUserBubbleEnabled', next)} />
        </FieldRow>
        {value.stickyUserBubbleEnabled
          ? (
            <FieldRow label={t('stickyUserBubbleMode')}>
              <StickyModeMenu label={t('stickyUserBubbleMode')} value={value.stickyUserBubbleMode} t={t} onChange={next => set('stickyUserBubbleMode', next)} />
            </FieldRow>
          )
          : null}
        <FieldRow label={t('fullSessionLoadEnabled')}>
          <Switch label={t('fullSessionLoadEnabled')} checked={value.fullSessionLoadEnabled} onChange={next => set('fullSessionLoadEnabled', next)} />
        </FieldRow>
        {value.fullSessionLoadEnabled
          ? (
            <FieldRow label={t('fullSessionLoadLimit')}>
              <NumberField
                label={t('fullSessionLoadLimit')}
                min={FULL_SESSION_LOAD_LIMIT_MIN}
                max={FULL_SESSION_LOAD_LIMIT_MAX}
                step={5}
                value={value.fullSessionLoadLimit}
                onChange={next => set('fullSessionLoadLimit', clampFullSessionLoadLimit(next))}
              />
            </FieldRow>
          )
          : null}
      </Group>

      <Group title={t('groupFiles')}>
        <FieldRow label={t('customFilesEnabled')}>
          <Switch label={t('customFilesEnabled')} checked={value.customFilesEnabled} onChange={next => set('customFilesEnabled', next)} />
        </FieldRow>
        {value.customFilesEnabled ? (
          <>
            <FieldRow label={t('highlightThemeLight')}>
              <HighlightThemeMenu label={t('highlightThemeLight')} kind="light" value={value.highlightThemeLight} onChange={next => set('highlightThemeLight', next)} />
            </FieldRow>
            <FieldRow label={t('highlightThemeDark')}>
              <HighlightThemeMenu label={t('highlightThemeDark')} kind="dark" value={value.highlightThemeDark} onChange={next => set('highlightThemeDark', next)} />
            </FieldRow>
          </>
        ) : null}
      </Group>

      <Group title={t('groupGitGraph')}>
        <FieldRow label={t('gitGraphEnabled')}>
          <Switch label={t('gitGraphEnabled')} checked={value.gitGraphEnabled} onChange={next => set('gitGraphEnabled', next)} />
        </FieldRow>
      </Group>

      <Group title={t('groupSideChat')}>
        <FieldRow label={t('sideChatEnabled')}>
          <Switch label={t('sideChatEnabled')} checked={value.sideChatEnabled} onChange={next => set('sideChatEnabled', next)} />
        </FieldRow>
        {/* Only offered while the panel itself is enabled: a sub-option that
            cannot take effect is a lie about the state of the feature. */}
        {value.sideChatEnabled
          ? (
            <FieldRow label={t('sideChatContextEnabled')}>
              <Switch label={t('sideChatContextEnabled')} checked={value.sideChatContextEnabled} onChange={next => set('sideChatContextEnabled', next)} />
            </FieldRow>
          )
          : null}
      </Group>

      <Group title={t('groupVoice')}>
        <FieldRow label={t('voiceShortcutEnabled')}>
          <Switch label={t('voiceShortcutEnabled')} checked={value.voiceShortcutEnabled} onChange={next => set('voiceShortcutEnabled', next)} />
        </FieldRow>
        <FieldRow label={t('voiceShortcut')}>
          <VoiceShortcutField value={value.voiceShortcut} onChange={next => set('voiceShortcut', next)} t={t} />
        </FieldRow>
        <FieldRow label={t('voiceAutoStopEnabled')}>
          <Switch label={t('voiceAutoStopEnabled')} checked={value.voiceAutoStopEnabled} onChange={next => set('voiceAutoStopEnabled', next)} />
        </FieldRow>
        {value.voiceAutoStopEnabled ? (
          <>
            <FieldRow label={t('voiceNoSpeechSeconds')}>
              <NumberField label={t('voiceNoSpeechSeconds')} min={3} max={30} step={1} value={value.voiceNoSpeechSeconds} onChange={next => set('voiceNoSpeechSeconds', Math.min(30, Math.max(3, next)))} />
            </FieldRow>
            <FieldRow label={t('voiceAfterSpeechSeconds')}>
              <NumberField label={t('voiceAfterSpeechSeconds')} min={1} max={10} step={0.5} value={value.voiceAfterSpeechSeconds} onChange={next => set('voiceAfterSpeechSeconds', Math.min(10, Math.max(1, next)))} />
            </FieldRow>
          </>
        ) : null}
        <p style={{ margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px' }}>{t('voiceHint')}</p>
      </Group>

      <Group title={t('groupTerminal')}>
        <FieldRow label={t('terminalEnabled')}>
          <Switch label={t('terminalEnabled')} checked={value.terminalEnabled} onChange={next => set('terminalEnabled', next)} />
        </FieldRow>
        <FieldRow label={t('officialTerminalDisabled')}>
          <Switch label={t('officialTerminalDisabled')} checked={value.officialTerminalDisabled} onChange={next => set('officialTerminalDisabled', next)} />
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
