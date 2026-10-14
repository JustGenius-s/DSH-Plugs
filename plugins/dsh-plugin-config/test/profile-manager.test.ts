import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { createPluginProfileManager } from '../src/profile-manager.ts'

const mocks = vi.hoisted(() => ({
  repair: vi.fn(),
  run: vi.fn(),
  readPackage: vi.fn(),
  writePatch: vi.fn(),
  warn: vi.fn(),
}))
vi.mock('@just-genius/dsh-plugin-runtime/host', () => ({ repairWebProfileScopeIdentity: mocks.repair }))
vi.mock('../src/process.ts', () => ({
  runDsh: mocks.run,
  commandDetail: (value: { stdout: string; stderr: string }) => [value.stdout, value.stderr].filter(Boolean).join('\n'),
}))
vi.mock('../src/profile.ts', () => ({
  profileModifiedAt: () => 10,
  readPatchText: () => '',
  readProfilePackage: mocks.readPackage,
  removeDisablePatch: vi.fn(),
  writeDisablePatch: vi.fn(),
  writePatchText: mocks.writePatch,
}))

function manager() {
  return createPluginProfileManager({ logger: { warn: mocks.warn } } as unknown as Context)
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.readPackage.mockReturnValue({ dependencies: {} })
  mocks.run.mockResolvedValue({ code: 0, stdout: 'installed', stderr: '' })
})

describe('profile manager scope guard', () => {
  it('reports a startup repair and requires restart even for an unchanged reconcile', async () => {
    mocks.repair.mockReturnValueOnce('/backup')
    const profile = manager()
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('restart DSH'))
    expect(await profile.reconcile({ dependencies: {}, patchText: '' })).toMatchObject({ needsRestart: true })
  })

  it('does not break inventory when the startup scope check is unsupported', () => {
    mocks.repair.mockImplementationOnce(() => { throw new Error('no runtime') })
    expect(manager().snapshot()).toEqual({ dependencies: {}, patchText: '', modifiedAt: 10 })
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('no runtime'))
  })

  it('checks scope identity after a successful install', async () => {
    const profile = manager()
    expect(await profile.install('browser')).toEqual({ detail: 'installed', needsRestart: true })
    expect(mocks.run).toHaveBeenCalledWith(['plugin', '--profile', 'web', 'add', 'browser'], 180_000)
    expect(mocks.repair).toHaveBeenCalledTimes(2)
    expect(mocks.repair.mock.invocationCallOrder[1]).toBeGreaterThan(mocks.run.mock.invocationCallOrder[0])
  })

  it('checks scope identity after a nonzero command exit and retains the command error', async () => {
    const profile = manager()
    mocks.run.mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'install failed' })
    await expect(profile.install('browser')).rejects.toThrow('install failed')
    expect(mocks.repair).toHaveBeenCalledTimes(2)
  })

  it('checks scope identity after a spawn failure or timeout', async () => {
    const profile = manager()
    const error = new Error('timed out')
    mocks.run.mockRejectedValueOnce(error)
    await expect(profile.install('browser')).rejects.toBe(error)
    expect(mocks.repair).toHaveBeenCalledTimes(2)
  })

  it('retains both errors when a package operation and its repair fail', async () => {
    const profile = manager()
    mocks.run.mockRejectedValueOnce(new Error('timed out'))
    mocks.repair.mockImplementationOnce(() => { throw new Error('version mismatch') })
    await expect(profile.install('browser')).rejects.toThrow(/timed out\nProfile scope check failed:.*version mismatch/)
  })

  it('does not claim a successful install when sharing the scope failed', async () => {
    const profile = manager()
    mocks.repair.mockImplementationOnce(() => { throw new Error('version mismatch') })
    await expect(profile.install('browser')).rejects.toThrow(/Profile scope check failed/)
  })

  it('retains restart state when only a failed mutation repaired the scope', async () => {
    const profile = manager()
    mocks.run.mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'partial install' })
    mocks.repair.mockReturnValueOnce('/backup')
    const result = await profile.reconcile({ dependencies: { browser: '1.0' }, patchText: '' })
    expect(result).toMatchObject({
      added: [], removed: [], failed: [{ name: 'browser', error: 'partial install' }], needsRestart: true,
    })
  })

  it('serializes scope repair with mutations and allows recovery after a failed operation', async () => {
    const profile = manager()
    const order: string[] = []
    mocks.run
      .mockImplementationOnce(async () => { order.push('first'); throw new Error('first failed') })
      .mockImplementationOnce(async () => { order.push('second'); return { code: 0, stdout: '', stderr: '' } })
    mocks.repair.mockImplementation(() => { order.push('repair') })
    const first = profile.install('first')
    const second = profile.install('second')
    await expect(first).rejects.toThrow('first failed')
    await second
    expect(order).toEqual(['first', 'repair', 'second', 'repair'])
  })
})
