import { describe, expect, it } from 'vitest'
import { desiredEntries } from '../src/catalog.ts'
import { applyDesiredPatch, parsePatchEntries, serializeInsert } from '../src/patch.ts'
import { IDS, MANAGED_MARKER, PACKAGES } from '../src/shared.ts'

const playwright = desiredEntries({
  browser: {
    enabled: true,
    provider: 'playwright-mcp',
    mode: 'launch',
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    endpoint: '',
  },
  computer: { enabled: false },
})

describe('patch parse/serialize', () => {
  it('round-trips an insert block with quoted package names and arrays', () => {
    const entries = desiredEntries({
      browser: { enabled: false },
      computer: { enabled: true, provider: 'cua-mcp', command: 'cua-driver', args: ['mcp', '--direct'] },
    })
    const text = serializeInsert(entries)
    expect(parsePatchEntries(text)).toEqual(entries)
  })

  it('parses a top-level id block', () => {
    const text = [
      '- id: other',
      "  name: '@just-genius/dsh-memory'",
      '  config:',
      '    enabled: true',
    ].join('\n')
    expect(parsePatchEntries(text)).toEqual([
      { id: 'other', name: '@just-genius/dsh-memory', config: { enabled: true } },
    ])
  })
})

describe('applyDesiredPatch', () => {
  it('appends a managed insert and preserves unrelated rows', () => {
    const original = [
      '- id: dsh-memory',
      "  name: '@just-genius/dsh-memory'",
    ].join('\n')
    const next = applyDesiredPatch(original, playwright, {
      removeForeign: false,
      capabilities: new Set(['browser']),
    })
    expect(next).toContain('dsh-memory')
    expect(next).toContain(MANAGED_MARKER)
    expect(next).toContain(IDS.playwright)
    expect(parsePatchEntries(next).map((entry) => entry.id)).toEqual([
      'dsh-memory',
      IDS.browserUse,
      IDS.playwright,
    ])
  })

  it('replaces a previous managed block in place', () => {
    const first = applyDesiredPatch('', playwright, {
      removeForeign: false,
      capabilities: new Set(['browser']),
    })
    const second = applyDesiredPatch(first, [], {
      removeForeign: false,
      capabilities: new Set(),
    })
    expect(second).not.toContain(MANAGED_MARKER)
    expect(parsePatchEntries(second)).toEqual([])
  })

  it('takeover drops foreign official providers for the enabled capability', () => {
    const original = serializeInsert([
      { id: 'handwritten-browser', name: PACKAGES.playwright, config: { mode: 'attach' } },
      { id: 'keep-me', name: '@just-genius/dsh-memory', config: {} },
    ])
    const next = applyDesiredPatch(original, playwright, {
      removeForeign: true,
      capabilities: new Set(['browser']),
    })
    const ids = parsePatchEntries(next).map((entry) => entry.id)
    expect(ids).toContain('keep-me')
    expect(ids).not.toContain('handwritten-browser')
    expect(ids).toContain(IDS.playwright)
  })

  it('does not drop the previous document when replacing a managed insert', () => {
    const first = applyDesiredPatch(
      ['- id: dsh-memory', "  name: '@just-genius/dsh-memory'"].join('\n'),
      playwright,
      { removeForeign: false, capabilities: new Set(['browser']) },
    )
    const second = applyDesiredPatch(first, playwright, {
      removeForeign: false,
      capabilities: new Set(['browser']),
    })
    expect(parsePatchEntries(second).map((entry) => entry.id)).toEqual([
      'dsh-memory',
      IDS.browserUse,
      IDS.playwright,
    ])
  })
})
