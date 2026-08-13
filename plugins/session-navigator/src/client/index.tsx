// Browser half of @just-genius/dsh-session-navigator.
//
// A client-UI plugin is a Cordis plugin too: it declares which client
// services it needs (`inject`) and its `apply` runs in the browser-side
// Cordis context. The host scans `package.json` -> `dsh.client` and serves
// this module as `exports["./client"]`.

import type { Context } from '@deepseek-ai/cordis'

// Type-only imports that augment the client Cordis context / SlotMap:
// - `@deepseek-ai/dsh-client-runtime/client` declares `ctx.slots` and the
//   session standard kit (`useSession`, `sessionId`, …).
// - `@deepseek-ai/dsh-client-ui-conversation/client` declares the
//   `conversation.*` slot names (including `conversation.chat.turnTail`).
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

import { NavigatorRail } from './navigator'

/** Client services this plugin requires before `apply` runs. */
export const inject = ['slots'] as const

export function apply(ctx: Context) {
  // `conversation.chat.turnTail` is a chain slot rendered inside each
  // completed turn, session-scoped (so the component gets `useSession`).
  // We match every completed turn; the component itself keeps one rail per
  // session (see navigator.tsx).
  ctx.slots.inject('conversation.chat.turnTail', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.turnTail',
        select: (owner: { seq: number }) => ({ seq: owner.seq }),
      },
      NavigatorRail as never,
    ),
  )
}
