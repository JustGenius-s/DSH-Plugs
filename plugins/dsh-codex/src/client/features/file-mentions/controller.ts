import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import { getSessions } from '@just-genius/dsh-plugin-runtime/client'
import { closestConversationScroll, mentionChipFacts } from '../../host-adapters/conversation-dom'
import { currentSessionLocation } from '../../host-adapters/sessions'
import { fileAddressFor, parseFileAddress } from '../files/resource-address'
import {
  adoptsMentionClick,
  isPlainMentionGesture,
  mentionPathFromFacts,
} from './model'

/**
 * Route closing-prose file mentions to the right Sidebar.
 *
 * One rule for every mention chip, matching the delivery card's primary
 * button: the plain click previews the file beside the conversation. The chip
 * keeps the host's own destination behind a modifier key, which is where its
 * "open in the default application" action stays reachable.
 *
 * The listener runs on `document` in the CAPTURE phase so it executes before
 * React's root-container listener; that is what lets `stopPropagation()` keep
 * the chip's built-in handler from also running. Both destinations are
 * mutually exclusive — running both would preview the file *and* launch a
 * desktop application.
 *
 * @param ctx - client context carrying the Sessions list and the Sidebar.
 * @returns an uninstall function removing the listener.
 */
export function startFileMentionSidebarOpen(ctx: ClientContext): () => void {
  const onClickCapture = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    // Mentions are transcript content; a same-shaped chip anywhere else is not ours.
    if (closestConversationScroll(target) === null) return

    const path = mentionPathFromFacts(mentionChipFacts(target))
    if (!adoptsMentionClick({ path, plain: isPlainMentionGesture(event) })) return
    if (!openMentionInSidebar(ctx, path)) return
    event.stopPropagation()
  }

  document.addEventListener('click', onClickCapture, true)
  return () => { document.removeEventListener('click', onClickCapture, true) }
}

/**
 * Open one mention path as a Sidebar resource for the Session on screen.
 *
 * A path outside the Session workspace becomes an `absolute` address, which the
 * official document preview declines — it accepts Session addresses only — so
 * nothing would claim it and the open would throw. Reporting `false` there is
 * the honest outcome: the Sidebar cannot read such a file, so the host's own
 * action stays the one that works.
 *
 * @param ctx - client context carrying the Sessions list and the Sidebar.
 * @param path - the mention's file path, as the host wrote it.
 * @returns whether a Sidebar tab was opened.
 */
function openMentionInSidebar(ctx: ClientContext, path: string | undefined): boolean {
  if (path === undefined) return false
  const { sessionId, cwd } = currentSessionLocation(getSessions(ctx))
  if (sessionId === undefined) return false
  const address = fileAddressFor(sessionId, cwd, path)
  if (parseFileAddress(address)?.scope !== 'session') return false
  try {
    ctx.sidebarRight.openResource(address)
    return true
  } catch {
    // No registered tab type claims the address; leave the host's own action in place.
    return false
  }
}
