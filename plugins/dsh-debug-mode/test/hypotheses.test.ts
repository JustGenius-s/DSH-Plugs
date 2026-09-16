import { describe, expect, it } from 'vitest'
import { parseHypothesisStatus, upsertHypothesis } from '../src/hypotheses.ts'

describe('upsertHypothesis', () => {
  it('opens a new hypothesis from a statement', () => {
    expect(upsertHypothesis([], 'C', { statement: 'empty workflow is treated as none' })).toEqual([
      { id: 'C', statement: 'empty workflow is treated as none', status: 'open' },
    ])
  })

  it('scores without wiping the statement', () => {
    const open = upsertHypothesis([], 'C', { statement: 'gate first frame' })
    expect(upsertHypothesis(open, 'C', { status: 'confirmed' })).toEqual([
      { id: 'C', statement: 'gate first frame', status: 'confirmed' },
    ])
  })
})

describe('parseHypothesisStatus', () => {
  it('accepts the lifecycle values only', () => {
    expect(parseHypothesisStatus('rejected')).toBe('rejected')
    expect(parseHypothesisStatus('done')).toBeUndefined()
  })
})
