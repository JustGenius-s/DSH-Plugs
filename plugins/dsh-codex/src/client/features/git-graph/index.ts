import { createElement } from 'react'
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../../../shared/config'
import type { CodexKey } from '../../locales'
import type { CodexFeature } from '../../core/feature-manager'
import type {} from '../side-panels/contract'
import { GitGraphView } from './graph-view'

const PANEL_SLOT = 'side.panel'
const NS = 'settings.codex'

interface GitGraphPanelProps {
  cwd?: string
  t: (key: string) => string
}

function GitGraphPanel({ cwd, t }: GitGraphPanelProps) {
  return createElement(GitGraphView, { cwd, t })
}

export function createGitGraphFeature(
  ctx: ClientContext,
  scope: SettingsScope<DshCodexConfig>,
  t: (key: CodexKey) => string,
): CodexFeature {
  return {
    id: 'git-graph',
    activate() {
      const disposeDescriptor = ctx.sidePanels.describe('git-graph', { icon: 'git' })
      const disposeInjection = ctx.slots.inject(PANEL_SLOT, () => {
        let disposeEntry: (() => void) | undefined

        const syncRegistration = (): void => {
          disposeEntry?.()
          disposeEntry = undefined
          if (!(scope.getSnapshot().value ?? DEFAULT_CONFIG).gitGraphEnabled) return

          disposeEntry = ctx.slots.register(
            {
              name: PANEL_SLOT,
              id: 'git-graph',
              order: 30,
              locale: NS as never,
              label: () => t('view.gitGraph'),
            },
            GitGraphPanel as never,
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

export { GitGraphView }
