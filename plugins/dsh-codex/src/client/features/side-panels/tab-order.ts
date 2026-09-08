/**
 * Tab-strip ordering rules for the side panels.
 *
 * Kept out of the store so the placement rule is testable without a browser:
 * a new tab belongs next to the one you are looking at, the way editor tabs
 * behave, instead of at the far end of the strip.
 */

/** The minimum an instance needs to be placed; the store's key. */
export interface TabKeyed {
  readonly key: string
}

/**
 * Where a newly opened tab lands in the strip.
 *
 * @param instances - open instances, in tab order.
 * @param activeKey - the active instance's key, or null when none is active.
 * @returns the insertion index: right after the active tab, or the end when
 *   there is no active tab (empty strip, or an active key that no longer
 *   exists — the strip must never drop a tab on the floor).
 */
export function tabInsertIndex(
  instances: readonly TabKeyed[],
  activeKey: string | null,
): number {
  const index = instances.findIndex((instance) => instance.key === activeKey)
  return index === -1 ? instances.length : index + 1
}
