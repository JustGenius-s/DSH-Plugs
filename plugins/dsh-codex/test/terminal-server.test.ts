import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import type { WebSocket } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeSession, onTerminalData, openSession, type TerminalSession } from '../src/host/terminal/server'

vi.mock('node:child_process', () => {
  const execFile = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: async () => ({ stdout: '', stderr: '' }),
  })
  return { execFile }
})

class Socket extends EventEmitter {
  OPEN = 1
  readyState = 1
  messages: Array<Record<string, unknown>> = []
  send(text: string) { this.messages.push(JSON.parse(text)) }
  close() { this.readyState = 3; this.emit('close') }
}

const sessions: TerminalSession[] = []
afterEach(() => { for (const session of sessions.splice(0)) closeSession(session); vi.useRealTimers() })

async function fixture(executable = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', preference = 'pwsh') {
  const ws = new Socket()
  const handle = {
    pid: 1, output: new PassThrough(), done: new Promise<never>(() => {}),
    write: vi.fn(async (_data: string) => {}), terminate: vi.fn(async () => {}),
    signalForeground: vi.fn(async () => 1),
  }
  const subprocess = {
    resolveExecutable: vi.fn(async () => executable),
    spawnTerminal: vi.fn(async (_spec: Parameters<Context['subprocess']['spawnTerminal']>[0]) => handle),
  }
  const request = { url: `/dsh-codex/terminal/ws?cwd=C%3A%5CProject&shell=${preference}` } as IncomingMessage
  const session = await openSession({ subprocess } as unknown as Context, ws as unknown as WebSocket, request)
  expect(session).toBeDefined()
  sessions.push(session!)
  return { ws, handle, subprocess, session: session! }
}

describe('terminal host protocol', () => {
  it.skipIf(process.platform !== 'win32')('keeps the requested cwd when Git Bash loads its login profile', async () => {
    const { subprocess } = await fixture('C:\\Program Files\\Git\\bin\\bash.exe', 'bash')
    const spec = subprocess.spawnTerminal.mock.calls[0][0]
    expect(spec.argv).toEqual(['C:\\Program Files\\Git\\bin\\bash.exe', '-l'])
    expect(spec.env?.CHERE_INVOKING).toBe('1')
    expect(spec.cwd).toBe('C:\\Project')
  })
  it('starts PowerShell with encoded initialization and keeps foreground input raw', async () => {
    const { ws, handle, subprocess, session } = await fixture()
    const spawn = subprocess.spawnTerminal.mock.calls[0] as unknown as [{ argv: string[]; cwd: string }]
    expect(spawn[0].argv).toContain('-EncodedCommand')
    expect(spawn[0].argv).not.toContain('-l')
    expect(spawn[0].cwd).toBe('C:\\Project')
    onTerminalData(session, '\x1b]777;warp-block-end;0;C:\\Project\x07')
    ws.emit('message', JSON.stringify({ type: 'command', command: "$value = '中文'\nWrite-Output $value" }))
    const encoded = handle.write.mock.calls[0]?.[0] as unknown as string
    expect(encoded).toMatch(/^\. __dsh_run '[A-Za-z0-9+/=]+'\r$/)
    ws.emit('message', JSON.stringify({ type: 'input', data: 'interactive input\r' }))
    expect(handle.write).toHaveBeenLastCalledWith('interactive input\r')
  })

  it.skipIf(process.platform !== 'win32')('retains ConPTY output that arrives after the end marker', async () => {
    vi.useFakeTimers()
    const { ws, session } = await fixture()
    onTerminalData(session, '\x1b]777;warp-block-end;0;C:\\Project\x07')
    ws.messages.length = 0
    onTerminalData(session, ". __dsh_run 'hidden transport'\r\n\x1b]777;warp-block-st")
    onTerminalData(session, 'art;\x07first\r\n\x1b]777;warp-block-end;7;C:\\中文 项目\x07')
    onTerminalData(session, 'last output\r\n')
    expect(ws.messages.some(message => message.type === 'block-end')).toBe(false)
    await vi.advanceTimersByTimeAsync(50)
    const output = ws.messages.filter(message => message.type === 'output').map(message => message.text).join('')
    expect(output).toBe('first\r\nlast output\r\n')
    expect(ws.messages.find(message => message.type === 'block-end')).toEqual({ type: 'block-end', exitCode: 7 })
    expect(session.cwd).toBe('C:\\中文 项目')
    expect(session.mode).toBe('prompt')
  })

  it('terminates a shell that never finishes initialization', async () => {
    vi.useFakeTimers()
    const { ws, handle } = await fixture()
    await vi.advanceTimersByTimeAsync(20_001)
    expect(ws.messages.some(message => message.type === 'error' && String(message.message).includes('initialization timed out'))).toBe(true)
    expect(handle.terminate).toHaveBeenCalledOnce()
    expect(ws.readyState).toBe(3)
  })
})
