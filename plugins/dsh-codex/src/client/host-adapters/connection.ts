import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import type { ConnectionHandle } from '@just-genius/dsh-plugin-runtime/client'
import { getConnection } from '@just-genius/dsh-plugin-runtime/client'

/** Cordis' runtime service lookup is intentionally narrowed at one boundary. */
export function clientConnection(ctx: ClientContext): ConnectionHandle {
  return getConnection(ctx)
}
