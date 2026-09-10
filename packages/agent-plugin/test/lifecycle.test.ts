import { describe, expect, it } from 'vitest'
import {
  createInstalledRecord,
  disableInState,
  enableInState,
  parseStateFile,
  removeFromState,
  summarizeUninstallCleanup,
} from '../src/lifecycle.ts'
import { emptyAgentState } from '../src/paths.ts'

describe('lifecycle state machine', () => {
  it('starts disabled on install record', () => {
    const record = createInstalledRecord({ project_ref: 'abc' })
    expect(record.enabled).toBe(false)
    expect(record.variables.project_ref).toBe('abc')
    expect(record.connection.status).toBe('idle')
  })

  it('enable / disable keep variables', () => {
    let state = emptyAgentState()
    state = {
      ...state,
      plugins: { supabase: createInstalledRecord({ project_ref: 'abc' }) },
    }
    state = enableInState(state, 'supabase')
    expect(state.plugins.supabase.enabled).toBe(true)
    state = disableInState(state, 'supabase')
    expect(state.plugins.supabase.enabled).toBe(false)
    expect(state.plugins.supabase.variables.project_ref).toBe('abc')
  })

  it('removeFromState drops the entry', () => {
    let state = emptyAgentState()
    state = {
      ...state,
      plugins: { supabase: createInstalledRecord() },
    }
    state = removeFromState(state, 'supabase')
    expect(state.plugins.supabase).toBeUndefined()
  })

  it('summarizeUninstallCleanup reports the checklist', () => {
    const report = summarizeUninstallCleanup({
      runtimeDetached: true,
      directoryRemoved: true,
      stateRemoved: true,
      credentialsCleared: true,
    })
    expect(report.failures).toEqual([])
    expect(report.directoryRemoved).toBe(true)
  })

  it('parseStateFile tolerates garbage', () => {
    expect(parseStateFile(null).plugins).toEqual({})
    expect(parseStateFile({ version: 1, plugins: { x: { enabled: true } } }).plugins.x.enabled).toBe(true)
  })
})
