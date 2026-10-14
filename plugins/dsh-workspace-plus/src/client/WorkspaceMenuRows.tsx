/**
 * The plugin's rows inside the official workspace (Project) row menu.
 *
 * DSH exposes no slot for that menu, so `workspace-menu.ts` watches for it and
 * publishes the open menu's item container; this component portals our rows
 * into that container. The rows are official `MenuItemButton`s, which is what
 * makes them behave like shipped rows — the host list's keyboard walk, hover
 * fill, and post-selection focus return all read the DOM, so a matching button
 * joins them. Closing stays our call, as it is for the host's own rows.
 */

import { createPortal } from 'react-dom'
import { MenuItemButton } from '@just-genius/dsh-plugin-ui'

import type { Translate } from './locales.ts'
import { MenuRowIcon } from './menu-icons.tsx'
import type { WorkspaceMenuTarget } from './workspace-menu.ts'
import { closeWorkspaceMenu } from './workspace-menu.ts'
import type { RowAction } from './row-menu.ts'

/** A row to append: the shared action shape minus the fields the host supplies. */
export type WorkspaceMenuAction = RowAction

export interface WorkspaceMenuRowsProps {
  target: WorkspaceMenuTarget
  t: Translate
  actions: readonly WorkspaceMenuAction[]
  onSelect: (actionId: string) => void
}

export function WorkspaceMenuRows({ target, t, actions, onSelect }: WorkspaceMenuRowsProps) {
  if (actions.length === 0) return null
  return createPortal(
    <>
      {actions.map((action) => (
        <MenuItemButton
          key={action.id}
          // A group start: the plugin's rows are additive and must read as a
          // separate block from the host's rename/delete pair.
          separatorBefore={action === actions[0]}
          icon={<MenuRowIcon name={action.icon} />}
          danger={action.danger}
          onSelect={() => {
            // Dismiss first: the action may navigate, and the menu must not
            // survive the row it belongs to.
            closeWorkspaceMenu()
            onSelect(action.id)
          }}
        >
          {t(action.labelKey)}
        </MenuItemButton>
      ))}
    </>,
    target.host,
  )
}
