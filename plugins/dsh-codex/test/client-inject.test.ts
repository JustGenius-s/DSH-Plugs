import { describe, expect, it } from 'vitest'
import { CLIENT_SERVICES } from '@just-genius/dsh-plugin-runtime/client'
import { CODEX_CLIENT_INJECT } from '../src/client/inject'

describe('dsh-codex client service contract', () => {
  it('declares both the remote carrier and its guarded session namespace', () => {
    expect(CLIENT_SERVICES.remoteSession).toBe('remote.session')
    expect(CODEX_CLIENT_INJECT).toContain(CLIENT_SERVICES.remote)
    expect(CODEX_CLIENT_INJECT).toContain(CLIENT_SERVICES.remoteSession)
  })

  it('waits for the conversation controller used by Side Chat attachments', () => {
    expect(CLIENT_SERVICES.conversation).toBe('conversation')
    expect(CODEX_CLIENT_INJECT).toContain(CLIENT_SERVICES.conversation)
  })
})
