import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { PassThrough, type Readable, type Writable } from 'node:stream'

export interface CaptureProcess extends EventEmitter {
  stdin: Writable
  stdout: Readable
  stderr: Readable
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  kill(signal?: NodeJS.Signals): boolean
}

interface LaunchOptions {
  open?: (args: string[]) => ChildProcess
  terminate?: (pid: number, signal: NodeJS.Signals) => void
}

/** LaunchServices owns TCC attribution; the private socket owns stream lifetime. */
export function launchNativeCapture(binary: string, args: string[], options: LaunchOptions = {}): CaptureProcess {
  const bundle = dirname(dirname(dirname(binary)))
  if (!bundle.endsWith('.app')) throw new Error('Native capture must run from its signed .app bundle')
  // macOS Unix socket paths have a 104-byte limit; its long per-user TMPDIR
  // often exceeds that. mkdtemp creates a private, nonpredictable directory.
  const directory = mkdtempSync('/tmp/dsh-window-')
  chmodSync(directory, 0o700)
  const path = join(directory, 'stream.sock')
  const token = randomBytes(32).toString('hex')
  const input = new PassThrough()
  const output = new PassThrough()
  const errors = new PassThrough()
  const handle: CaptureProcess = Object.assign(new EventEmitter(), {
    stdin: input, stdout: output, stderr: errors,
    exitCode: null as number | null, signalCode: null as NodeJS.Signals | null,
    kill: (signal: NodeJS.Signals = 'SIGTERM') => {
      if (finished) return false
      if (helperPid !== undefined && connection !== undefined && !connection.destroyed) {
        try { (options.terminate ?? process.kill)(helperPid, signal) } catch {}
      }
      opener?.kill(signal)
      finish(null, signal)
      return true
    },
  })
  let finished = false
  let helperPid: number | undefined
  let opener: ChildProcess | undefined
  let connection: Socket | undefined
  const candidates = new Set<Socket>()
  const server = createServer((socket) => {
    if (finished || connection !== undefined) { socket.destroy(); return }
    candidates.add(socket)
    socket.on('error', () => socket.destroy())
    socket.once('close', () => candidates.delete(socket))
    let hello = Buffer.alloc(0)
    const authenticate = (chunk: Buffer) => {
      hello = Buffer.concat([hello, chunk])
      const newline = hello.indexOf(10)
      if (newline < 0 && hello.length <= 4096) return
      if (newline < 0 || newline > 4096) { socket.destroy(); return }
      try {
        const value = JSON.parse(hello.subarray(0, newline).toString('utf8'))
        if (value.type !== 'hello' || value.token !== token || value.protocol !== 1
          || !Number.isSafeInteger(value.pid) || value.pid <= 0 || value.pid > 0x7FFF_FFFF) {
          socket.destroy()
          return
        }
        helperPid = value.pid
      } catch { socket.destroy(); return }
      connection = socket
      socket.off('data', authenticate)
      for (const candidate of candidates) if (candidate !== socket) candidate.destroy()
      server.close()
      socket.once('close', () => finish(0, null))
      socket.pipe(output)
      input.pipe(socket)
      const remainder = hello.subarray(newline + 1)
      if (remainder.length > 0) output.write(remainder)
    }
    socket.on('data', authenticate)
  })
  function finish(code: number | null, signal: NodeJS.Signals | null): void {
    if (finished) return
    finished = true
    handle.exitCode = code
    handle.signalCode = signal
    server.close()
    for (const socket of candidates) socket.destroy()
    input.destroy()
    output.end()
    errors.end()
    rmSync(directory, { recursive: true, force: true })
    handle.emit('exit', code, signal)
  }
  const failed = (error: Error): void => {
    if (finished) return
    handle.emit('error', error)
    finish(1, null)
  }
  input.on('finish', () => {
    // A preview closed while LaunchServices is still starting must not leave
    // a late recorder. Removing the socket also makes that late app exit.
    if (connection === undefined && !finished) {
      opener?.kill()
      finish(0, null)
    }
  })
  server.on('error', failed)
  server.listen(path, () => {
    if (finished) return
    chmodSync(path, 0o600)
    try {
      const openArgs = ['-n', '-g', '-a', bundle, '--args', '--ipc', path, '--token', token, ...args]
      opener = (options.open ?? ((values) => spawn('/usr/bin/open', values, { stdio: ['ignore', 'ignore', 'pipe'] })))(openArgs)
      opener.stderr?.pipe(errors, { end: false })
      opener.on('error', failed)
      opener.on('exit', (code) => {
        if (code !== 0) failed(new Error(`LaunchServices could not start DSH Window Capture (${code})`))
      })
    } catch (error) { failed(error instanceof Error ? error : new Error(String(error))) }
  })
  return handle
}
