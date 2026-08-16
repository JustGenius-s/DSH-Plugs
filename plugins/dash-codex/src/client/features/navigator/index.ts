import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { DashCodexConfig } from '../../../shared/config'
import type { CodexFeature } from '../../core/feature-manager'
import { NavigatorRail } from './navigator-rail'

export function createNavigatorFeature(ctx: ClientContext, scope: SettingsScope<DashCodexConfig>): CodexFeature {
  return {
    id: 'navigator',
    activate() {
      ctx.slots.inject('conversation.chat.turnTail', () =>
        ctx.slots.register(
          {
            name: 'conversation.chat.turnTail',
            select: (owner: { seq: number }) => ({ seq: owner.seq }),
            inject: () => ({ scope }),
          },
          NavigatorRail as never,
        ),
      )
      return () => {}
    },
  }
}