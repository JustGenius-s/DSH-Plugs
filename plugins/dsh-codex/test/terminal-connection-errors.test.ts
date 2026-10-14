import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalConnectionController } from '../src/client/features/terminal/connection-controller'

class TestSocket {
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: TestSocket[] = []
  readyState = 1
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly url: string) { TestSocket.instances.push(this) }
  send() {}
  close() { this.readyState = 3; this.onclose?.() }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); TestSocket.instances = [] })

describe('terminal startup error handling', () => {
  it('stops retrying an unavailable shell and allows an explicit retry', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', TestSocket)
    vi.stubGlobal('window', { setTimeout, clearTimeout, location: { protocol: 'http:', host: 'localhost' } })
    const onState = vi.fn()
    const controller = new TerminalConnectionController({ onMessage: vi.fn(), onState, onMalformedMessage: vi.fn() })
    controller.connect({ sessionId: 'test-terminal', cwd: 'C:\\Project', shell: 'auto' })
    const first = TestSocket.instances[0]
    first.onmessage?.({ data: JSON.stringify({ type: 'error', message: 'shell unavailable' }) })
    first.close()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(TestSocket.instances).toHaveLength(1)
    expect(onState).toHaveBeenLastCalledWith('disconnected')
    controller.retryNow()
    expect(TestSocket.instances).toHaveLength(2)
    controller.dispose()
  })
})
