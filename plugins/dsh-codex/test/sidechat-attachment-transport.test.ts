/**
 * Attachment reads across both transports.
 *
 * DSH 0.1.2 moved session reads off the `connection.api` envelope
 * (`sessions.attachment`, wrapped in `{ result: { ok, value } }`) onto the
 * Typert remote (`ctx.remote.session.attachment`, which resolves to the value
 * and rejects on failure). The envelope namespace is gone, so the loader has
 * to work with whichever face is mounted — and must not silently report
 * "无法加载" for an image the host could serve.
 */

import { describe, expect, it, vi } from 'vitest'
import { readAttachmentData } from '../src/client/features/side-chat/connection'
import { remoteSessionApiOf } from '../src/client/features/side-chat/connection'

const envelope = (data: string | undefined, ok = true) => ({
  sessions: {
    attachment: async () => ({ result: { ok, value: { data }, error: { message: 'denied' } } }),
  },
})

const remote = (data: string) => ({
  session: { attachment: async () => ({ data }) },
})

describe('readAttachmentData', () => {
  it('reads through the 0.1.2 remote', async () => {
    await expect(readAttachmentData(remote('data:image/png;base64,AAA'), 's1', 'a1')).resolves.toBe('data:image/png;base64,AAA')
  })

  it('reads through the legacy envelope', async () => {
    await expect(readAttachmentData(envelope('data:image/png;base64,BBB'), 's1', 'a1')).resolves.toBe('data:image/png;base64,BBB')
  })

  it('passes the session and attachment ids through', async () => {
    const attachment = vi.fn(async () => ({ data: 'x' }))
    await readAttachmentData({ session: { attachment } }, 'sess-9', 'att-3')
    expect(attachment).toHaveBeenCalledWith({ sessionId: 'sess-9', attachmentId: 'att-3' })
  })

  it('rejects a refused envelope read so the image renders as an error', async () => {
    await expect(readAttachmentData(envelope(undefined, false), 's1', 'a1')).rejects.toThrow('denied')
  })

  it('rejects an envelope read that came back with no data', async () => {
    await expect(readAttachmentData(envelope(undefined), 's1', 'a1')).rejects.toThrow()
  })

  it('propagates a remote rejection', async () => {
    const failing = { session: { attachment: async () => { throw new Error('gone') } } }
    await expect(readAttachmentData(failing, 's1', 'a1')).rejects.toThrow('gone')
  })
})

describe('remoteSessionApiOf', () => {
  const face = { attachment: async () => ({ data: 'x' }) }

  it('reads the dotted session namespace directly through ctx.get', () => {
    const ctx = { get: (name: string) => (name === 'remote.session' ? face : undefined) }
    expect(remoteSessionApiOf(ctx)).toEqual({ session: face })
  })

  it('supports a legacy remote carrier returned by ctx.get', () => {
    const ctx = { get: (name: string) => (name === 'remote' ? { session: face } : undefined) }
    expect(remoteSessionApiOf(ctx)).toEqual({ session: face })
  })

  it('falls back to a direct property', () => {
    expect(remoteSessionApiOf({ remote: { session: face } })).toEqual({ session: face })
  })

  it('returns undefined when the namespace is not mounted', () => {
    // This is the fallback case: the plugin keeps the envelope path alive.
    expect(remoteSessionApiOf({ get: () => undefined })).toBeUndefined()
    expect(remoteSessionApiOf({ remote: {} })).toBeUndefined()
    expect(remoteSessionApiOf({})).toBeUndefined()
  })

  it('returns undefined when the namespace has no attachment call', () => {
    expect(remoteSessionApiOf({ remote: { session: {} } })).toBeUndefined()
  })

  it('survives a proxy that throws on remote', () => {
    const throwing = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'remote') throw new Error('cannot get property "remote" without inject')
        return undefined
      },
    })
    expect(remoteSessionApiOf(throwing)).toBeUndefined()
  })

  it('survives a traceable remote carrier that guards its session namespace', () => {
    const remote = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'session') throw new Error('cannot get property "remote.session" without inject')
        return undefined
      },
    })
    const ctx = { get: (name: string) => (name === 'remote' ? remote : undefined) }
    expect(remoteSessionApiOf(ctx)).toBeUndefined()
  })
})
