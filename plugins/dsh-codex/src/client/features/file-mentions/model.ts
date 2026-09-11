/**
 * Closing-prose file mentions: which click is ours, and which path it names.
 *
 * The rules live here as plain data-in/data-out functions so they can be
 * pinned without a DOM (see AGENTS.md); `../../host-adapters/conversation-dom.ts`
 * reads the elements and `controller.ts` runs the click.
 *
 * Why dsh-codex owns this at all: `ui-deliverables` holds the mention
 * vocabulary (`chatFileMentions`), and for a path that was only *declared*
 * through `present` it routes the click to a native "open in the default
 * application" POST, while the very same chip for a tool-produced path opens
 * the right Sidebar — and the delivery card's own primary button previews in
 * the Sidebar too. So one chip shape has two destinations depending only on how
 * its file happened to be recorded. A plugin cannot re-register that service
 * (Cordis throws on a second `provide` for a name), so the click is what
 * dsh-codex adopts: one rule for every mention chip, matching the card's
 * primary action.
 */

/** The element facts a mention chip exposes to a click. */
export interface MentionChipFacts {
  /** Uppercased tag name of the nearest button ancestor; `''` when there is none. */
  readonly buttonTag: string
  /** Uppercased tag name of that button's parent element; `''` when there is none. */
  readonly parentTag: string
  /** The button's `title` attribute, exactly as the host wrote it. */
  readonly title: string
}

/** The parts of a click that decide whether the plain gesture is in play. */
export interface MentionClickGesture {
  /** `MouseEvent.button`: 0 is the primary button, including keyboard activation. */
  readonly button: number
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}

/**
 * The file path a clicked mention chip names, or `undefined` when this click
 * did not land on a mention chip.
 *
 * DSH renders a resolved mention as `<code><button title="<path>">token</button></code>`:
 * the button's `title` is the full path and its parent is the `<code>` the
 * token was written in. The class name is a CSS-module hash and deliberately
 * not consulted. Inline code that is *not* a resolved mention renders as plain
 * `<code>` text (or an `<a>` for a URL) and so carries no button at all, which
 * is what keeps this rule from claiming ordinary `code` spans.
 *
 * @param facts - element facts read off the click target.
 * @returns the mention's full path, or `undefined` when this is not a mention chip.
 */
export function mentionPathFromFacts(facts: MentionChipFacts): string | undefined {
  if (facts.buttonTag !== 'BUTTON') return undefined
  if (facts.parentTag !== 'CODE') return undefined
  const path = facts.title.trim()
  return path.length === 0 ? undefined : path
}

/**
 * Whether a click is the plain primary gesture — the one this plugin adopts.
 *
 * A modifier held down is left to the host, which keeps the chip's own
 * destination (the desktop's default application) reachable instead of being
 * removed from the product.
 *
 * @param gesture - the click's modifier and button state.
 * @returns `true` when the plain gesture is in play.
 */
export function isPlainMentionGesture(gesture: MentionClickGesture): boolean {
  if (gesture.button !== 0) return false
  return !gesture.metaKey && !gesture.ctrlKey && !gesture.shiftKey && !gesture.altKey
}

/**
 * Whether this plugin should take a click over from the host's own handler.
 *
 * Both halves are required. A click that resolves to no path is not a mention
 * chip; a click carrying a modifier is the user asking for the host's
 * destination on purpose. Everything else is ours.
 *
 * This decides only whether to ATTEMPT the Sidebar open. Whether the event is
 * then stopped depends on that open succeeding, which is the controller's
 * business — a refused open must leave the host's action intact rather than
 * swallowing the click.
 *
 * @param input - the resolved path and the plain-gesture verdict.
 * @returns `true` when the controller should try the Sidebar open.
 */
export function adoptsMentionClick(input: {
  readonly path: string | undefined
  readonly plain: boolean
}): boolean {
  return input.path !== undefined && input.plain
}
