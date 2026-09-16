import { describe, expect, it } from 'vitest'
import { resolveIngestSessionId } from '../src/resolve.ts'

describe('resolveIngestSessionId', () => {
  it('uses the requested id when present', () => {
    expect(resolveIngestSessionId('sess-1', ['sess-2'])).toEqual({ ok: true, sessionId: 'sess-1' })
  })

  it('falls back to the sole live debug session', () => {
    expect(resolveIngestSessionId('', ['sess-1'])).toEqual({ ok: true, sessionId: 'sess-1' })
  })

  it('refuses to guess when two sessions are live', () => {
    expect(resolveIngestSessionId('', ['a', 'b'])).toEqual({ ok: false, reason: 'ambiguous' })
  })
})
