import { describe, expect, it } from 'vitest'
import {
  absoluteFileAddress,
  fileAddressFor,
  filesNavigationFrom,
  fileTitleFromAddress,
  parseFileAddress,
  sessionFileAddress,
} from '../src/client/features/files/resource-address'

describe('Sidebar file resource addresses', () => {
  it('uses a session-relative address for relative and in-workspace paths', () => {
    expect(fileAddressFor('session 1', '/work/repo', 'src/a.ts')).toBe(
      'dsh-resource://file/session/session%201/src/a.ts',
    )
    expect(fileAddressFor('session 1', '/work/repo', '/work/repo/src/a.ts')).toBe(
      'dsh-resource://file/session/session%201/src/a.ts',
    )
    expect(fileAddressFor('session 1', '/work/repo/', '/work/repo')).toBe(
      'dsh-resource://file/session/session%201/',
    )
  })

  it('uses an absolute address outside the Session workspace', () => {
    expect(fileAddressFor('s1', '/work/repo', '/elsewhere/a.ts')).toBe(
      'dsh-resource://file/absolute/elsewhere/a.ts',
    )
    expect(parseFileAddress('dsh-resource://file/absolute/elsewhere/a.ts')).toEqual({
      scope: 'absolute',
      path: '/elsewhere/a.ts',
    })
  })

  it('round-trips encoded Session paths', () => {
    const address = sessionFileAddress('session/一', 'src/a b#c?.ts')
    expect(address).toBe(
      'dsh-resource://file/session/session%2F%E4%B8%80/src/a%20b%23c%3F.ts',
    )
    expect(parseFileAddress(address)).toEqual({
      scope: 'session',
      sessionId: 'session/一',
      path: 'src/a b#c?.ts',
    })
  })

  it('round-trips Windows drive and UNC paths', () => {
    const drive = absoluteFileAddress('C:\\work\\repo\\a b.ts')
    const unc = absoluteFileAddress('\\\\server\\share\\a.ts')
    expect(drive).toBe('dsh-resource://file/absolute/C:/work/repo/a%20b.ts')
    expect(parseFileAddress(drive)).toEqual({
      scope: 'absolute',
      path: 'C:/work/repo/a b.ts',
    })
    expect(unc).toBe('dsh-resource://file/absolute//server/share/a.ts')
    expect(parseFileAddress(unc)).toEqual({
      scope: 'absolute',
      path: '//server/share/a.ts',
    })
  })

  it('rejects unrelated or incomplete resources', () => {
    expect(parseFileAddress('https://example.com/a.ts')).toBeUndefined()
    expect(parseFileAddress('dsh-resource://other/session/s1/a.ts')).toBeUndefined()
    expect(parseFileAddress('dsh-resource://file/session/s1')).toBeUndefined()
    expect(parseFileAddress('not a resource')).toBeUndefined()
  })

  it('derives the title and viewer navigation state', () => {
    const address = sessionFileAddress('s1', 'src/a.ts')
    expect(fileTitleFromAddress(address, 'Files')).toBe('a.ts')
    expect(fileTitleFromAddress('invalid', 'Files')).toBe('Files')
    expect(filesNavigationFrom(address, { mode: 'diff', sha: 'abc123' })).toEqual({
      mode: 'diff',
      file: 'src/a.ts',
      sha: 'abc123',
    })
    expect(filesNavigationFrom(address, { mode: 'tree', sha: 42 })).toEqual({
      mode: 'preview',
      file: 'src/a.ts',
      sha: undefined,
    })
  })
})
