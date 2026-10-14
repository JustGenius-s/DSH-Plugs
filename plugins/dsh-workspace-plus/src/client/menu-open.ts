/**
 * Why a row's menu used to close while the pointer was travelling into it, and
 * what the fix is.
 *
 * The menu opens 4px BELOW the row. That strip belongs to neither the trigger
 * nor the list — it is the row's own padding — so the pointer is briefly over
 * "nothing" on its way down. The shared `Menu` can arm a close on the pointer
 * leaving its anchor, giving the pointer 200ms to cross that strip. Two things
 * defeat that grace here:
 *
 *   1. `pointerleave` fires when the pointer leaves the TRIGGER's box, not the
 *      row's. The trigger is 16px tall inside a 34px row, so most of the row
 *      already counts as "outside" before the strip is even reached;
 *   2. a hand that pauses on the way down (reading, or simply unhurried) can sit
 *      in the strip for longer than the grace.
 *
 * The panel's menus are opened by a CLICK, not by hovering, so a pointer-leave
 * close was never the right dismissal for them: they now dismiss on outside
 * click, Escape, or selection, which is the shared `Menu`'s own default. That
 * removes the timing race instead of widening it.
 *
 * The row additionally marks itself while its own menu is up. That is the
 * official row's behaviour (`menuOpen`), and it keeps the row visibly
 * highlighted — so it stays clear which row an open menu belongs to.
 */

/**
 * The attribute a row sets while ITS OWN menu is open.
 *
 * A data attribute rather than a class: the module CSS classes are hashed per
 * build, and the panel already keys its styling off DOM contracts
 * (`data-row-key`, `data-workspace-plus-pins`) for the same reason.
 */
export const MENU_OPEN_ATTRIBUTE = 'data-workspace-plus-menu-open'

/** The attribute bag for a row: present only while its own menu is open. */
export function menuOpenAttribute(open: boolean): Record<string, string> {
  return open ? { [MENU_OPEN_ATTRIBUTE]: '' } : {}
}
