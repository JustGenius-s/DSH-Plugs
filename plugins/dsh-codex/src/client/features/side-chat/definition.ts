import type { SidebarRightTabDefinition } from '@just-genius/dsh-plugin-runtime/client'
import { IconNewChatOutline16 } from '@just-genius/dsh-plugin-ui'
import type { CodexKey } from '../../locales'

export const SIDE_CHAT_TAB_KIND = 'dsh-codex-side-chat'
export const SIDE_CHAT_TAB_ID = '@just-genius/dsh-codex/side-chat'

/** Pure official-Sidebar contribution contract for Side Chat. */
export function sideChatTabDefinition(t: (key: CodexKey) => string): SidebarRightTabDefinition {
  return {
    id: SIDE_CHAT_TAB_ID,
    kind: SIDE_CHAT_TAB_KIND,
    priority: 'extension',
    title: () => t('view.sideChat'),
    guide: [{
      order: 40,
      title: () => t('view.sideChat'),
      description: () => t('sidebar.sideChatDescription'),
      icon: IconNewChatOutline16,
    }],
  }
}
