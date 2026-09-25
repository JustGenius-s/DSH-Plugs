import { useEffect } from 'react'
import type {
  ClientContext,
  SettingsScope,
  SidebarRightTabDefinition,
} from '@just-genius/dsh-plugin-runtime/client'
import type { DshCodexConfig } from '../../../shared/config'
import type { CodexKey } from '../../locales'
import type { CodexFeature } from '../../core/feature-manager'
import { bindEnabledSlot } from '../../bind-enabled-slot'
import {
  closeSidebarTabsByKind,
  registerSidebarTab,
  type SidebarTabProps,
} from '../../sidebar-right'

/** The built-in terminal's tab kind, shadowed while the user switches it off. */
export const OFFICIAL_TERMINAL_KIND = 'terminal'
export const OFFICIAL_TERMINAL_SHUTDOWN_TAB_ID = '@just-genius/dsh-codex/official-terminal-shutdown'

/**
 * In-force placeholder for the built-in terminal's kind.
 *
 * An `extension` registration takes a `builtin` kind over until it
 * unregisters: the official guide capsule leaves the guide page, and every
 * existing or recovered `terminal` tab resolves its body to this definition —
 * whose body closes the tab on mount, running the official close handler that
 * kills the PTY. No patterns and no guide entries: the shadow opens nothing
 * and advertises nothing.
 */
export function officialTerminalShutdownDefinition(
  t: (key: CodexKey) => string,
): SidebarRightTabDefinition {
  return {
    id: OFFICIAL_TERMINAL_SHUTDOWN_TAB_ID,
    kind: OFFICIAL_TERMINAL_KIND,
    priority: 'extension',
    title: () => t('view.warpTerminal'),
    guide: [],
  }
}

export function createOfficialTerminalShutdownFeature(
  ctx: ClientContext,
  scope: SettingsScope<DshCodexConfig>,
  t: (key: CodexKey) => string,
): CodexFeature {
  return {
    id: 'official-terminal-shutdown',
    activate() {
      return bindEnabledSlot(
        scope,
        config => config.officialTerminalDisabled,
        () => {
          // A tab body the official terminal's tabs resolve to while shadowed:
          // close immediately so a recovered or background tab never shows a
          // dead terminal. The official close handler releases the PTY.
          const ShutdownTab = (props: SidebarTabProps) => {
            const { tab } = props.useTabInfo()
            useEffect(() => {
              tab.actions.close()
            }, [tab.actions])
            return null
          }

          const disposeTab = registerSidebarTab(
            ctx,
            officialTerminalShutdownDefinition(t),
            ShutdownTab,
          )
          // Inactive tabs mount no body, so the self-closing body alone would
          // leave them parked in the strip; sweep the inventory as well.
          const disposeSweep = closeSidebarTabsByKind(ctx, OFFICIAL_TERMINAL_KIND)
          return () => {
            disposeSweep()
            disposeTab()
          }
        },
      )
    },
  }
}
