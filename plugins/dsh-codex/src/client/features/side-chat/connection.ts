/**
 * Reading the shared RPC face.
 *
 * `ConnectionHandle.api` is REQUIRED, so a mounted connection always has one;
 * but the service may not be composed yet when a feature activates, and
 * touching `ctx.connection` on the Cordis proxy throws
 * `cannot get property "connection" without inject` when it is not declared.
 * Either failure used to leave the side-chat model picker with no api at all,
 * silently stuck on "模型…" — indistinguishable from a slow lookup.
 *
 * Pure and injectable so it can be tested without a client context.
 */

/** The slice of the connection service this module reads. */
export interface ApiBearingConnection {
  api: unknown
}

/**
 * Resolve the shared RPC client from a connection service object.
 *
 * @param connection - the `connection` service, or undefined when absent.
 * @returns the api face, or undefined when the service has not composed one.
 */
export function connectionApiOfConnection(
  connection: { api?: unknown } | undefined,
): unknown | undefined {
  return connection?.api
}

/**
 * Resolve the shared RPC client off a Cordis context.
 *
 * Reads through `ctx.get`, the accessor that never throws for an undeclared
 * service, then falls back to a plain property read for contexts that expose
 * the service directly. Both reads are guarded.
 */
export function connectionApiOf(ctx: object): unknown | undefined {
  // Read through `ctx.get`, the accessor that never throws for an undeclared
  // service, then fall back to a plain property read for contexts that expose
  // the service directly. Both reads are guarded: Cordis's proxy throws
  // `cannot get property ... without inject` on an undeclared service, and it
  // carries no index signature, so the context is read structurally here.
  try {
    const getter = (ctx as { get?: unknown }).get
    if (typeof getter === 'function') {
      const handle = (getter as (name: string) => unknown).call(ctx, 'connection')
      const api = (handle as { api?: unknown } | undefined)?.api
      if (api !== undefined) return api
    }
  } catch {
    // An undeclared/unguarded service: fall through to the property read.
  }
  try {
    return (ctx as { connection?: { api?: unknown } }).connection?.api
  } catch {
    // A throwing proxy (undeclared service): there is simply no api yet.
    return undefined
  }
}
