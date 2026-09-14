import type { ComponentType } from 'react'
import type { SidebarRightTabDefinition } from '@just-genius/dsh-plugin-runtime/client'
import type { CodexKey } from '../../locales'

export const FILES_TAB_KIND = 'files'
export const FILES_TAB_ID = '@just-genius/dsh-codex/files'

export function filesTabDefinition(
  t: (key: CodexKey) => string,
  icon?: ComponentType,
): SidebarRightTabDefinition {
  return {
    id: FILES_TAB_ID,
    kind: FILES_TAB_KIND,
    priority: 'extension',
    title: () => t('view.files'),
    guide: [{
      order: 10,
      title: () => t('view.files'),
      icon,
    }],
  }
}
