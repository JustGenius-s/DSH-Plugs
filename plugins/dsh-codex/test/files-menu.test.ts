import { describe, expect, it } from 'vitest'
import { buildFilesMenu, revealLabelKey, type FilesMenuTarget } from '../src/client/features/files/files-menu'
import type { FilesHostInfo } from '../src/client/features/files/files-actions'

const cwd = '/work/repo'
const en = (key: string) => key

function target(overrides: Partial<FilesMenuTarget> = {}): FilesMenuTarget {
  return { path: 'src/a.ts', kind: 'file', cwd, ...overrides }
}

function ids(entries: ReturnType<typeof buildFilesMenu>): string[] {
  return entries.map(entry => ('type' in entry ? `<${entry.type}>` : entry.id))
}

const darwin: FilesHostInfo = { platform: 'darwin', revealSupported: true }
const win32: FilesHostInfo = { platform: 'win32', revealSupported: true }
const linux: FilesHostInfo = { platform: 'linux', revealSupported: true }
const unsupported: FilesHostInfo = { platform: 'unknown', revealSupported: false }

describe('buildFilesMenu', () => {
  it('puts clipboard rows behind a separator, after the actions', () => {
    const entries = buildFilesMenu(target(), { canAddToChat: true, hostInfo: darwin }, en)
    expect(ids(entries)).toEqual([
      'add-to-chat',
      'reveal',
      '<separator>',
      'copy-path',
      'copy-relative-path',
    ])
  })

  it('drops the separator when there is no action above it', () => {
    // No chat + unsupported host: a bare hairline above the rows is noise.
    const entries = buildFilesMenu(target(), { canAddToChat: false, hostInfo: unsupported }, en)
    expect(ids(entries)).toEqual(['copy-path', 'copy-relative-path'])
    expect(entries.some(entry => 'type' in entry)).toBe(false)
  })

  it('omits the reveal row when the host has no file manager', () => {
    const entries = buildFilesMenu(target(), { canAddToChat: true, hostInfo: unsupported }, en)
    expect(ids(entries)).toEqual([
      'add-to-chat',
      '<separator>',
      'copy-path',
      'copy-relative-path',
    ])
  })

  it('omits add-to-chat when no conversation can take it', () => {
    const entries = buildFilesMenu(target(), { canAddToChat: false, hostInfo: darwin }, en)
    expect(ids(entries)).toEqual(['reveal', '<separator>', 'copy-path', 'copy-relative-path'])
  })

  it('keeps the separator while the host probe is still pending', () => {
    // Undefined hostInfo must not flash an extra row, but the chat row stands.
    const entries = buildFilesMenu(target(), { canAddToChat: true }, en)
    expect(ids(entries)).toEqual([
      'add-to-chat',
      '<separator>',
      'copy-path',
      'copy-relative-path',
    ])
  })

  it('disables relative path for a path outside the workspace, but keeps the row', () => {
    const entries = buildFilesMenu(
      target({ path: '/elsewhere/x.ts' }),
      { canAddToChat: true, hostInfo: darwin },
      en,
    )
    const relative = entries.find(entry => !('type' in entry) && entry.id === 'copy-relative-path')
    expect(relative).toBeDefined()
    expect(relative && 'disabled' in relative && relative.disabled).toBe(true)
  })

  it('enables relative path for a workspace row', () => {
    const entries = buildFilesMenu(target(), { canAddToChat: true, hostInfo: darwin }, en)
    const relative = entries.find(entry => !('type' in entry) && entry.id === 'copy-relative-path')
    expect(relative && 'disabled' in relative && relative.disabled).toBe(false)
  })

  it('names the reveal row after the host platform', () => {
    const label = (info: FilesHostInfo): unknown => {
      const entries = buildFilesMenu(target(), { canAddToChat: true, hostInfo: info }, en)
      const row = entries.find(entry => !('type' in entry) && entry.id === 'reveal')
      return row !== undefined && 'label' in row ? row.label : undefined
    }
    expect(label(darwin)).toBe('context.reveal')
    expect(label(win32)).toBe('context.revealWindows')
    expect(label(linux)).toBe('context.revealLinux')
  })

  it('groups a directory row the same way', () => {
    const entries = buildFilesMenu(target({ kind: 'dir', path: 'src' }), {
      canAddToChat: true,
      hostInfo: darwin,
    }, en)
    expect(ids(entries)).toEqual([
      'add-to-chat',
      'reveal',
      '<separator>',
      'copy-path',
      'copy-relative-path',
    ])
  })
})

describe('revealLabelKey', () => {
  it('falls back to Finder for darwin and unprobed hosts', () => {
    expect(revealLabelKey('darwin')).toBe('context.reveal')
    expect(revealLabelKey('unknown')).toBe('context.reveal')
  })
})
