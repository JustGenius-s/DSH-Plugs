import { createElement, Fragment, useSyncExternalStore } from 'react'
import type {
  ClientContext,
  SessionId,
  SettingsScope,
} from '@just-genius/dsh-plugin-runtime/client'
import { IconFolderColor16 } from '@just-genius/dsh-plugin-ui'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../../../shared/config'
import type { CodexKey } from '../../locales'
import type { CodexFeature } from '../../core/feature-manager'
import { bindEnabledSlot } from '../../bind-enabled-slot'
import {
  registerSidebarTab,
  sidebarTabTitle,
  type SidebarTabProps,
} from '../../sidebar-right'
import {
  createSidebarTabKeepAliveRegistry,
  sidebarTabOccurrenceKey,
  SidebarTabKeepAliveMount,
} from '../../sidebar-tab-keep-alive'
import { insertFileReference } from './add-to-chat'
import { createFileReviewCommentApi } from './review-comment'
import { setHighlightThemes } from './highlight'
import { FilesPanel, type FilesPanelProps } from './files-panel'
import { FileTabIcon } from './file-tab-icon'
import { createFilesTabStateRegistry } from './tree-store'
import {
  fileAddressFor,
  filesNavigationFrom,
  parseFileAddress,
  type FilesNavigationState,
} from './resource-address'
import {
  FILES_TAB_KIND,
  filesTabDefinition,
} from './files-tab'
import {
  fileViewerDefinition,
  switchActiveFileViewer,
} from './file-viewer'

export {
  FILES_TAB_ID,
  FILES_TAB_KIND,
  filesTabDefinition,
} from './files-tab'
export {
  FILE_VIEWER_ID,
  FILE_VIEWER_KIND,
  OFFICIAL_FILE_VIEWER_KIND,
  fileViewerDefinition,
  switchActiveFileViewer,
} from './file-viewer'

const NS = 'settings.codex'

function useFilesConfig(scope: SettingsScope<DshCodexConfig>): DshCodexConfig {
  const settings = useSyncExternalStore(
    listener => scope.subscribe(listener),
    () => scope.getSnapshot(),
    () => scope.getSnapshot(),
  )
  return { ...DEFAULT_CONFIG, ...settings.value }
}

function openFilesTarget(
  actions: ReturnType<SidebarTabProps['useTabInfo']>['tab']['actions'],
  sessionId: string,
  cwd: string | undefined,
  state: FilesNavigationState,
): void {
  if (state.mode === 'tree') {
    actions.openTab(FILES_TAB_KIND)
    return
  }
  if (state.file === undefined) return
  actions.openResource(fileAddressFor(sessionId, cwd, state.file), {
    params: { mode: state.mode ?? 'preview', sha: state.sha },
  })
}

export function createFilesFeature(
  ctx: ClientContext,
  scope: SettingsScope<DshCodexConfig>,
  t: (key: CodexKey) => string,
): CodexFeature {
  return {
    id: 'files',
    activate() {
      return bindEnabledSlot(
        scope,
        config => config.customFilesEnabled,
        () => {
          const reviewComments = createFileReviewCommentApi(ctx)
          const tabStates = createFilesTabStateRegistry()
          const retainedTabs = createSidebarTabKeepAliveRegistry()

          const applyHighlightThemes = (): void => {
            const value = { ...DEFAULT_CONFIG, ...scope.getSnapshot().value }
            setHighlightThemes(value.highlightThemeLight, value.highlightThemeDark)
          }
          applyHighlightThemes()
          const disposeThemeSync = scope.subscribe(applyHighlightThemes)

          const FilesPageTab = (props: SidebarTabProps) => {
            const { tab } = props.useTabInfo()
            const cwd = props.useSessions(state => state.byId[props.sessionId]?.cwd)
            const config = useFilesConfig(scope)
            const treeStore = tabStates.acquire(
              sidebarTabOccurrenceKey(props.sessionId, tab.id),
              tab.signal,
            )
            const panelProps: FilesPanelProps = {
              cwd,
              t: props.t,
              navState: { mode: 'tree' },
              treeStore,
              onOpen: state => openFilesTarget(tab.actions, props.sessionId, cwd, state),
              highlightThemeLight: config.highlightThemeLight,
              highlightThemeDark: config.highlightThemeDark,
              visible: tab.visible,
              onAddToChat: (path, kind) => insertFileReference(ctx, props.sessionId, path, kind),
              onAddComment: comment => reviewComments.insert(props.sessionId, comment),
            }
            return createElement(SidebarTabKeepAliveMount, {
              registry: retainedTabs,
              sessionId: props.sessionId,
              tabId: tab.id,
              signal: tab.signal,
              visible: tab.visible,
              render: visible => createElement(FilesPanel, {
                ...panelProps,
                visible,
              }),
            })
          }

          const FileViewerTab = (props: SidebarTabProps) => {
            const { tab } = props.useTabInfo()
            const parsed = parseFileAddress(tab.navigation.address)
            const resourceSessionId = (parsed?.scope === 'session'
              ? parsed.sessionId
              : props.sessionId) as SessionId
            const cwd = props.useSessions(state => state.byId[resourceSessionId]?.cwd)
            const config = useFilesConfig(scope)
            const navState = filesNavigationFrom(tab.navigation.address, tab.navigation.params)
            const panelProps: FilesPanelProps = {
              cwd,
              t: props.t,
              navState,
              onOpen: state => openFilesTarget(tab.actions, resourceSessionId, cwd, state),
              highlightThemeLight: config.highlightThemeLight,
              highlightThemeDark: config.highlightThemeDark,
              visible: tab.visible,
              onAddToChat: (path, kind) => insertFileReference(ctx, props.sessionId, path, kind),
              onAddComment: comment => reviewComments.insert(props.sessionId, comment),
            }
            return createElement(SidebarTabKeepAliveMount, {
              registry: retainedTabs,
              sessionId: props.sessionId,
              tabId: tab.id,
              signal: tab.signal,
              visible: tab.visible,
              render: visible => createElement(FilesPanel, {
                ...panelProps,
                visible,
              }),
            })
          }

          const FilesTitle = (props: SidebarTabProps) => {
            const { tab } = props.useTabInfo()
            return sidebarTabTitle(IconFolderColor16, tab.title)
          }

          const FileViewerTitle = (props: SidebarTabProps) => {
            const { tab } = props.useTabInfo()
            return createElement(
              Fragment,
              null,
              createElement(FileTabIcon, { name: tab.title }),
              tab.title,
            )
          }

          const disposeFilesPage = registerSidebarTab(
            ctx,
            filesTabDefinition(t, IconFolderColor16),
            FilesPageTab,
            { locale: NS, title: FilesTitle },
          )
          const disposeViewer = registerSidebarTab(
            ctx,
            fileViewerDefinition(t),
            FileViewerTab,
            { locale: NS, title: FileViewerTitle },
          )

          return () => {
            disposeViewer()
            disposeFilesPage()
            retainedTabs.dispose()
            tabStates.dispose()
            disposeThemeSync()
            reviewComments.dispose()
          }
        },
        enabled => switchActiveFileViewer(ctx.sidebarRight, enabled),
      )
    },
  }
}

export { FilesPanel }
export {
  officialRenderedPreviewExtension,
  usesOfficialRenderedPreview,
} from './official-rendered-preview'
