/**
 * Crash reports are only useful if they keep their stack. These drive the two
 * pure formatters the error UI depends on — they run against every throw
 * shape that actually crosses the Host/render boundary, because a formatter
 * that assumes `Error` silently drops the evidence for the rest.
 */

import { describe, expect, it } from 'vitest'
import { describeError } from '../src/client/features/side-panels/error-boundary'
import { hostStackOf } from '../src/client/features/side-chat/api'

describe('describeError', () => {
  it('keeps the message and stack of a real Error', () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'length')")
    const detail = describeError(error)
    expect(detail.message).toContain('reading')
    expect(detail.stack).toBe(error.stack)
    expect(detail.stack).toContain('TypeError')
  })

  it('includes the React component stack when one is given', () => {
    const detail = describeError(new Error('boom'), '    in SideChatPanel\n    in Shell')
    expect(detail.componentStack).toBe('in SideChatPanel\n    in Shell')
  })

  it('omits an empty component stack rather than showing a blank section', () => {
    expect(describeError(new Error('boom'), '').componentStack).toBeUndefined()
    expect(describeError(new Error('boom'), '   ').componentStack).toBeUndefined()
  })

  it('handles a bare string throw', () => {
    expect(describeError('just a string')).toEqual({ message: 'just a string' })
  })

  it('handles null and primitives', () => {
    expect(describeError(null).message).toBe('null')
    expect(describeError(42).message).toBe('42')
    expect(describeError(undefined).message).toBe('undefined')
  })

  it('prefers a message field on an API error object', () => {
    expect(describeError({ message: 'parent session not found' }).message)
      .toBe('parent session not found')
  })

  it('falls back to an error field, then to JSON', () => {
    expect(describeError({ error: 'nested' }).message).toBe('nested')
    expect(describeError({ code: 404 }).message).toBe('{"code":404}')
  })

  it('never throws on a circular payload', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => describeError(cyclic)).not.toThrow()
  })
})

describe('hostStackOf', () => {
  it('reads a stack the Host sent', () => {
    expect(hostStackOf({ error: 'no', stack: 'at openSideChat (server.ts:183)' }))
      .toBe('at openSideChat (server.ts:183)')
  })

  it('ignores a missing or empty stack', () => {
    expect(hostStackOf({ error: 'no' })).toBeUndefined()
    expect(hostStackOf({ stack: '' })).toBeUndefined()
    expect(hostStackOf(null)).toBeUndefined()
    expect(hostStackOf('nope')).toBeUndefined()
  })
})
