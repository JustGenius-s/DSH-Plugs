import type { ComponentType } from 'react'
import type { SidebarRightTabDefinition } from '@just-genius/dsh-plugin-runtime/client'
import type { CodexKey } from '../../locales'
import {
  LEGACY_TERMINAL_TAB_ID,
  LEGACY_TERMINAL_TAB_KIND,
  TERMINAL_RESOURCE_PATTERN,
  TERMINAL_TAB_ID,
  TERMINAL_TAB_KIND,
  isTerminalResourceAddress,
} from './contract'

/** Take over DSH's terminal kind, including its guide entry and new-tab routing. */
export function terminalTabDefinition(
  t: (key: CodexKey) => string,
  icon?: ComponentType,
): SidebarRightTabDefinition {
  return {
    id: TERMINAL_TAB_ID,
    kind: TERMINAL_TAB_KIND,
    multiple: true,
    patterns: [TERMINAL_RESOURCE_PATTERN],
    priority: 'extension',
    canOpen: isTerminalResourceAddress,
    title: () => t('view.warpTerminal'),
    guide: [{
      id: 'new',
      order: 20,
      title: () => t('view.warpTerminal'),
      icon,
    }],
  }
}

/** Keep saved custom terminals renderable without adding another guide entry. */
export function legacyTerminalTabDefinition(
  t: (key: CodexKey) => string,
): SidebarRightTabDefinition {
  return {
    id: LEGACY_TERMINAL_TAB_ID,
    kind: LEGACY_TERMINAL_TAB_KIND,
    priority: 'extension',
    canOpen: isTerminalResourceAddress,
    title: () => t('view.warpTerminal'),
  }
}
