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
import { createQuickActionsStore } from '../quick-actions/store'
import type { QuickAction } from '../../../shared/config'
import type { TerminalControllerStore } from '../terminal/controller'
import { currentSessionLocation } from '../../host-adapters/sessions'

const PANEL_SLOT = 'side.panel'
const NS = 'settings.codex'

export function createSidePanelsFeature(
  ctx: ClientContext,
  scope: SettingsScope<DshCodexConfig>,
  t: (key: CodexKey) => string,
  controllerStore: TerminalControllerStore,
): CodexFeature {
  return {
    id: 'side-panels',
    activate() {
      const config = { ...DEFAULT_CONFIG, ...scope.getSnapshot().value }
      const store = createSidePanelsStore({
        defaultWidth: config.panelDefaultWidth,
        maxWidth: config.panelMaxWidth,
        rememberTabs: config.panelRememberTabs,
      })
      ctx.provide('sidePanels', store)
      const launcher = createLauncherStore()
      const quickActions = createQuickActionsStore(scope)

      // Run a stored quick action, step by step. Each step is `{ command, target }`:
      // a `current` step runs the command in the currently active terminal; a `new`
      // step opens a fresh terminal tab (seeded with the active terminal's cwd, else
      // the session cwd) and runs the command there. Every command is trimmed and
      // must be non-empty; any failure rejects the whole action.
      const executeQuickAction = async (action: QuickAction): Promise<void> => {
        const { sessionId, cwd: sessionCwd } = currentSessionLocation(ctx.sessions)

        // The active terminal instance for the current session, if any. The
        // `current` target runs in it; a `new` target seeds its cwd from it.
        // Mutable so a successful `new` step can retarget it to the terminal
        // it just opened, making a following `current` step run in that tab.
        const snapshot = store.getSnapshot()
        let activeTerminal = snapshot.activeKey === null
          ? undefined
          : snapshot.instances.find(i => i.key === snapshot.activeKey && i.panelId === 'terminal')

        for (const step of action.steps) {
          const command = step.command.trim()
          if (command === '') {
            throw new Error('quick action requires a non-empty command')
          }
          if (step.target === 'current') {
            if (activeTerminal === undefined) {
              throw new Error('quick action current-target requires an active terminal')
            }
            if (sessionId === undefined || sessionId === '') {
              throw new Error('quick action current-target requires a current session')
            }
            // The terminal is registered under `{sessionId}:{instanceKey}` — the
            // side-panel instance key is only session-scoped, so compose the
            // controller id from the current session before waiting on it.
            const controllerId = `${sessionId}:${activeTerminal.key}`
            const controller = await controllerStore.waitFor(controllerId)
            await controller.run(command)
          } else {
            const rawCwd = activeTerminal?.state?.cwd ?? sessionCwd
            const cwd = rawCwd?.trim() ?? ''
            if (cwd === '') {
              throw new Error('quick action new-target requires a cwd')
            }
            if (sessionId === undefined || sessionId === '') {
              throw new Error('quick action new-target requires a current session')
            }
            // No title: keep the default tab caption for a fresh terminal.
            const key = ctx.sidePanels.open('terminal', { cwd })
            if (key === undefined) {
              throw new Error('quick action failed to open a terminal')
            }
            // The new tab is now the active terminal, so a following `current`
            // step runs in the terminal we just opened. Re-read the snapshot to
            // resolve the instance backing that key.
            const created = store.getSnapshot().instances.find(
              i => i.key === key && i.panelId === 'terminal',
            )
            if (created !== undefined) {
              activeTerminal = created
            }
            const controllerId = `${sessionId}:${key}`
            const controller = await controllerStore.waitFor(controllerId)
            await controller.run(command)
          }
        }
      }

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
            inject: () => ({ store, launcher, entries, scope, t, quickActions, executeQuickAction }),
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
        quickActions.dispose()
        launcher.dispose()
        store.dispose()
      }
    },
  }
}

export { PANEL_ICONS, resolvePanelIcon } from './icons'
export type { PanelIconName, PanelIconProps } from './icons'
export type { SidePanelsService, SidePanelsStore, SidePanelDescriptor } from './service'
