/**
 * Closing-prose file mentions: which click is ours, and where it should land.
 *
 * The decisions live here as plain data-in/data-out functions so they can be
 * pinned without a DOM (see AGENTS.md); `../../host-adapters/conversation-dom.ts`
 * reads the elements and `controller.ts` only installs the listener.
 *
 * Why dsh-codex owns this at all: `ui-deliverables` holds the mention
 * vocabulary (`chatFileMentions`), and it routes a click by how the file
 * happened to be recorded rather than by what the click means — a path the
 * mutation tools produced opens the right Sidebar, while a path declared only
 * through `present` POSTs to a native "open in the default application" route.
 * The same `<code><button>` chip therefore had two destinations, and the
 * delivered-file one contradicted the delivery card's own primary button, which
 * previews in the Sidebar. A plugin cannot re-register that service (Cordis
 * throws on a second `provide` for a name), so the click is what dsh-codex
 * adopts: one rule for every mention chip, matching the card's primary action.
 */
import { fileAddressFor, parseFileAddress } from '../files/resource-address'

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
 * the button's `title` is the full path and its parent is the `<code>` the token
 * was written in. The class name is a CSS-module hash and deliberately not
 * consulted. Inline code that is *not* a resolved mention renders as plain
 * `<code>` text (or an `<a>` for a URL) and so carries no button at all, which
 * is what keeps this rule from claiming ordinary `code` spans; every other
 * button in the transcript — delivery cards, tool rows, the action strip — has a
 * parent that is not a `<code>`.
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
 * destination (the desktop's default application) reachable instead of removing
 * it from the product.
 *
 * @param gesture - the click's modifier and button state.
 * @returns `true` when the plain gesture is in play.
 */
export function isPlainMentionGesture(gesture: MentionClickGesture): boolean {
  if (gesture.button !== 0) return false
  return !gesture.metaKey && !gesture.ctrlKey && !gesture.shiftKey && !gesture.altKey
}

/**
 * The Sidebar address to open for a clicked mention, or `undefined` to leave the
 * click to the host.
 *
 * Returning an address means the caller takes the click over. Every reason to
 * decline returns `undefined`, so the failure mode for a shape this plugin
 * cannot act on is the untouched product behavior rather than a chip that does
 * nothing:
 *
 * - the click did not land on a mention chip, or carried a modifier;
 * - there is no Session on screen to resolve a relative path against;
 * - the path lies outside the Session workspace, which becomes an `absolute`
 *   address that the official text preview declines (it claims Session
 *   addresses only). The host's own action is the one that can still open it.
 *
 * @param input - the chip path, the plain-gesture verdict, and the Session identity.
 * @returns the address to open, or `undefined` to leave the event alone.
 */
export function mentionSidebarAddress(input: {
  readonly path: string | undefined
  readonly plain: boolean
  readonly sessionId: string | undefined
  readonly cwd: string | undefined
}): string | undefined {
  if (input.path === undefined) return undefined
  if (!input.plain) return undefined
  if (input.sessionId === undefined) return undefined
  const address = fileAddressFor(input.sessionId, input.cwd, input.path)
  return parseFileAddress(address)?.scope === 'session' ? address : undefined
}
