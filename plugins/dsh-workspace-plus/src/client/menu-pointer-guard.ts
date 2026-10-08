/**
 * Keeping the official Project-row menu open while the pointer is over the rows
 * this plugin injects into it.
 *
 * ## Why the official menu closes on our rows
 *
 * The official `Menu` closes itself when the pointer leaves its anchor region:
 * it puts `onPointerEnter` / `onPointerLeave` on the wrapper `span` that holds
 * both the trigger and the portaled list, and its own comment explains the
 * intent — "trigger and portaled list are one region here, so aiming back at the
 * trigger, or crossing the gap between them, never counts as leaving".
 *
 * That holds only INSIDE ONE REACT TREE. React's enter/leave simulation walks
 * the React parent chain, and a portal keeps its React position, so the portaled
 * list really is a React child of the wrapper. The rows this plugin injects are
 * DOM children of that list but React children of a DIFFERENT root, so the moment
 * the pointer crosses onto one of them React sees the destination as "outside the
 * wrapper" and fires `pointerleave`. The menu then arms its 200ms close and
 * vanishes out from under the pointer.
 *
 * Measured: with only the host's two rows the menu stays open indefinitely; with
 * our rows injected it closed ~221ms after opening with the pointer completely
 * still.
 *
 * ## The guard
 *
 * The Project menu carries no slot, so injection is the only way to add rows to
 * it, and the tree boundary cannot be removed from here. What CAN be done is to
 * stop telling the official tree that the pointer left while it demonstrably has
 * not: when the pointer moves onto something inside the open menu, the
 * `pointerout` is swallowed before React's root listener sees it.
 *
 * Scoped deliberately:
 *
 *   - only while THIS plugin is decorating a menu, so the host's other menus are
 *     untouched;
 *   - only when the destination is inside that menu's DOM, so a genuine exit
 *     still reaches the official handler and the menu closes as it always did.
 *
 * This is a workaround for a host implementation detail rather than an
 * interface, so it is isolated here and pinned by tests: if DSH ever exposes a
 * slot for this menu, the whole module can be deleted.
 */

/**
 * Whether the official menu must be stopped from learning about this pointer move.
 *
 * All three facts are passed in as plain values (rather than reaching into the
 * DOM here) so the decision itself is testable without a browser — the DOM wiring
 * is below, and this is the part that is easy to get subtly wrong.
 */
export interface MenuLeaveInput {
  /** Whether this plugin is currently decorating the open menu. */
  decorating: boolean
  /** Whether the element the pointer moved TO sits inside that menu. */
  movedInsideMenu: boolean
  /** Whether it sits inside the row whose trigger opened that menu. */
  movedInsideRow: boolean
}

/**
 * Hold the menu open while the pointer is within the trigger/menu region.
 *
 * The region is deliberately the UNION of the owning row and the open menu, not
 * just the menu. Measured on the real app: the event that armed the close had
 * its destination in the ROW's action strip (the 4px transit between the trigger
 * and the list), so a menu-only test let it through — React armed the close, and
 * the entry into the list did not cancel it, so the menu died ~200ms later with
 * the pointer sitting on a row.
 *
 * Moves anywhere else are genuine exits and must reach the host unchanged, which
 * is what keeps the menu dismissible by moving away.
 */
export function holdsMenuOpen(input: MenuLeaveInput): boolean {
  if (!input.decorating) return false
  return input.movedInsideMenu || input.movedInsideRow
}

/**
 * Whether `related` (the pointer's destination) is inside `menu`.
 *
 * `menu.contains` does the real work; the guard before it exists because
 * `relatedTarget` is not always an element — it is null when the pointer left
 * the window, which must count as a genuine exit. It checks for a `contains`
 * METHOD rather than `instanceof Node` so this stays callable outside a DOM
 * (the tests run it in plain Node, where that global does not exist).
 */
export function movingIntoMenu(container: Element | null, related: EventTarget | null): boolean {
  if (container === null) return false
  if (related === null || typeof related !== 'object') return false
  const candidate = related as Node
  if (typeof candidate.nodeType !== 'number') return false
  return container.contains(candidate)
}

export interface MenuPointerGuard {
  /** Start holding the open menu across this plugin's own rows. */
  arm: () => void
  /** Stop intercepting; official behaviour is restored immediately. */
  release: () => void
}

/**
 * Install the interception.
 *
 * A capture listener on `document` runs before React's root-container listener,
 * so `stopPropagation` here means React never simulates the leave. Both
 * `pointerout` and `pointerleave` are guarded: React derives enter/leave from
 * `pointerout`, and a native `pointerleave` would carry the same false signal.
 *
 * @param findRegions - the open decorated menu and the row that opened it.
 */
export function createMenuPointerGuard(findRegions: () => { menu: Element | null; row: Element | null }): MenuPointerGuard {
  let armed = false

  const onPointerEvent = (event: Event): void => {
    if (!armed) return
    const { menu, row } = findRegions()
    const related = (event as PointerEvent).relatedTarget ?? null
    const hold = holdsMenuOpen({
      decorating: armed,
      movedInsideMenu: movingIntoMenu(menu, related),
      movedInsideRow: movingIntoMenu(row, related),
    })
    if (!hold) return
    event.stopPropagation()
  }

  return {
    arm: () => {
      if (armed) return
      armed = true
      document.addEventListener('pointerout', onPointerEvent, true)
      document.addEventListener('pointerleave', onPointerEvent, true)
    },
    release: () => {
      if (!armed) return
      armed = false
      document.removeEventListener('pointerout', onPointerEvent, true)
      document.removeEventListener('pointerleave', onPointerEvent, true)
    },
  }
}
