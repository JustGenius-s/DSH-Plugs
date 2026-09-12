import { spawn, type ChildProcess } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'

type SpawnOpener = (command: string, args: readonly string[]) => ChildProcess

function defaultSpawn(command: string, args: readonly string[]): ChildProcess {
  return spawn(command, [...args], { detached: true, stdio: 'ignore' })
}

/** Resolve only after the opener reports a successful process exit. */
export function spawnOpener(
  command: string,
  args: readonly string[],
  spawnProcess: SpawnOpener = defaultSpawn,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const child = spawnProcess(command, args)
    child.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.on('exit', (code) => {
      if (settled) return
      settled = true
      child.unref()
      if (code === 0) resolve()
      else reject(new Error(code === null ? 'opener terminated before completion' : `opener exited with code ${code}`))
    })
  })
}

/** Reveal an existing path in the platform file manager. */
export async function openInOs(path: string): Promise<void> {
  const directory = statSync(path).isDirectory()
  if (process.platform === 'win32') {
    const explorer = process.env.SystemRoot
      ? join(process.env.SystemRoot, 'explorer.exe')
      : 'explorer.exe'
    await spawnOpener(explorer, directory ? [path] : [`/select,${path}`])
    return
  }
  if (process.platform === 'darwin') {
    await spawnOpener('open', [path])
    return
  }
  const candidates: Array<{ command: string; args: string[] }> = [
    { command: 'xdg-open', args: [path] },
    { command: 'gio', args: ['open', path] },
    { command: 'nautilus', args: [path] },
    { command: 'dolphin', args: [path] },
    { command: 'thunar', args: [path] },
    { command: 'pcmanfm', args: [path] },
  ]
  let lastError: unknown
  for (const candidate of candidates) {
    try {
      await spawnOpener(candidate.command, candidate.args)
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('no file manager available')
}
