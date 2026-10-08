/**
 * The row glyphs, resolved from the names in `row-menu.ts`.
 *
 * The inventory carries icon NAMES so it can stay pure data and be tested in
 * Node; this is where a name becomes a component. Keeping the mapping in one
 * place is what lets both menus show the same glyph for the same action without
 * either of them hard-coding a choice.
 *
 * Every glyph is FORWARDED from DSH through the shared layer (see the re-exports
 * in `packages/ui/src/index.tsx`) rather than redrawn: a plugin row has to look
 * identical to the official row beside it, and a hand-copied path is exactly how
 * the two drift apart. There are no local exceptions.
 *
 * Sizing follows the shared menu's container: `MenuItemButton` wraps its `icon`
 * in a 16x16 box, and the official menus draw their glyphs at 14, so these match
 * and the labels line up down the list.
 */

import type { ReactNode } from 'react'
import {
  OfficialArchiveIcon,
  OfficialBranchIcon,
  OfficialCopyIcon,
  OfficialDownloadIcon,
  OfficialEditIcon,
  OfficialFolderOpenIcon,
  OfficialNewChatIcon,
  OfficialPinFillIcon,
  OfficialPinOutlineIcon,
  OfficialTrashIcon,
  OfficialWorkspaceTreeIcon,
} from '@just-genius/dsh-plugin-ui'

import type { RowIcon } from './row-menu.ts'

/** One glyph per action name, at the size the shared menu expects. */
export function MenuRowIcon(props: { name: RowIcon }): ReactNode {
  switch (props.name) {
    case 'pin': return <OfficialPinOutlineIcon size={14} />
    case 'unpin': return <OfficialPinFillIcon size={14} />
    case 'edit': return <OfficialEditIcon size={14} />
    case 'trash': return <OfficialTrashIcon size={14} />
    // DSH's own "folder holding a tree": the accurate picture of a multi-folder
    // workspace binding.
    case 'workspaceTree': return <OfficialWorkspaceTreeIcon size={14} />
    case 'folderOpen': return <OfficialFolderOpenIcon size={14} />
    case 'copy': return <OfficialCopyIcon size={14} />
    case 'newChat': return <OfficialNewChatIcon size={14} />
    case 'archive': return <OfficialArchiveIcon size={14} />
    case 'branch': return <OfficialBranchIcon size={14} />
    case 'download': return <OfficialDownloadIcon size={14} />
    // Same official glyph as 'folderOpen': revealing a path is ONE action, and it
    // reads the same way whether the path came from a workspace or from a session.
    case 'folder': return <OfficialFolderOpenIcon size={14} />
  }
}
