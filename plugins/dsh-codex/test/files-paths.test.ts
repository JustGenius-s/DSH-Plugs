import { describe, expect, it } from 'vitest'
import { absolutePathOf, relativePathOf } from '../src/client/features/files/files-actions'

/**
 * The two clipboard rows are pure string work, but they decide what the user
 * pastes into a terminal or an `@path` chip — so the spellings are pinned.
 */

const cwd = '/work/repo'

describe('relativePathOf', () => {
  it('strips the workspace root', () => {
    expect(relativePathOf('src/a.ts', cwd)).toBe('src/a.ts')
    expect(relativePathOf('src/nested/b.ts', cwd)).toBe('src/nested/b.ts')
  })

  it('returns undefined for the root itself — a relative path would be empty', () => {
    expect(relativePathOf('/work/repo', cwd)).toBeUndefined()
  })

  it('returns undefined for a path outside the workspace', () => {
    expect(relativePathOf('/elsewhere/x.ts', cwd)).toBeUndefined()
  })

  it('rejects a sibling that merely shares a prefix', () => {
    expect(relativePathOf('/work/repo-other/x.ts', cwd)).toBeUndefined()
  })

  it('keeps a relative row even without a cwd, but cannot reduce an absolute one', () => {
    // The row is already relative — no cwd needed to say so.
    expect(relativePathOf('src/a.ts', undefined)).toBe('src/a.ts')
    expect(relativePathOf('src/a.ts', '')).toBe('src/a.ts')
    // Reducing an absolute path does need the root.
    expect(relativePathOf('/work/repo/src/a.ts', undefined)).toBeUndefined()
  })

  it('normalizes a Windows-style cwd', () => {
    // A relative row is already relative, so the cwd spelling is irrelevant.
    expect(relativePathOf('src/a.ts', 'C:\\work\\repo')).toBe('src/a.ts')
    expect(relativePathOf('C:/work/repo/src/a.ts', 'C:\\work\\repo')).toBe('src/a.ts')
    // A Windows path outside that cwd has no relative spelling.
    expect(relativePathOf('D:/other/x.ts', 'C:\\work\\repo')).toBeUndefined()
  })
})

describe('absolutePathOf', () => {
  it('joins a relative row onto the cwd', () => {
    expect(absolutePathOf('src/a.ts', cwd)).toBe('/work/repo/src/a.ts')
  })

  it('passes an already-absolute path through unchanged', () => {
    expect(absolutePathOf('/elsewhere/x.ts', cwd)).toBe('/elsewhere/x.ts')
  })

  it('keeps a Windows drive path absolute', () => {
    expect(absolutePathOf('C:/work/x.ts', cwd)).toBe('C:/work/x.ts')
  })

  it('tolerates a trailing slash on the cwd', () => {
    expect(absolutePathOf('a.ts', '/work/repo/')).toBe('/work/repo/a.ts')
  })

  it('returns the row itself when there is no cwd', () => {
    expect(absolutePathOf('src/a.ts', undefined)).toBe('src/a.ts')
  })
})
