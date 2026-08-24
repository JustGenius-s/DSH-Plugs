import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'

/** Cordis' runtime service lookup is intentionally narrowed at one boundary. */
export function clientConnection(ctx: ClientContext): ConnectionHandle {
  return ctx.get('connection') as ConnectionHandle
}
