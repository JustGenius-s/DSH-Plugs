import { describe, expect, it } from 'vitest'
import { foldDuplicateLog } from '../src/dedup.ts'
import type { DebugLogEntry } from '../src/shared.ts'

function line(partial: Partial<DebugLogEntry> & Pick<DebugLogEntry, 'id' | 'at'>): DebugLogEntry {
  return {
    source: 'ingest',
    text: 'view-gate',
    hypothesisId: 'A',
    location: 'App.vue:10',
    ...partial,
  }
}

describe('foldDuplicateLog', () => {
  it('increments count for the same evidence inside the window', () => {
    const first = line({ id: 'a', at: 1000 })
    const folded = foldDuplicateLog([first], line({ id: 'b', at: 4000 }))
    expect(folded).toHaveLength(1)
    expect(folded[0]?.count).toBe(2)
    expect(folded[0]?.id).toBe('a')
  })

  it('keeps a new line after the window', () => {
    const first = line({ id: 'a', at: 1000 })
    const folded = foldDuplicateLog([first], line({ id: 'b', at: 20000 }), 8000)
    expect(folded.map(item => item.id)).toEqual(['a', 'b'])
  })

  it('does not fold a different hypothesis', () => {
    const first = line({ id: 'a', at: 1000, hypothesisId: 'A' })
    const folded = foldDuplicateLog([first], line({ id: 'b', at: 2000, hypothesisId: 'C' }))
    expect(folded).toHaveLength(2)
  })
})
