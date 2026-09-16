import { describe, expect, it } from 'vitest'
import {
  DEBUG_MODE_EVENT,
  appendDebugMode,
  foldDebugActive,
  sessionCanPersistDebug,
} from '../src/persist.ts'

describe('foldDebugActive', () => {
  it('is inactive on an empty log', () => {
    expect(foldDebugActive([])).toBe(false)
  })

  it('keeps the last debug/mode value', () => {
    expect(foldDebugActive([
      { type: 'turn/start', data: { turn: 1 } },
      { type: DEBUG_MODE_EVENT, data: { active: true } },
      { type: DEBUG_MODE_EVENT, data: { active: false } },
      { type: DEBUG_MODE_EVENT, data: { active: true } },
    ])).toBe(true)
  })

  it('ignores malformed payloads', () => {
    expect(foldDebugActive([
      { type: DEBUG_MODE_EVENT, data: { active: 'yes' } },
      { type: DEBUG_MODE_EVENT, data: null },
    ])).toBe(false)
  })
})

describe('sessionCanPersistDebug', () => {
  it('rejects a host append that cannot mark ignorable', () => {
    const session = {
      append(type: string, data: { active: boolean }) {
        return { type, data }
      },
    }
    expect(sessionCanPersistDebug(session)).toBe(false)
  })

  it('accepts a 0.1.6-style append that writes ignorable', () => {
    const session = {
      append(type: string, data: { active: boolean }, opts?: { ignorable?: true }) {
        const ignorable = opts?.ignorable === true
        return { type, data, ...(ignorable ? { ignorable: true as const } : {}) }
      },
    }
    expect(sessionCanPersistDebug(session)).toBe(true)
    expect(appendDebugMode(session, true)).toBe(true)
  })
})
