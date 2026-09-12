import type {
  SidebarRightService,
  SidebarRightTabDefinition,
} from '@just-genius/dsh-plugin-runtime/client'
import type { CodexKey } from '../../locales'
import {
  FILE_ADDRESS_PATTERN,
  fileTitleFromAddress,
  parseFileAddress,
} from './resource-address'
import { usesOfficialRenderedPreview } from './official-rendered-preview'

export const OFFICIAL_FILE_VIEWER_KIND = 'text'
export const FILE_VIEWER_KIND = 'dsh-codex-file'
export const FILE_VIEWER_ID = '@just-genius/dsh-codex/file-viewer'

export function fileViewerDefinition(t: (key: CodexKey) => string): SidebarRightTabDefinition {
  return {
    id: FILE_VIEWER_ID,
    kind: FILE_VIEWER_KIND,
    patterns: [FILE_ADDRESS_PATTERN],
    priority: 'extension',
    canOpen: address => {
      const parsed = parseFileAddress(address)
      return parsed !== undefined && !usesOfficialRenderedPreview(parsed.path)
    },
    title: address => fileTitleFromAddress(address, t('view.files')),
  }
}

/** Reclassify the visible file tab after its preferred viewer changes. */
export function switchActiveFileViewer(
  sidebar: Pick<SidebarRightService, 'active' | 'openResource'>,
  customEnabled: boolean,
): boolean {
  const active = sidebar.active()
  if (active === undefined || parseFileAddress(active.contentId) === undefined) return false

  if (usesOfficialRenderedPreview(active.contentId)) {
    if (active.kind !== FILE_VIEWER_KIND) return false
    sidebar.openResource(active.contentId, {
      kind: OFFICIAL_FILE_VIEWER_KIND,
      replaceTab: active.id,
      revealIfOpened: false,
    })
    return true
  }

  if (customEnabled) {
    if (active.kind === FILE_VIEWER_KIND) return false
    sidebar.openResource(active.contentId, {
      kind: FILE_VIEWER_KIND,
      replaceTab: active.id,
      revealIfOpened: false,
    })
    return true
  }

  if (active.kind !== FILE_VIEWER_KIND) return false
  // The extension registration has already left, so normal resource
  // resolution selects DSH's best built-in/fallback viewer.
  sidebar.openResource(active.contentId, {
    replaceTab: active.id,
    revealIfOpened: false,
  })
  return true
}
