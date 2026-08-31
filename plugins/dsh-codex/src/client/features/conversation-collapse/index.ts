import {
  getConversationEventRegistry,
  type ClientContext,
  type SettingsScope,
} from '@just-genius/dsh-plugin-runtime/client'
import type { DshCodexConfig } from '../../../shared/config'
import type { CodexKey } from '../../locales'
import type { CodexFeature } from '../../core/feature-manager'
import { turnCollapseDefinition } from './definition'
import { TURN_COLLAPSE_KIND } from './model'
import { TurnCollapseView } from './turn-collapse-view'

const NS = 'settings.codex'

export function createConversationCollapseFeature(
  ctx: ClientContext,
  scope: SettingsScope<DshCodexConfig>,
  _t: (key: CodexKey) => string,
): CodexFeature {
  return {
    id: 'conversation-collapse',
    activate() {
      // 0.1.2+ provides `uiConversation.events`; older hosts still use
      // `conversationEvents`. Resolve at activate so inject cannot stall boot.
      const events = getConversationEventRegistry(ctx)
      const disposeDefinition = events === undefined
        ? () => {}
        : events.register(turnCollapseDefinition)
      const disposeRenderer = ctx.slots.inject('conversation.chat.node', () =>
        ctx.slots.register(
          {
            name: 'conversation.chat.node',
            key: TURN_COLLAPSE_KIND,
            locale: NS as never,
            inject: () => ({ scope }),
          },
          TurnCollapseView as never,
        ),
      )
      return () => {
        disposeRenderer()
        disposeDefinition()
      }
    },
  }
}

export { TurnCollapseView }
export { turnCollapseDefinition }
