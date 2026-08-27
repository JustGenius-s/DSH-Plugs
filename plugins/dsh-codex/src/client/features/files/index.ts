import { createElement, useSyncExternalStore } from 'react'
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../../../shared/config'
import type { CodexKey } from '../../locales'
import type { CodexFeature } from '../../core/feature-manager'
import type {} from '../side-panels/contract'
import type { SidePanelsStore } from '../side-panels/service'
import { bindEnabledSlot } from '../../bind-enabled-slot'
import { insertFileReference } from './add-to-chat'
import { createFileReviewCommentApi } from './review-comment'
import { setHighlightThemes } from './highlight'
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
    requires: ['sidePanels'],
    activate() {
      const store = ctx.sidePanels as SidePanelsStore
      const reviewComments = createFileReviewCommentApi(ctx, t)

      // Keep the shared highlighter's light/dark pair in sync with settings.
      // The settings page (a separate tab) writes through the same scope, so
      // the subscription below is the single source of truth for the panel.
      const applyHighlightThemes = (): void => {
        const snapshot = scope.getSnapshot()
        const value = { ...DEFAULT_CONFIG, ...snapshot.value }
        setHighlightThemes(value.highlightThemeLight, value.highlightThemeDark)
      }
      applyHighlightThemes()
      const disposeThemeSync = scope.subscribe(applyHighlightThemes)

      // `multi`: every open is a NEW instance (tab). One form per instance —
      // switching form or opening a file opens another `files` tab.
      const disposeDescriptor = ctx.sidePanels.describe('files', {
        icon: 'files',
        multi: true,
        caption: (instance, siblings, label) => {
          const file = instance.state?.file
          if (file) return file.slice(file.lastIndexOf('/') + 1)
          if (siblings.length < 2) return label
          const ordinal = siblings.findIndex(item => item.key === instance.key) + 1
          return ordinal > 0 ? `${label} ${ordinal}` : label
        },
      })

      const open = (state: import('../side-panels/service').PanelNavState): void => {
        ctx.sidePanels.open('files', state)
      }

      const disposeInjection = ctx.slots.inject(PANEL_SLOT, () => bindEnabledSlot(
        scope,
        config => config.filesEnabled,
        () => ctx.slots.register(
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
              const settings = useSyncExternalStore(
                (listener) => scope.subscribe(listener),
                () => scope.getSnapshot(),
                () => scope.getSnapshot(),
              )
              const instance = snapshot.instances.find(
                (item) => item.panelId === 'files' && item.key === props.instanceKey,
              )
              const navState = instance?.state
              const config = { ...DEFAULT_CONFIG, ...settings.value }
              const panelProps: FilesPanelProps = {
                sessionId: props.sessionId,
                cwd: props.cwd,
                instanceKey: props.instanceKey,
                t: props.t,
                navState,
                onOpen: open,
                showIgnored: config.filesShowGitIgnored,
                highlightThemeLight: config.highlightThemeLight,
                highlightThemeDark: config.highlightThemeDark,
                visible: props.visible !== false,
                onAddToChat: (path) => insertFileReference(ctx, props.sessionId, path),
                onAddComment: (comment) => reviewComments.insert(props.sessionId, comment),
                reviewComments: {
                  list: (path) => reviewComments.list(props.sessionId, path),
                  subscribe: reviewComments.subscribe,
                  getVersion: reviewComments.getVersion,
                },
              }
              return createElement(FilesPanel, panelProps)
            } as never,
          ),
      ))

      return () => {
        disposeThemeSync()
        disposeDescriptor()
        disposeInjection()
        reviewComments.dispose()
      }
    },
  }
}

export { FilesPanel }
