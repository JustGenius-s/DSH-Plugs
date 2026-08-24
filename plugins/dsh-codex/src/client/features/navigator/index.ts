import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { DshCodexConfig } from '../../../shared/config'
import type { CodexFeature } from '../../core/feature-manager'
import { NavigatorRail } from './navigator-rail'
import { createNavigatorRegistry } from './registry'
import { clientConnection } from '../../host-adapters/connection'
import { loadOlderSessionHistory } from '../../host-adapters/sessions'

export function createNavigatorFeature(ctx: ClientContext, scope: SettingsScope<DshCodexConfig>): CodexFeature {
  return {
    id: 'navigator',
    activate() {
      const registry = createNavigatorRegistry()
      const api = clientConnection(ctx).api
      const disposeRegistration = ctx.slots.inject('conversation.chat.turnTail', () =>
        ctx.slots.register(
          {
            name: 'conversation.chat.turnTail',
            select: (owner: TurnTailOwnerProps) => ({ seq: owner.seq }),
            inject: (sessionId: string) => ({
              scope,
              registry,
              api,
              loadOlder: () => loadOlderSessionHistory(ctx.sessions, sessionId),
            }),
          },
          NavigatorRail as never,
        ),
      )
      return () => {
        disposeRegistration()
        registry.dispose()
      }
    },
  }
}
