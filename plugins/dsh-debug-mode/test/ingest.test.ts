import { describe, expect, it } from 'vitest'
import { collectIngestLines, formatLogEntry } from '../src/ingest.ts'
import type { DebugLogEntry } from '../src/shared.ts'

describe('collectIngestLines', () => {
  it('prefers message over text', () => {
    expect(collectIngestLines({ message: 'clicked', text: 'old' })).toEqual([
      { text: 'clicked' },
    ])
  })

  it('keeps structured extras on every line', () => {
    expect(collectIngestLines({
      message: 'open',
      lines: ['next'],
      hypothesisId: 'A',
      location: 'App.tsx:12',
      runId: 'pre',
      data: { n: 1 },
    })).toEqual([
      { text: 'open', hypothesisId: 'A', location: 'App.tsx:12', runId: 'pre', data: { n: 1 } },
      { text: 'next', hypothesisId: 'A', location: 'App.tsx:12', runId: 'pre', data: { n: 1 } },
    ])
  })

  it('drops blank strings', () => {
    expect(collectIngestLines({ message: '  ', lines: ['', 'keep'] })).toEqual([
      { text: 'keep' },
    ])
  })
})

describe('formatLogEntry', () => {
  it('cites hypothesis, run, and location', () => {
    const entry: DebugLogEntry = {
      id: 'log-1',
      at: Date.parse('2026-09-15T00:00:00.000Z'),
      source: 'ingest',
      text: 'clicked',
      hypothesisId: 'A',
      location: 'App.tsx:12',
      runId: 'post-fix',
      data: { ok: true },
    }
    expect(formatLogEntry(entry)).toBe(
      '[2026-09-15T00:00:00.000Z] [ingest] [A] [run:post-fix] App.tsx:12 clicked {"ok":true}',
    )
  })

  it('marks folded repeats', () => {
    const entry: DebugLogEntry = {
      id: 'log-2',
      at: Date.parse('2026-09-15T00:00:00.000Z'),
      source: 'ingest',
      text: 'view-gate',
      count: 12,
    }
    expect(formatLogEntry(entry)).toContain('×12')
  })
})
