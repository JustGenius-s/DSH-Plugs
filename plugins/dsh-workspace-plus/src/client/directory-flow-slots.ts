/**
 * The directory-flow takeover's static contract.
 *
 * Kept in a plain module (not the `.tsx` occupant) so it can be tested with a
 * plain import: a silent regression here is expensive because "Add workspace…"
 * would still WORK — it would just fall back to the official single-folder
 * picker, making multi-folder workspaces quietly impossible to create.
 */

/**
 * Priority for both hole registrations.
 *
 * The cell's LOWEST live entry renders, and the official picker backends sit at
 * the default 0, so this MUST be negative. It is deliberately not "0 with a
 * different id": a second registration at an occupied cell's exact priority
 * throws, which is the slot contract that keeps composition unambiguous.
 */
export const DIRECTORY_FLOW_PRIORITY = -10

/**
 * The two holes one occupant fills, as the official contract names them.
 *
 * The sidebar and the conversation hero are independent slot entries, and the
 * official owner declares one hole per entry — so filling only one would leave
 * the other surface on the single-folder picker.
 */
export const DIRECTORY_FLOW_SLOTS = [
  'sidebar.workspaces.directoryFlow',
  'conversation.hero.workspace.directoryFlow',
] as const
