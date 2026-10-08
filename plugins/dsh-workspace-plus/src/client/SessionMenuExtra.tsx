/**
 * The rows this plugin contributes to DSH's own Session menu.
 *
 * DSH 0.1.7 declares `sidebar.workspaces.session.menu.item` as a `list` slot and
 * registers its own pin (100), rename (200), fork (300), and archive (400)
 * there. Contributing here — rather than painting a second menu over the row —
 * is what makes the additions first-class: the browser places them by `order`,
 * they join the list's keyboard walk, and they dismiss through the same
 * `useMenuOpenState` hook the shipped rows use.
 *
 * Only rows DSH does NOT have live here. Pin, rename, fork, and archive are the
 * host's, so re-registering them would give the user two of each.
 */

import { MenuItemButton } from '@just-genius/dsh-plugin-ui'
import type { InjectFace, PropsLocale, PropsRuntime } from '@just-genius/dsh-plugin-runtime/client'

import { MenuRowIcon } from './menu-icons.tsx'
import type { WorkspacePlusKey } from './locales.ts'
import { pluginSessionRows } from './row-menu.ts'

/** Row order after the host's archive row (400), so additions follow them. */
export const SESSION_MENU_ORDER = 500

export interface SessionMenuInjected {
  /**
   * Put the session's reference (`@[title](dsh-session:...)`) on the clipboard,
   * so it can be pasted into a composer to point at this session.
   */
  copyReference: (sessionId: string) => void
  /** Download the session as Markdown. */
  exportSession: (sessionId: string) => void
  /** Reveal the session's working directory in the OS file manager. */
  openFolder: (sessionId: string) => void
  /** Whether an export for this session is already running. */
  isExporting: (sessionId: string) => boolean
  /** Whether the session has a working directory to reveal. */
  hasFolder: (sessionId: string) => boolean
  /** Per-row switches from Settings. */
  enabled: { copyReference: boolean; export: boolean; openFolder: boolean }
}

export type SessionMenuProps =
  PropsRuntime<'sidebar.workspaces.session.menu.item'>
  & PropsLocale<'workspace-plus'>
  & InjectFace<SessionMenuInjected>

/**
 * One entry of the official Session menu list.
 *
 * `separatorBefore` marks the first row this plugin actually renders, so the
 * additions read as one group below the host's rows — and a row that renders
 * nothing leaves no stray hairline behind.
 */
export function SessionMenuExtra(props: SessionMenuProps) {
  const {
    sessionId, useMenuOpenState, t,
    copyReference, exportSession, openFolder,
    isExporting, hasFolder, enabled,
  } = props
  const [, setMenuOpen] = useMenuOpenState()

  // One row is run by one function. Kept as a table so the rows and their
  // actions cannot drift apart as the inventory grows.
  const run: Record<string, () => void> = {
    copyReference: () => { copyReference(sessionId) },
    export: () => { exportSession(sessionId) },
    openFolder: () => { openFolder(sessionId) },
  }

  // Rows, labels, glyphs and the enabled/disabled split all come from the shared
  // inventory, so this menu and the pinned area's session menu cannot disagree.
  const rows = pluginSessionRows({
    exporting: isExporting(sessionId),
    hasFolder: hasFolder(sessionId),
    enabled,
  })

  if (rows.length === 0) return null

  return (
    <>
      {rows.map((row, index) => (
        <MenuItemButton
          key={row.id}
          separatorBefore={index === 0}
          icon={<MenuRowIcon name={row.icon} />}
          disabled={row.disabled}
          onSelect={() => {
            // Dismiss before acting: the action may navigate or start a
            // download, and the menu must not outlive the row it belongs to.
            setMenuOpen(false)
            run[row.id]?.()
          }}
        >
          {t(row.labelKey)}
        </MenuItemButton>
      ))}
    </>
  )
}
