import { describe, expect, it } from 'vitest'
import { formatCompareLogs, nextRunId, startRun, type RunState } from '../src/runs.ts'
import type { DebugLogEntry } from '../src/shared.ts'

function empty(): RunState {
  return { runId: null, logs: [], runs: [] }
}

function log(text: string): DebugLogEntry {
  return { id: text, at: 1, source: 'ingest', text }
}

describe('nextRunId', () => {
  it('uses pre-fix then post-fix', () => {
    expect(nextRunId([])).toBe('pre-fix')
    expect(nextRunId([{ id: 'pre-fix', startedAt: 1, endedAt: 2, logs: [] }])).toBe('post-fix')
  })
})

describe('startRun', () => {
  it('keeps notes from before the first wait in pre-fix', () => {
    const state = empty()
    state.logs = [log('hypothesis A')]
    expect(startRun(state)).toBe('pre-fix')
    expect(state.logs).toHaveLength(1)
    expect(state.runs).toHaveLength(0)
  })

  it('archives pre-fix when the second wait starts', () => {
    const state = empty()
    startRun(state)
    state.logs = [log('showStartPage')]
    expect(startRun(state)).toBe('post-fix')
    expect(state.logs).toEqual([])
    expect(state.runs[0]?.id).toBe('pre-fix')
    expect(state.runs[0]?.logs[0]?.text).toBe('showStartPage')
  })
})

describe('formatCompareLogs', () => {
  it('keeps current and previous runs apart', () => {
    const previous = { id: 'pre-fix', startedAt: 1, endedAt: 2, logs: [log('before')] }
    const compare = formatCompareLogs([log('after')], previous)
    expect(compare.previousRunId).toBe('pre-fix')
    expect(compare.previousLogs).toContain('before')
    expect(compare.logs).toContain('after')
    expect(compare.logs).not.toContain('before')
  })
})
