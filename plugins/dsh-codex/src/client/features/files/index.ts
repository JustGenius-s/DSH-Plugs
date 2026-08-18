import { createElement, useSyncExternalStore } from 'react'
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../../../shared/config'
import type { CodexKey } from '../../locales'
import type { CodexFeature } from '../../core/feature-manager'
import type {} from '../side-panels/contract'
import type { SidePanelsStore } from '../side-panels/service'
import { FilesPanel, type FilesPanelProps } from './files-panel'

const PANEL_SLOT = 'side.panel'
const NS = 'settings.codex'

export function createFilesFeature(
  ctx: ClientContext,
  scope: SettingsScope<DshCodexConfig>,
  t: (key: CodexKey) => string,
): CodexFeature {
  return {
    id: 'files',
    activate() {
      const store = ctx.sidePanels as SidePanelsStore

      // `multi`: every open is a NEW instance (tab). One form per instance —
      // switching form or opening a file opens another `files` tab.
      const disposeDescriptor = ctx.sidePanels.describe('files', { icon: 'files', multi: true })

      const open = (state: import('../side-panels/service').PanelNavState): void => {
        ctx.sidePanels.open('files', state)
      }

      const disposeInjection = ctx.slots.inject(PANEL_SLOT, () => {
        let disposeEntry: (() => void) | undefined

        const syncRegistration = (): void => {
          disposeEntry?.()
          disposeEntry = undefined
          if (!(scope.getSnapshot().value ?? DEFAULT_CONFIG).filesEnabled) return

          disposeEntry = ctx.slots.register(
            {
              name: PANEL_SLOT,
              id: 'files',
              order: 35,
              locale: NS as never,
              label: () => t('view.files'),
            },
            function FilesPanelSlot(props: {
              sessionId: string
              cwd?: string
              instanceKey?: string
              t: (key: string) => string
            }) {
              // Each instance reads its OWN navigation state off the store by
              // its instance key (multi: every tab is an independent subtree).
              const snapshot = useSyncExternalStore(
                store.subscribe,
                store.getSnapshot,
                store.getSnapshot,
              )
              const instance = snapshot.instances.find(
                (item) => item.panelId === 'files' && item.key === props.instanceKey,
              )
              const navState = instance?.state
              const panelProps: FilesPanelProps = {
                sessionId: props.sessionId,
                cwd: props.cwd,
                instanceKey: props.instanceKey,
                t: props.t,
                navState,
                onOpen: open,
              }
              return createElement(FilesPanel, panelProps)
            } as never,
          )
        }

        syncRegistration()
        const unsubscribe = scope.subscribe(syncRegistration)
        return () => {
          unsubscribe()
          disposeEntry?.()
          disposeEntry = undefined
        }
      })

      return () => {
        disposeDescriptor()
        disposeInjection()
      }
    },
  }
}

export { FilesPanel }
