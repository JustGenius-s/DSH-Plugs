import { EventEmitter, once } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { connect } from 'node:net'
import { existsSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { launchNativeCapture } from '../src/native-launch.ts'

async function harness() {
  const opener = Object.assign(new EventEmitter(), { stderr: new PassThrough(), kill: vi.fn() })
  let ready!: (args: string[]) => void
  const launched = new Promise<string[]>((resolve) => { ready = resolve })
  const terminate = vi.fn()
  const process = launchNativeCapture('/local/Capture.app/Contents/MacOS/capture', ['--pid', '42'], {
    open: (args) => { ready(args); return opener as unknown as ChildProcess },
    terminate,
  })
  process.on('error', () => {})
  process.stdout.resume()
  process.stderr.resume()
  const args = await launched
  const path = args[args.indexOf('--ipc') + 1]!
  const token = args[args.indexOf('--token') + 1]!
  const socket = connect(path)
  await once(socket, 'connect')
  const authenticate = () => socket.write(JSON.stringify({ type: 'hello', protocol: 1, pid: 999, token }) + '\n')
  return { process, opener, terminate, args, path, token, socket, authenticate }
}

describe('LaunchServices capture transport', () => {
  it('launches a separate background app with an authenticated, private local channel', async () => {
    const h = await harness()
    expect(h.args.slice(0, 5)).toEqual(['-n', '-g', '-a', '/local/Capture.app', '--args'])
    expect(h.args.slice(-2)).toEqual(['--pid', '42'])
    expect(statSync(dirname(h.path)).mode & 0o777).toBe(0o700)
    expect(statSync(h.path).mode & 0o777).toBe(0o600)
    const data = once(h.process.stdout, 'data')
    h.authenticate()
    h.socket.write('{"type":"frame"}\n')
    expect(String((await data)[0])).toContain('"frame"')
    const stop = once(h.socket, 'data')
    h.process.stdin.end('stop\n')
    expect(String((await stop)[0])).toBe('stop\n')
    const exit = once(h.process, 'exit')
    h.socket.end()
    await exit
    expect(existsSync(dirname(h.path))).toBe(false)
    expect(h.terminate).not.toHaveBeenCalled()
  })
  it('does not confuse the open command exiting with the recording stopping', async () => {
    const h = await harness()
    const exit = vi.fn()
    h.process.on('exit', exit)
    h.opener.emit('exit', 0)
    expect(exit).not.toHaveBeenCalled()
    h.authenticate()
    const data = once(h.process.stdout, 'data')
    h.socket.write('ready\n')
    await data
    h.process.kill('SIGKILL')
    expect(h.terminate).toHaveBeenCalledWith(999, 'SIGKILL')
    expect(exit).toHaveBeenCalledWith(null, 'SIGKILL')
    expect(existsSync(h.path)).toBe(false)
  })
  it('rejects an unauthenticated connection without passing its pixels or PID through', async () => {
    const h = await harness()
    const data = vi.fn()
    h.process.stdout.on('data', data)
    const rejected = once(h.socket, 'close')
    h.socket.write(JSON.stringify({ type: 'hello', protocol: 1, pid: 999, token: 'wrong' }) + '\nprivate pixels')
    await rejected
    expect(data).not.toHaveBeenCalled()
    h.process.kill()
    expect(h.terminate).not.toHaveBeenCalled()
    expect(existsSync(h.path)).toBe(false)
  })
  it('reports launch errors and removes the host socket without an orphan recorder', async () => {
    const h = await harness()
    const failed = once(h.process, 'error')
    h.opener.emit('exit', 1)
    expect(String((await failed)[0])).toContain('LaunchServices')
    expect(existsSync(h.path)).toBe(false)
  })
  it('requires a bundle rather than inheriting the invoking shell permission', () => {
    expect(() => launchNativeCapture('/usr/bin/capture', [])).toThrow('signed .app')
  })
  it('cancels a late app launch when the host closes before the authenticated connection', async () => {
    const h = await harness()
    const exit = once(h.process, 'exit')
    h.process.stdin.end('stop\n')
    await exit
    expect(h.opener.kill).toHaveBeenCalled()
    expect(h.terminate).not.toHaveBeenCalled()
    expect(existsSync(h.path)).toBe(false)
  })
})
