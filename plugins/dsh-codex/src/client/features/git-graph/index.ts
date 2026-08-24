import { createElement, useSyncExternalStore } from 'react'
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../../../shared/config'
import type { CodexKey } from '../../locales'
import type { CodexFeature } from '../../core/feature-manager'
import type {} from '../side-panels/contract'
import type { SidePanelsStore } from '../side-panels/service'
import { GitChangesView } from './changes-view'
import { GitGraphView } from './graph-view'

const PANEL_SLOT = 'side.panel'
const PANEL_ID = 'git-graph'
const NS = 'settings.codex'

export function createGitGraphFeature(
  ctx: ClientContext,
  scope: SettingsScope<DshCodexConfig>,
  t: (key: CodexKey) => string,
): CodexFeature {
  return {
    id: 'git-graph',
    activate() {
      const store = ctx.sidePanels as SidePanelsStore

      // One panel, two views (like `files` tree vs preview): the default
      // instance shows the working-tree changes; the Graph button opens a
      // second instance of the SAME panel rendering the commit graph.
      const disposeDescriptor = ctx.sidePanels.describe(PANEL_ID, {
        icon: 'git',
        multi: true,
      })
      const openFile = (file: string, sha?: string): void => {
        ctx.sidePanels.open('files', { mode: 'diff', file, sha })
      }
      const openPreview = (file: string, sha?: string): void => {
        ctx.sidePanels.open('files', { mode: 'preview', file, sha })
      }
      const openGraph = (): void => {
        const existing = store.getSnapshot().instances.find(
          (item) => item.panelId === PANEL_ID && item.state?.view === 'graph',
        )
        if (existing !== undefined) {
          store.activateInstance(existing.key)
          return
        }
        ctx.sidePanels.open(PANEL_ID, {
          view: 'graph',
          title: t('view.gitGraphGraph'),
        })
      }

      const disposeInjection = ctx.slots.inject(PANEL_SLOT, () => {
        let disposeEntry: (() => void) | undefined

        const syncRegistration = (): void => {
          disposeEntry?.()
          disposeEntry = undefined
          if (!(scope.getSnapshot().value ?? DEFAULT_CONFIG).gitGraphEnabled) return

          disposeEntry = ctx.slots.register(
            {
              name: PANEL_SLOT,
              id: PANEL_ID,
              order: 30,
              locale: NS as never,
              label: () => t('view.gitGraph'),
            },
            function GitPanelSlot(props: {
              cwd?: string
              instanceKey?: string
              visible?: boolean
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
                (item) => item.panelId === PANEL_ID && item.key === props.instanceKey,
              )
              const visible = props.visible !== false
              if (instance?.state?.view === 'graph') {
                return createElement(GitGraphView, {
                  cwd: props.cwd,
                  t: props.t,
                  visible,
                  onOpenFile: openFile,
                  onOpenPreview: openPreview,
                })
              }
              return createElement(GitChangesView, {
                cwd: props.cwd,
                t: props.t,
                visible,
                onOpenFile: openFile,
                onOpenPreview: openPreview,
                onOpenGraph: openGraph,
              })
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

export { GitChangesView, GitGraphView }
