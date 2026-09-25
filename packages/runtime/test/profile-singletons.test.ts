import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { repairProfileScopeIdentity, repairWebProfileScopeIdentity } from '../src/profile-singletons.ts'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, symlinkSync: vi.fn(actual.symlinkSync), renameSync: vi.fn(actual.renameSync) }
})

const roots: string[] = []
const scopeName = '@deepseek-ai/dsh-scope'

function makePackage(path: string, name: string, version = '0.1.6-alpha.1'): string {
  fs.mkdirSync(join(path, 'lib'), { recursive: true })
  fs.writeFileSync(join(path, 'package.json'), JSON.stringify({ name, version, main: 'lib/index.js' }))
  fs.writeFileSync(join(path, 'lib/index.js'), `export const identity = Symbol(${JSON.stringify(name)})`)
  return path
}

function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'dsh-singletons-'))
  roots.push(root)
  const profile = join(root, 'profiles/web')
  const local = makePackage(join(profile, 'node_modules', scopeName), scopeName)
  const host = join(root, 'runtime/node_modules')
  const target = makePackage(join(host, scopeName), scopeName)
  const tools = makePackage(join(host, '@deepseek-ai/dsh-tools'), '@deepseek-ai/dsh-tools')
  makePackage(join(host, '@deepseek-ai/dsh'), '@deepseek-ai/dsh')
  return { root, profile, local, target, entry: join(tools, 'lib/index.js') }
}

afterEach(() => {
  vi.restoreAllMocks()
  while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('profile scope identity', () => {
  it('replaces an exact-version directory with the Host instance and preserves a backup', () => {
    const f = fixture()
    const original = fs.readFileSync(join(f.local, 'lib/index.js'), 'utf8')
    const backup = repairProfileScopeIdentity(f.profile, f.entry)!
    expect(fs.lstatSync(f.local).isSymbolicLink()).toBe(true)
    expect(fs.realpathSync(f.local)).toBe(fs.realpathSync(f.target))
    expect(fs.readFileSync(join(backup, 'lib/index.js'), 'utf8')).toBe(original)
    expect(fs.lstatSync(f.target).isDirectory()).toBe(true)
    expect(repairProfileScopeIdentity(f.profile, f.entry)).toBeUndefined()
    expect(fs.readdirSync(join(f.profile, '.dsh-singleton-backups'))).toHaveLength(1)
  })

  it('does not need an installed Host when no local scope can shadow it', () => {
    const f = fixture()
    fs.rmSync(f.local, { recursive: true })
    expect(repairProfileScopeIdentity(f.profile, '/missing-host')).toBeUndefined()
    expect(repairWebProfileScopeIdentity(join(f.root, 'absent'))).toBeUndefined()
  })

  it('leaves mismatched versions untouched', () => {
    const f = fixture()
    makePackage(f.local, scopeName, '0.1.5')
    expect(() => repairProfileScopeIdentity(f.profile, f.entry)).toThrow(/profile 0.1.5, host 0.1.6-alpha.1/)
    expect(fs.lstatSync(f.local).isDirectory()).toBe(true)
    expect(fs.existsSync(join(f.profile, '.dsh-singleton-backups'))).toBe(false)
  })

  it('rejects malformed manifests before moving any dependency', () => {
    const f = fixture()
    fs.writeFileSync(join(f.local, 'package.json'), '{"name":"other"}')
    expect(() => repairProfileScopeIdentity(f.profile, f.entry)).toThrow(/Invalid.*manifest/)
    expect(fs.lstatSync(f.local).isDirectory()).toBe(true)
    expect(fs.existsSync(join(f.profile, '.dsh-singleton-backups'))).toBe(false)
  })

  it('does not touch a store behind a duplicate relative symlink; backup can be moved back', () => {
    const f = fixture()
    const stored = join(f.root, 'store/dsh-scope')
    fs.mkdirSync(dirname(stored), { recursive: true })
    fs.renameSync(f.local, stored)
    const link = relative(dirname(f.local), stored)
    fs.symlinkSync(link, f.local, 'dir')
    const backup = repairProfileScopeIdentity(f.profile, f.entry)!
    expect(fs.readlinkSync(backup)).toBe(link)
    expect(fs.lstatSync(stored).isDirectory()).toBe(true)
    fs.unlinkSync(f.local)
    fs.renameSync(backup, f.local)
    expect(fs.realpathSync(f.local)).toBe(fs.realpathSync(stored))
  })

  it('does not move the original when link creation fails', () => {
    const f = fixture()
    vi.mocked(fs.symlinkSync).mockImplementationOnce(() => { throw new Error('link denied') })
    expect(() => repairProfileScopeIdentity(f.profile, f.entry)).toThrow('link denied')
    expect(fs.lstatSync(f.local).isDirectory()).toBe(true)
    expect(fs.readdirSync(dirname(f.local))).toEqual(['dsh-scope'])
  })

  it('cleans up staging when the original cannot be moved', () => {
    const f = fixture()
    vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error('move denied') })
    expect(() => repairProfileScopeIdentity(f.profile, f.entry)).toThrow('move denied')
    expect(fs.lstatSync(f.local).isDirectory()).toBe(true)
    expect(fs.readdirSync(dirname(f.local))).toEqual(['dsh-scope'])
  })

  it('rolls back the original if installing the staged link fails', async () => {
    const f = fixture()
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
    vi.mocked(fs.renameSync)
      .mockImplementationOnce(actual.renameSync)
      .mockImplementationOnce(() => { throw new Error('replacement denied') })
    expect(() => repairProfileScopeIdentity(f.profile, f.entry)).toThrow('replacement denied')
    expect(fs.lstatSync(f.local).isDirectory()).toBe(true)
    expect(fs.readdirSync(dirname(f.local))).toEqual(['dsh-scope'])
    expect(fs.readdirSync(join(f.profile, '.dsh-singleton-backups'))).toEqual([])
  })

  it('resolves Host peers from the real dsh installation, not a hoisted shadow', () => {
    const f = fixture()
    const dsh = join(f.root, 'runtime/node_modules/@deepseek-ai/dsh')
    const owner = join(f.root, 'runtime/store/owner/node_modules/@deepseek-ai')
    fs.mkdirSync(owner, { recursive: true })
    fs.renameSync(dsh, join(owner, 'dsh'))
    fs.symlinkSync(join(owner, 'dsh'), dsh, 'dir')
    const actualScope = makePackage(join(owner, 'dsh-scope'), scopeName)
    makePackage(join(owner, 'dsh-tools'), '@deepseek-ai/dsh-tools')
    repairWebProfileScopeIdentity(f.root)
    expect(fs.realpathSync(f.local)).toBe(fs.realpathSync(actualScope))
    expect(fs.realpathSync(f.local)).not.toBe(fs.realpathSync(f.target))
  })
})
