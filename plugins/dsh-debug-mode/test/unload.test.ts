import { describe, expect, it } from 'vitest'
import { stripAgentLogRegions } from '../src/unload.ts'

describe('stripAgentLogRegions', () => {
  it('removes foldable probe blocks and leaves the surrounding code', () => {
    const source = [
      'const open = true',
      '// #region agent log',
      "fetch('http://127.0.0.1:51830/dsh-debug-mode/logs')",
      '// #endregion',
      'return open',
      '',
    ].join('\n')
    expect(stripAgentLogRegions(source)).toBe('const open = true\nreturn open\n')
  })
})
