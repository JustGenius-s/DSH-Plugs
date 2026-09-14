import type { ComponentType } from 'react'
import type { SidebarRightTabDefinition } from '@just-genius/dsh-plugin-runtime/client'
import type { CodexKey } from '../../locales'
import {
  SIDE_CHAT_RESOURCE_PATTERN,
  SIDE_CHAT_TAB_ID,
  SIDE_CHAT_TAB_KIND,
  isSideChatResourceAddress,
} from './contract'

export { SIDE_CHAT_TAB_ID, SIDE_CHAT_TAB_KIND }

/**
 * Pure official-Sidebar contribution contract for Side Chat.
 *
 * Registered as BOTH a page type (the guide capsule, which opens by kind) and a
 * resource type (`dsh-resource://dsh-codex-side-chat/**`). The resource half is
 * what allows several side chats at once: the store deduplicates a PAGE to one
 * record per pane, so before this every "new" side chat only focused the first
 * tab. The page half survives as the way in from the guide — each tab it opens
 * converts itself into its own resource tab on mount.
 *
 * The icon is a parameter rather than an import, matching the Files definition:
 * a UI-package import drags the official primitives' CSS modules into every
 * consumer of this otherwise pure contract.
 */
export function sideChatTabDefinition(
  t: (key: CodexKey) => string,
  icon?: ComponentType,
): SidebarRightTabDefinition {
  return {
    id: SIDE_CHAT_TAB_ID,
    kind: SIDE_CHAT_TAB_KIND,
    patterns: [SIDE_CHAT_RESOURCE_PATTERN],
    priority: 'extension',
    canOpen: isSideChatResourceAddress,
    title: () => t('view.sideChat'),
    guide: [{
      order: 40,
      title: () => t('view.sideChat'),
      icon,
    }],
  }
}
