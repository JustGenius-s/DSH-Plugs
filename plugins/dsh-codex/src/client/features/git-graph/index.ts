import { createElement } from 'react'
import type {
  ClientContext,
  SettingsScope,
  SidebarRightTabActions,
  SidebarRightTabDefinition,
} from '@just-genius/dsh-plugin-runtime/client'
import { IconBranchOutline16 } from '@just-genius/dsh-plugin-ui'
import type { DshCodexConfig } from '../../../shared/config'
import type { CodexKey } from '../../locales'
import type { CodexFeature } from '../../core/feature-manager'
import { bindEnabledSlot } from '../../bind-enabled-slot'
import { registerSidebarTab, type SidebarTabProps } from '../../sidebar-right'
import {
  createSidebarTabKeepAliveRegistry,
  SidebarTabKeepAliveMount,
} from '../../sidebar-tab-keep-alive'
import { fileAddressFor } from '../files/resource-address'
import { GitChangesView } from './changes-view'
import { GitGraphView } from './graph-view'

export const GIT_CHANGES_TAB_KIND = 'dsh-codex-git-changes'
export const GIT_CHANGES_TAB_ID = '@just-genius/dsh-codex/git-changes'
export const GIT_GRAPH_TAB_KIND = 'dsh-codex-git-graph'
export const GIT_GRAPH_TAB_ID = '@just-genius/dsh-codex/git-graph'

const NS = 'settings.codex'

export function gitChangesTabDefinition(t: (key: CodexKey) => string): SidebarRightTabDefinition {
  return {
    id: GIT_CHANGES_TAB_ID,
    kind: GIT_CHANGES_TAB_KIND,
    priority: 'extension',
    title: () => t('view.gitGraph'),
    guide: [{
      order: 30,
      title: () => t('view.gitGraph'),
      description: () => t('sidebar.gitDescription'),
      icon: IconBranchOutline16,
    }],
  }
}

export function gitGraphTabDefinition(t: (key: CodexKey) => string): SidebarRightTabDefinition {
  return {
    id: GIT_GRAPH_TAB_ID,
    kind: GIT_GRAPH_TAB_KIND,
    priority: 'extension',
    title: () => t('view.gitGraphGraph'),
  }
}

function openFile(
  actions: SidebarRightTabActions,
  sessionId: string,
  cwd: string | undefined,
  file: string,
  mode: 'preview' | 'diff',
  sha?: string,
): void {
  actions.openResource(fileAddressFor(sessionId, cwd, file), {
    params: { mode, sha },
  })
}

export function createGitGraphFeature(
  ctx: ClientContext,
  scope: SettingsScope<DshCodexConfig>,
  t: (key: CodexKey) => string,
): CodexFeature {
  return {
    id: 'git-graph',
    activate() {
      return bindEnabledSlot(
        scope,
        config => config.gitGraphEnabled,
        () => {
          const retainedTabs = createSidebarTabKeepAliveRegistry()

          const GitChangesTab = (props: SidebarTabProps) => {
            const { tab } = props.useTabInfo()
            const cwd = props.useSessions(state => state.byId[props.sessionId]?.cwd)
            return createElement(SidebarTabKeepAliveMount, {
              registry: retainedTabs,
              sessionId: props.sessionId,
              tabId: tab.id,
              signal: tab.signal,
              visible: tab.visible,
              render: visible => createElement(GitChangesView, {
                cwd,
                t: props.t,
                visible,
                onOpenFile: (file, sha) => openFile(
                  tab.actions,
                  props.sessionId,
                  cwd,
                  file,
                  'diff',
                  sha,
                ),
                onOpenPreview: (file, sha) => openFile(
                  tab.actions,
                  props.sessionId,
                  cwd,
                  file,
                  'preview',
                  sha,
                ),
                onOpenGraph: () => tab.actions.openTab(GIT_GRAPH_TAB_KIND),
              }),
            })
          }

          const GitGraphTab = (props: SidebarTabProps) => {
            const { tab } = props.useTabInfo()
            const cwd = props.useSessions(state => state.byId[props.sessionId]?.cwd)
            return createElement(SidebarTabKeepAliveMount, {
              registry: retainedTabs,
              sessionId: props.sessionId,
              tabId: tab.id,
              signal: tab.signal,
              visible: tab.visible,
              render: visible => createElement(GitGraphView, {
                cwd,
                t: props.t,
                visible,
                onOpenFile: (file, sha) => openFile(
                  tab.actions,
                  props.sessionId,
                  cwd,
                  file,
                  'diff',
                  sha,
                ),
                onOpenPreview: (file, sha) => openFile(
                  tab.actions,
                  props.sessionId,
                  cwd,
                  file,
                  'preview',
                  sha,
                ),
              }),
            })
          }

          const disposeChanges = registerSidebarTab(
            ctx,
            gitChangesTabDefinition(t),
            GitChangesTab,
            { locale: NS },
          )
          const disposeGraph = registerSidebarTab(
            ctx,
            gitGraphTabDefinition(t),
            GitGraphTab,
            { locale: NS },
          )
          return () => {
            disposeGraph()
            disposeChanges()
            retainedTabs.dispose()
          }
        },
      )
    },
  }
}

export { GitChangesView, GitGraphView }
