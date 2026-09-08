import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import {
  hostPlatform,
  revealInFileManager,
  revealSupported,
  resolveWithinWorkspace,
} from '../src/host/files/reveal'

/**
 * These cases pin the two things that can silently break the panel's reveal
 * row: the workspace-containment rule (a browser must not become a launcher
 * for arbitrary host paths) and the per-platform argv.
 */

function workspace(): { cwd: string; file: string; dir: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-codex-reveal-'))
  const dir = join(cwd, 'src')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'a.ts')
  writeFileSync(file, 'export const a = 1\n')
  return { cwd, file, dir }
}

function spawnRecorder() {
  const calls: Array<{ argv: readonly string[]; cwd: string }> = []
  return {
    calls,
    subprocess: {
      spawn: (spec: { argv: readonly string[]; cwd: string }) => {
        calls.push({ argv: spec.argv, cwd: spec.cwd })
        return { done: Promise.resolve({ exitCode: 0, signal: null, timedOut: false }) }
      },
      resolveExecutable: async (command: string) => `C:\\Windows\\${command}.exe`,
    },
  }
}

describe('resolveWithinWorkspace', () => {
  it('joins a workspace-relative path onto cwd', () => {
    const { cwd } = workspace()
    const result = resolveWithinWorkspace(cwd, 'src/a.ts')
    expect(result).toBe(resolve(cwd, 'src/a.ts'))
    expect(isAbsolute(result ?? '')).toBe(true)
  })

  it('accepts the workspace root itself', () => {
    const { cwd } = workspace()
    expect(resolveWithinWorkspace(cwd, '.')).toBe(resolve(cwd))
  })

  it('rejects a path that escapes the workspace', () => {
    const { cwd } = workspace()
    expect(resolveWithinWorkspace(cwd, '../outside')).toBeUndefined()
    expect(resolveWithinWorkspace(cwd, '/etc/passwd')).toBeUndefined()
  })

  it('rejects a sibling directory that merely shares a prefix', () => {
    const { cwd } = workspace()
    // `/work/repo-other` starts with `/work/repo` but is not inside it.
    const sibling = `${cwd}-other/secret`
    expect(resolveWithinWorkspace(cwd, sibling)).toBeUndefined()
  })

  it('rejects NUL bytes and an empty cwd', () => {
    const { cwd } = workspace()
    expect(resolveWithinWorkspace(cwd, 'a\0b')).toBeUndefined()
    expect(resolveWithinWorkspace('\0', 'a')).toBeUndefined()
    expect(resolveWithinWorkspace('', 'a')).toBeUndefined()
  })
})

describe('hostPlatform', () => {
  it('maps the three supported platforms and buckets the rest', () => {
    expect(hostPlatform('darwin')).toBe('darwin')
    expect(hostPlatform('win32')).toBe('win32')
    expect(hostPlatform('linux')).toBe('linux')
    expect(hostPlatform('freebsd')).toBe('unknown')
  })

  it('is supported exactly where a file manager opener exists', () => {
    expect(revealSupported(hostPlatform('darwin'))).toBe(true)
    expect(revealSupported(hostPlatform('win32'))).toBe(true)
    expect(revealSupported(hostPlatform('linux'))).toBe(true)
    expect(revealSupported(hostPlatform('freebsd'))).toBe(false)
  })
})

describe('revealInFileManager', () => {
  it('selects the file with `open -R` on macOS', async () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' })
    const { cwd, file } = workspace()
    const rec = spawnRecorder()
    await revealInFileManager({ subprocess: rec.subprocess } as never, cwd, {
      absolutePath: file,
      directory: false,
    })
    expect(rec.calls[0]?.argv).toEqual(['/usr/bin/open', '-R', file])
    vi.unstubAllGlobals()
  })

  it('uses Explorer /select, on Windows and resolves explorer through the seam', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    const { cwd, file } = workspace()
    const rec = spawnRecorder()
    await revealInFileManager({ subprocess: rec.subprocess } as never, cwd, {
      absolutePath: file,
      directory: false,
    })
    expect(rec.calls[0]?.argv).toEqual(['C:\\Windows\\explorer.exe', `/select,${file}`])
    vi.unstubAllGlobals()
  })

  it('opens the containing directory on Linux, and the folder itself for a dir row', async () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' })
    const { cwd, file, dir } = workspace()
    const rec = spawnRecorder()
    await revealInFileManager({ subprocess: rec.subprocess } as never, cwd, {
      absolutePath: file,
      directory: false,
    })
    await revealInFileManager({ subprocess: rec.subprocess } as never, cwd, {
      absolutePath: dir,
      directory: true,
    })
    expect(rec.calls[0]?.argv).toEqual(['/usr/bin/xdg-open', dir])
    expect(rec.calls[1]?.argv).toEqual(['/usr/bin/xdg-open', dir])
    vi.unstubAllGlobals()
  })

  it('fails with a readable message when the row is stale', async () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' })
    const { cwd } = workspace()
    const rec = spawnRecorder()
    await expect(
      revealInFileManager({ subprocess: rec.subprocess } as never, cwd, {
        absolutePath: join(cwd, 'gone.ts'),
        directory: false,
      }),
    ).rejects.toThrow(/does not exist/)
    // The opener must not be launched for a path that is not there.
    expect(rec.calls).toEqual([])
    vi.unstubAllGlobals()
  })

  it('surfaces a non-zero file-manager exit as a failure', async () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' })
    const { cwd, file } = workspace()
    const subprocess = {
      spawn: () => ({ done: Promise.resolve({ exitCode: 1, signal: null, timedOut: false }) }),
      resolveExecutable: async (c: string) => c,
    }
    await expect(
      revealInFileManager({ subprocess } as never, cwd, {
        absolutePath: file,
        directory: false,
      }),
    ).rejects.toThrow(/exited with code 1/)
    vi.unstubAllGlobals()
  })
})
