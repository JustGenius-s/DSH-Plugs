import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../../../shared/config'
import type { CodexKey } from '../../locales'
import type { CodexFeature } from '../../core/feature-manager'
import './contract'
import { createLauncherStore } from './launcher-store'
import { LauncherToggle } from './launcher-toggle'
import { createSidePanelsStore } from './service'
import { SidePanelsShell } from './shell'
import type { PanelEntriesApi, PanelTabInfo } from './shell'
import type { SidePanelActionsContribution } from './actions'

const PANEL_SLOT = 'side.panel'
const NS = 'settings.codex'

export function createSidePanelsFeature(
  ctx: ClientContext,
  scope: SettingsScope<DshCodexConfig>,
  t: (key: CodexKey) => string,
  actions?: SidePanelActionsContribution,
): CodexFeature {
  return {
    id: 'side-panels',
    provides: ['sidePanels'],
    activate() {
      const config = { ...DEFAULT_CONFIG, ...scope.getSnapshot().value }
      const store = createSidePanelsStore({
        defaultWidth: config.panelDefaultWidth,
        maxWidth: config.panelMaxWidth,
        rememberTabs: config.panelRememberTabs,
      })
      ctx.provide('sidePanels', store)
      const launcher = createLauncherStore()

      let cachedVersion = -1
      let cachedList: PanelTabInfo[] = []
      const entries: PanelEntriesApi = {
        list: () => {
          const version = ctx.slots.getVersion(PANEL_SLOT)
          if (version === cachedVersion) return cachedList
          cachedVersion = version
          const out: PanelTabInfo[] = []
          for (const entry of ctx.slots.entries(PANEL_SLOT)) {
            const id = entry.options.id
            if (id === undefined) continue
            const label = typeof entry.options.label === 'function'
              ? entry.options.label()
              : entry.options.label
            out.push({ id, label: label ?? id, order: entry.options.order ?? 100 })
          }
          out.sort((a, b) => a.order - b.order)
          cachedList = out
          return cachedList
        },
        subscribe: listener => ctx.slots.subscribe(PANEL_SLOT, listener),
        version: () => ctx.slots.getVersion(PANEL_SLOT),
      }

      const unsubscribeSettings = scope.subscribe(() => {
        const next = { ...DEFAULT_CONFIG, ...scope.getSnapshot().value }
        store.setPreferences({
          defaultWidth: next.panelDefaultWidth,
          maxWidth: next.panelMaxWidth,
          rememberTabs: next.panelRememberTabs,
        })
      })
      const disposeShell = ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'side-panels',
            locale: NS as never,
            children: {
              [PANEL_SLOT]: {
                kind: 'list',
                scope: 'root',
                owner: {},
              },
            } as never,
            inject: () => ({ store, launcher, entries, scope, t, actions }),
          },
          SidePanelsShell as never,
        ),
      )

      // The header toggle for the occlusion auto-hide: one button in the
      // session header's action row, visible only while the card is hidden
      // or a manual override is in effect.
      const disposeLauncherToggle = ctx.slots.inject('conversation.session.header.actions', () =>
        ctx.slots.register(
          {
            name: 'conversation.session.header.actions',
            id: 'codex-launcher-toggle',
            order: 100,
            inject: () => ({ launcher, t }),
          },
          LauncherToggle as never,
        ),
      )

      return () => {
        unsubscribeSettings()
        disposeShell()
        disposeLauncherToggle()
        launcher.dispose()
        store.dispose()
      }
    },
  }
}

export { PANEL_ICONS, resolvePanelIcon } from './icons'
export type { PanelIconName, PanelIconProps } from './icons'
export type { SidePanelsService, SidePanelsStore, SidePanelDescriptor } from './service'
