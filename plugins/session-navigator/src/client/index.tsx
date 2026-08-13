// Browser half of @just-genius/dsh-session-navigator.
//
// A client-UI plugin is a Cordis plugin too: it declares which client
// services it needs (`inject`) and its `apply` runs in the browser-side
// Cordis context. The host scans `package.json` -> `dsh.client` and serves
// this module as `exports["./client"]`.

import type { Context } from '@deepseek-ai/cordis'

// Type-only imports that augment the client Cordis context:
// - `@deepseek-ai/dsh-client-runtime/client` declares `ctx.slots`.
// - `@deepseek-ai/dsh-client-ui-conversation` declares the `conversation.*`
//   slot names in the SlotMap.
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Client services this plugin requires before `apply` runs. */
export const inject = ['slots'] as const

/**
 * `conversation.composer.dock` is the ambient band under the composer card
 * (where the shipped stats line lives). Each entry receives the session
 * standard kit (`sessionId`, `useSession`, …) plus the owner `InputZone`.
 */
type DockProps = PropsRuntime<'conversation.composer.dock'>

export function apply(ctx: Context) {
  // `slots.inject` waits for the declaring entry (ui-conversation) to declare
  // the slot, then registers; the returned disposer is owned by our fiber, so
  // unloading the plugin removes the entry.
  ctx.slots.inject('conversation.composer.dock', () =>
    ctx.slots.register(
      { name: 'conversation.composer.dock', id: 'session-navigator', order: 100 },
      SessionNavigatorDock,
    ),
  )
}

/** Minimal proof-of-life entry: an ambient readout under the composer. */
function SessionNavigatorDock(props: DockProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 12px',
        fontSize: 12,
        color: 'var(--dsw-alias-label-tertiary)',
      }}
    >
      <span>Session Navigator</span>
      <span>·</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{props.sessionId ?? 'no session'}</span>
    </div>
  )
}
