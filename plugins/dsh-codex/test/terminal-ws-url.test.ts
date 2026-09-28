import { describe, expect, it } from 'vitest'
import {
  buildTerminalWsUrl,
  terminalTransportBaseUrl,
} from '../src/client/features/terminal/connection-controller'

/**
 * These cases pin the origin the terminal WebSocket dials.
 *
 * The Desktop shell serves this UI from its own `dsh-app://app` document and
 * proxies that document to the real Host, so `window.location.host` is the
 * literal `app` rather than `127.0.0.1:<port>`. Resolving the socket against
 * `window.location` therefore dials `ws://app/...`, which fails DNS and leaves
 * the pane stuck on "连接已断开，正在重新连接…" with a reconnect button that can
 * never succeed. The shell publishes the owned Host origin as
 * `__DSH_TRANSPORT__.streamBaseUrl`; that value must win.
 */
describe('terminalTransportBaseUrl', () => {
  it('prefers the Host origin the Desktop shell publishes', () => {
    expect(
      terminalTransportBaseUrl({ streamBaseUrl: 'http://127.0.0.1:58891' }, 'dsh-app://app/'),
    ).toBe('http://127.0.0.1:58891')
  })

  it('falls back to the document base for a plain web page', () => {
    expect(terminalTransportBaseUrl(undefined, 'http://127.0.0.1:58891/')).toBe(
      'http://127.0.0.1:58891/',
    )
  })

  it('falls back when a transport exists but carries no origin', () => {
    expect(terminalTransportBaseUrl({}, 'http://127.0.0.1:58891/')).toBe('http://127.0.0.1:58891/')
  })

  it('reports no origin when neither source is available', () => {
    expect(terminalTransportBaseUrl(undefined, undefined)).toBeUndefined()
  })
})

describe('buildTerminalWsUrl', () => {
  it('dials the real Host from the Desktop shell origin', () => {
    const url = buildTerminalWsUrl('/Users/morisi/Space', 'auto', 'dsh_token', 'http://127.0.0.1:58891')
    expect(url).toBe(
      'ws://127.0.0.1:58891/dsh-codex/terminal/ws?cwd=%2FUsers%2Fmorisi%2FSpace&session=dsh_token&rows=30&cols=100',
    )
  })

  it('never dials the shell document host', () => {
    const url = buildTerminalWsUrl('/tmp', 'auto', 'dsh_token', 'http://127.0.0.1:58891')
    expect(url).not.toContain('//app/')
  })

  it('upgrades to wss behind an https Host', () => {
    const url = buildTerminalWsUrl('/tmp', 'auto', 'dsh_token', 'https://host.example')
    expect(url.startsWith('wss://host.example/dsh-codex/terminal/ws?')).toBe(true)
  })

  it('omits cwd and shell when they carry no override', () => {
    const url = buildTerminalWsUrl(undefined, 'auto', 'dsh_token', 'http://127.0.0.1:58891')
    expect(url).not.toContain('cwd=')
    expect(url).not.toContain('shell=')
    expect(url).toContain('session=dsh_token')
  })

  it('keeps an explicit shell and escapes an awkward cwd', () => {
    const url = buildTerminalWsUrl('/tmp/a b&c', 'bash', 'dsh_token', 'http://127.0.0.1:58891')
    expect(url).toContain('shell=bash')
    expect(url).toContain('cwd=%2Ftmp%2Fa+b%26c')
  })
})
