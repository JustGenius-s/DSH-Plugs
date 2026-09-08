import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import { CLIENT_SERVICES } from '@just-genius/dsh-plugin-runtime/client'

import { FlowCanvas } from './FlowCanvas.tsx'

export const inject = [CLIENT_SERVICES.slots] as const

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    {
      name: 'conversation.view',
      id: 'flow',
      order: 20,
      label: 'Flow',
    },
    FlowCanvas as never,
  ))
}
