/**
 * Locate the plugin's own mount inside the official sidebar.
 *
 * The pinned area sits directly BELOW the sidebar's section header (the
 * "工作区" / "Workspaces" title) and scrolls together with the list, so it
 * belongs in the same scroll container as the rows — not beside it.
 *
 * The official layout is:
 *
 *   div.<hash>_root                      flex column
 *   ├─ div.<hash>_sectionHeader          the "工作区" title, 36px, NOT scrolling
 *   └─ div.<hash>_listArea               flex:1
 *      └─ div.<hash>_treeBody            flex:1
 *         └─ div.<hash>_list              ← the scroll container (overflow-y:auto)
 *            └─ div[role="tree"][aria-label="会话"]   the grouped/flat rows
 *
 * So the mount target is that scroll container, and the container is the FIRST
 * child of it — above the first group, below the header, inside the scrolling
 * area. Nothing here claims, replaces, or reorders an official slot, and the
 * rows keep their own ordering: the panel is a block, not a row, and the
 * official drag math is id-based (`next.indexOf(target.id)`), never indexed by
 * child position.
 *
 * The header itself is NEVER touched. It carries the view options and the
 * search field, and restructuring it would break the official controls.
 *
 * This module owns element lookup and the mount lifecycle; every decision about
 * WHAT to mount is left to the caller, and the key parsing lives in `anchor.ts`
 * so it can be tested without a DOM.
 */

import { isBrowsingTree, isWorkspaceSlot } from './anchor.ts'

/** Marker on our mount container, so host mutations can be told apart from ours. */
export const MOUNT_ATTRIBUTE = 'data-workspace-plus-panel'

/** The element the sidebar's workspace browser occupies. */
export function findWorkspaceSlot(): HTMLElement | undefined {
  for (const node of document.querySelectorAll<HTMLElement>('[data-slot]')) {
    if (isWorkspaceSlot(node.getAttribute('data-slot'))) return node
  }
  return undefined
}

/**
 * The scroll container holding the browsing rows.
 *
 * Deliberately NOT "the first `role=tree` on the page": while a search query is
 * active the browser renders a DIFFERENT tree (the search results), and that one
 * is replaced wholesale on every keystroke — an occupant there is discarded and
 * has no meaning. Only the browsing tree is accepted.
 *
 * Returns `undefined` when the browser is absent or searching, so the caller
 * hides the panel and re-mounts it when browsing returns.
 */
export function findScrollHost(): HTMLElement | undefined {
  const slot = findWorkspaceSlot()
  if (slot === undefined) return undefined
  for (const tree of slot.querySelectorAll<HTMLElement>('[role="tree"]')) {
    if (!isBrowsingTree(tree.getAttribute('aria-label'))) continue
    // The tree's own parent is the scrolling box (the tree itself is the inner
    // row list); falling back to the tree keeps this working if that nesting
    // ever flattens.
    const parent = tree.parentElement
    if (parent !== null && isScrollContainer(parent)) return parent
    return tree
  }
  return undefined
}

function isScrollContainer(el: HTMLElement): boolean {
  const overflowY = getComputedStyle(el).overflowY
  return overflowY === 'auto' || overflowY === 'scroll'
}

/**
 * Ensure our container is the FIRST child of the scroll host.
 *
 * An existing container is reused as-is: this runs on every host mutation, and
 * moving a live React portal's container would remount its subtree and drop the
 * panel's state. Re-inserting at the front is also unnecessary — the official
 * rows are appended after us, so the panel keeps leading the block.
 */
export function ensureMount(region: HTMLElement): HTMLElement {
  const existing = region.querySelector<HTMLElement>(`:scope > [${MOUNT_ATTRIBUTE}]`)
  if (existing !== null) return existing

  const host = document.createElement('div')
  host.setAttribute(MOUNT_ATTRIBUTE, '')
  // A plain block inside the scrolling list. It deliberately declares NO flex
  // sizing: the official row list is a flex column, and a `flex` value here
  // would make the panel compete with the rows for space and order.
  //
  // It also declares NO margin. The rows inside this container fill its content
  // box edge to edge, so any inset here would shrink the panel's rows relative
  // to the official ones and make the hover fill a different width — which is
  // exactly the "background sizes don't match" symptom. The scroll container
  // already carries the correct inset, and its scrollbar overlays.
  host.style.display = 'block'

  region.insertBefore(host, region.firstElementChild)
  return host
}

/** Remove our container, leaving the official tree exactly as it was. */
export function removeMount(): void {
  for (const node of document.querySelectorAll<HTMLElement>(`[${MOUNT_ATTRIBUTE}]`)) node.remove()
}
