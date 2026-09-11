import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import type { CodexFeature } from '../../core/feature-manager'
import { startFileMentionSidebarOpen } from './controller'

export {
  isPlainMentionGesture,
  mentionPathFromFacts,
  mentionSidebarAddress,
} from './model'
export type { MentionChipFacts, MentionClickGesture } from './model'

/**
 * Send a closing-prose file mention to the right Sidebar.
 *
 * Not settings-gated: DSH routes a mention to the desktop's default
 * application whenever the file was declared through `present` and to the
 * Sidebar whenever the mutation tools wrote it, so the same chip has two
 * destinations depending on how its file was recorded. This makes that one
 * destination, the one the delivery card's own primary button already uses.
 *
 * @param ctx - client context carrying the Sessions list and the Sidebar.
 * @returns the feature the manager activates and disposes.
 */
export function createFileMentionsFeature(ctx: ClientContext): CodexFeature {
  return {
    id: 'file-mentions',
    activate() {
      return startFileMentionSidebarOpen(ctx)
    },
  }
}
