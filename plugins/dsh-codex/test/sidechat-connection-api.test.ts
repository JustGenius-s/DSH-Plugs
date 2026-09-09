/**
 * The model picker needs the shared RPC face, and a missing one must be
 * visible rather than silent: with no api the picker used to sit on "模型…"
 * forever, which looks identical to a slow lookup from the user's side.
 *
 * These cover the ways the read can fail — a service that has not composed
 * yet, one exposed only as a property, and one whose proxy throws (Cordis
 * raises `cannot get property ... without inject` for an undeclared service).
 */

import { describe, expect, it } from 'vitest'
import { connectionApiOf, connectionApiOfConnection } from '../src/client/features/side-chat/connection'

const api = { sessions: {} }

describe('connectionApiOfConnection', () => {
  it('returns the api a mounted connection exposes', () => {
    expect(connectionApiOfConnection({ api })).toBe(api)
  })

  it('returns undefined when the service is absent or has no api yet', () => {
    expect(connectionApiOfConnection(undefined)).toBeUndefined()
    expect(connectionApiOfConnection({})).toBeUndefined()
  })
})

describe('connectionApiOf', () => {
  it('reads through ctx.get when the service is registered there', () => {
    const ctx = { get: (name: string) => (name === 'connection' ? { api } : undefined) }
    expect(connectionApiOf(ctx)).toBe(api)
  })

  it('falls back to a connection property', () => {
    expect(connectionApiOf({ connection: { api } })).toBe(api)
  })

  it('returns undefined when neither path yields an api', () => {
    expect(connectionApiOf({ get: () => undefined })).toBeUndefined()
    expect(connectionApiOf({})).toBeUndefined()
  })

  it('survives a ctx.get that throws, and still reads the property', () => {
    const ctx = {
      get() { throw new Error('cannot get property "connection" without inject') },
      connection: { api },
    }
    expect(connectionApiOf(ctx)).toBe(api)
  })

  it('survives a throwing connection proxy', () => {
    // Cordis's Context proxy rejects undeclared services by throwing; the
    // feature must activate without an api rather than crash the panel.
    const proxy = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'connection') throw new Error('cannot get property "connection" without inject')
        if (prop === 'get') return () => undefined
        return undefined
      },
    })
    expect(connectionApiOf(proxy)).toBeUndefined()
  })

  it('does not mistake a non-function get for an accessor', () => {
    expect(connectionApiOf({ get: 42, connection: { api } })).toBe(api)
  })
})
