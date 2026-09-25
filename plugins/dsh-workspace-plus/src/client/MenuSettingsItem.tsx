/**
 * The plugin's switches, on its page in the sidebar Plugins manager.
 *
 * Every row this plugin adds can be turned off, so the official menus never grow
 * past what the user wants. Only ADDITIONS appear here: DSH's own pin, rename,
 * fork, and archive rows are the host's and are not ours to toggle.
 */

import { useState, useSyncExternalStore } from 'react'
import { SettingsCard, Switch } from '@just-genius/dsh-plugin-ui'

import {
  SESSION_KEYS,
  SURFACE_KEYS,
  WORKSPACE_KEYS,
  getPluginState,
  setFeature,
  subscribePluginState,
  type FeatureKey,
  type FeatureMap,
} from './features.ts'
import type { WorkspacePlusKey } from './locales.ts'

export function MenuSettingsItem({ t }: { t?: (key: WorkspacePlusKey) => string }) {
  const translate = t ?? ((key: WorkspacePlusKey) => key)
  const state = useSyncExternalStore(subscribePluginState, getPluginState, getPluginState)
  const [open, setOpen] = useState(false)

  return (
    <SettingsCard
      title={translate('settings.title')}
      open={open}
      onToggle={() => { setOpen(!open) }}
      toggleLabel={translate('settings.title')}
    >
      <FeatureGroup
        title={translate('settings.group.surface')}
        keys={SURFACE_KEYS}
        features={state.features}
        translate={translate}
      />
      <FeatureGroup
        title={translate('settings.group.trigger')}
        keys={['contextmenu']}
        features={state.features}
        translate={translate}
      />
      <FeatureGroup
        title={translate('settings.group.workspace')}
        keys={WORKSPACE_KEYS.filter((key) => key !== 'contextmenu')}
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
        <div key={key} style={ROW_STYLE}>
          <span>{props.translate(SETTINGS_LABELS[key])}</span>
          <Switch
            label={props.translate(SETTINGS_LABELS[key])}
            checked={props.features[key] !== false}
            onChange={(next) => { setFeature(key, next) }}
          />
        </div>
      ))}
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
  contextmenu: 'settings.contextmenu',
  pinnedPanel: 'settings.pinnedPanel',
  workspacePin: 'settings.workspacePin',
  workspaceEditBinding: 'settings.workspaceEditBinding',
  workspaceOpenExplorer: 'settings.workspaceOpenExplorer',
  workspaceCopyPath: 'settings.workspaceCopyPath',
  workspaceNewSession: 'settings.workspaceNewSession',
  sessionCopyReference: 'settings.sessionCopyReference',
  sessionExport: 'settings.sessionExport',
  sessionOpenFolder: 'settings.sessionOpenFolder',
}
