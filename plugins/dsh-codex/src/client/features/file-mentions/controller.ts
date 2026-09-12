import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import { getSessions } from '@just-genius/dsh-plugin-runtime/client'
import { closestConversationScroll, mentionChipFacts } from '../../host-adapters/conversation-dom'
import { currentSessionLocation } from '../../host-adapters/sessions'
import {
  isPlainMentionGesture,
  mentionPathFromFacts,
  mentionSidebarAddress,
} from './model'

/**
 * Route closing-prose file mentions to the right Sidebar.
 *
 * One rule for every mention chip, matching the delivery card's primary button:
 * the plain click previews the file beside the conversation. The chip keeps the
 * host's own destination behind a modifier key, which is where its "open in the
 * default application" action stays reachable.
 *
 * The listener runs on `document` in the CAPTURE phase so it executes before
 * React's root-container listener; that is what lets `stopPropagation()` keep the
 * chip's built-in handler from also running. The two destinations are mutually
 * exclusive — running both would preview the file *and* launch a desktop
 * application.
 *
 * All of the deciding is in `model.ts`; this module only reads the DOM, installs
 * the listener, and reports whether an open actually happened.
 *
 * @param ctx - client context carrying the Sessions list and the Sidebar.
 * @returns an uninstall function removing the listener.
 */
export function startFileMentionSidebarOpen(ctx: ClientContext): () => void {
  const onClickCapture = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    // Mentions are transcript content; a same-shaped chip elsewhere is not ours.
    if (closestConversationScroll(target) === null) return

    const { sessionId, cwd } = currentSessionLocation(getSessions(ctx))
    const address = mentionSidebarAddress({
      path: mentionPathFromFacts(mentionChipFacts(target)),
      plain: isPlainMentionGesture(event),
      sessionId,
      cwd,
    })
    if (address === undefined) return
    // A refused open (no mounted surface) must leave the host's action intact
    // rather than swallowing the click into a dead chip.
    if (!openResource(ctx, address)) return
    event.stopPropagation()
  }

  document.addEventListener('click', onClickCapture, true)
  return () => { document.removeEventListener('click', onClickCapture, true) }
}

/**
 * Open one address as a Sidebar resource.
 *
 * @param ctx - client context carrying the Sidebar.
 * @param address - the Session file address to open.
 * @returns whether the Sidebar accepted the address.
 */
function openResource(ctx: ClientContext, address: string): boolean {
  try {
    ctx.sidebarRight.openResource(address)
    return true
  } catch {
    // No registered tab type claims it, or no Session surface is mounted.
    return false
  }
}
