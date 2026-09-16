import { describe, expect, it } from 'vitest'
import { renderBrowserLogHelper } from '../src/helpers.ts'

describe('renderBrowserLogHelper', () => {
  it('bakes the ingest URL only and stays free of Node builtins', () => {
    const source = renderBrowserLogHelper({
      url: 'http://127.0.0.1:9/dsh-debug-mode/logs',
      sessionId: 'sess-1',
    })
    expect(source).toContain('http://127.0.0.1:9/dsh-debug-mode/logs')
    expect(source).not.toContain('sess-1')
    expect(source).toContain('export function debugLog')
    expect(source).toContain('skipUnchanged')
    expect(source).not.toMatch(/node:fs|node:path|node:url|require\(/)
  })
})
