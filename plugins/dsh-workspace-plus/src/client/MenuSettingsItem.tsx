import { useState, useSyncExternalStore } from 'react'
import { SettingsCard, Switch } from '@just-genius/dsh-plugin-ui'
import {
  SESSION_KEYS,
  TRIGGER_KEYS,
  WORKSPACE_KEYS,
  getMenuState,
  setFeature,
  subscribeMenuState,
  type FeatureKey,
  type FeatureMap,
} from './features.ts'
import type { WorkspacePlusKey } from './locales.ts'

/**
 * General-settings card listing the row-menu switches.
 *
 * Rendered into the `settings.general.item` slot; every action can be turned
 * off so the menu only shows what the user wants.
 */
export function MenuSettingsItem({ t }: { t?: (key: WorkspacePlusKey) => string }) {
  const translate = t ?? ((key: WorkspacePlusKey) => key)
  const state = useSyncExternalStore(subscribeMenuState, getMenuState, getMenuState)
  const [open, setOpen] = useState(false)

  return (
    <SettingsCard
      title={translate('settings.title')}
      open={open}
      onToggle={() => { setOpen(!open) }}
      toggleLabel={translate('settings.title')}
    >
      <FeatureGroup
        title={translate('settings.group.trigger')}
        keys={TRIGGER_KEYS}
        features={state.features}
        translate={translate}
      />
      <FeatureGroup
        title={translate('settings.group.workspace')}
        keys={WORKSPACE_KEYS}
        features={state.features}
        translate={translate}
      />
      <FeatureGroup
        title={translate('settings.group.session')}
        keys={SESSION_KEYS}
        features={state.features}
        translate={translate}
      />
    </SettingsCard>
  )
}

function FeatureGroup(props: {
  title: string
  keys: readonly FeatureKey[]
  features: FeatureMap
  translate: (key: WorkspacePlusKey) => string
}) {
  return (
    <div>
      <div style={GROUP_TITLE_STYLE}>{props.title}</div>
      {props.keys.map((key) => (
        <SwitchRow
          key={key}
          label={props.translate(SETTINGS_LABELS[key])}
          checked={props.features[key] !== false}
          onChange={(next) => { setFeature(key, next) }}
        />
      ))}
    </div>
  )
}

function SwitchRow(props: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div style={ROW_STYLE}>
      <span>{props.label}</span>
      <Switch label={props.label} checked={props.checked} onChange={props.onChange} />
    </div>
  )
}

const GROUP_TITLE_STYLE = {
  padding: '12px 0 2px',
  fontSize: 12,
  fontWeight: 600,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.04em',
}

const ROW_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  minHeight: 36,
  fontSize: 13,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-primary)',
}

const SETTINGS_LABELS: Record<FeatureKey, WorkspacePlusKey> = {
  dblclick: 'settings.dblclick',
  contextmenu: 'settings.contextmenu',
  workspacePin: 'settings.workspacePin',
  workspaceRename: 'settings.workspaceRename',
  workspaceOpenExplorer: 'settings.workspaceOpenExplorer',
  workspaceCopyPath: 'settings.workspaceCopyPath',
  workspaceNewSession: 'settings.workspaceNewSession',
  workspaceDelete: 'settings.workspaceDelete',
  sessionPin: 'settings.sessionPin',
  sessionRename: 'settings.sessionRename',
  sessionUnread: 'settings.sessionUnread',
  sessionArchive: 'settings.sessionArchive',
  sessionFork: 'settings.sessionFork',
  sessionCopyLink: 'settings.sessionCopyLink',
  sessionCopyTitle: 'settings.sessionCopyTitle',
  sessionOpenWindow: 'settings.sessionOpenWindow',
  sessionOpenFolder: 'settings.sessionOpenFolder',
}
