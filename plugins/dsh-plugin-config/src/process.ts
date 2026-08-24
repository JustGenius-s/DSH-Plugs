import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function resolveDshBin(): string {
  if (process.env.DSH_BIN) return process.env.DSH_BIN
  const argv1 = process.argv[1] ?? ''
  if (argv1.endsWith(`${join('dsh', 'lib', 'bin.js')}`)) {
    const shim = join(argv1, '..', '..', '..', '.bin', 'dsh')
    if (existsSync(shim)) return shim
  }
  if (argv1.endsWith(`${join('.bin', 'dsh')}`) && existsSync(argv1)) return argv1
  const root = process.env.DSH_HOME || join(homedir(), '.dsh')
  const candidate = join(root, 'runtime', 'node_modules', '.bin', 'dsh')
  return existsSync(candidate) ? candidate : 'dsh'
}

export function runDsh(args: readonly string[], timeoutMs: number): Promise<{
  code: number
  stdout: string
  stderr: string
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveDshBin(), [...args], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
  })
}

export function commandDetail(result: { stdout: string; stderr: string }): string {
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim().slice(0, 4000)
}
