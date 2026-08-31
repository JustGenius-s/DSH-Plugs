import type { ClientContext, SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import type { DshCodexConfig } from '../../../shared/config'
import type { CodexKey } from '../../locales'
import type { CodexFeature } from '../../core/feature-manager'
import { StickyUserBubble } from './sticky-bubble-view'

const NS = 'settings.codex'

export function createStickyUserBubbleFeature(
  ctx: ClientContext,
  scope: SettingsScope<DshCodexConfig>,
  t: (key: CodexKey) => string,
): CodexFeature {
  return {
    id: 'sticky-user-bubble',
    activate() {
      // Session header stays mounted for the open session. turnTail remounts
      // with history pages, so a first in-flight answer would never pin.
      const dispose = ctx.slots.inject('conversation.session.header.actions', () =>
        ctx.slots.register(
          {
            name: 'conversation.session.header.actions',
            id: 'codex-sticky-user-bubble',
            order: 101,
            locale: NS as never,
            inject: () => ({ scope, t }),
          },
          StickyUserBubble as never,
        ),
      )
      return dispose
    },
  }
}

export { StickyUserBubble }
