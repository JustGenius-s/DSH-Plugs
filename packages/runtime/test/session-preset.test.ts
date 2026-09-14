/**
 * Preset resolution must not depend on the session log being readable.
 *
 * Upstream's `resolveSessionPreset` indexes `session.events.length` directly,
 * and a Session whose `events` getter has not resolved yet reads undefined —
 * that threw
 *   TypeError: Cannot read properties of undefined (reading 'length')
 * from inside dsh-agent-presets and failed the whole side-chat open request
 * (the client saw only that message, with no way to attribute it). The shared
 * runtime now re-exports a defensive implementation, so every plugin that
 * reads a preset through the boundary inherits the fix.
 */

import { describe, expect, it } from 'vitest'
import { resolveSessionPreset } from '../src/session-preset'

const selected = (preset: string) => ({ type: 'agent-preset/selected', data: { agentPreset: preset } })

describe('resolveSessionPreset', () => {
  it('reads the creation-time value from the header', () => {
    expect(resolveSessionPreset({ header: { agentPreset: 'base' }, events: [] })).toBe('base')
  })

  it('survives a session whose events are missing entirely', () => {
    // The crash case: upstream read session.events.length here.
    expect(resolveSessionPreset({ header: { agentPreset: 'from-header' } } as never)).toBe('from-header')
    expect(resolveSessionPreset({ header: {} } as never)).toBeUndefined()
  })

  it('survives an explicitly undefined log', () => {
    expect(resolveSessionPreset({ header: { agentPreset: 'h' }, events: undefined } as never)).toBe('h')
  })

  it('survives a log that is not iterable', () => {
    expect(resolveSessionPreset({ header: { agentPreset: 'h' }, events: 'nope' } as never)).toBe('h')
    expect(resolveSessionPreset({ header: { agentPreset: 'h' }, events: 42 } as never)).toBe('h')
  })

  it('lets a later selection override the header, last one winning', () => {
    const session = {
      header: { agentPreset: 'base' },
      events: [selected('first'), selected('second')],
    }
    expect(resolveSessionPreset(session as never)).toBe('second')
  })

  it('ignores a selection whose payload is missing or malformed', () => {
    const cases = [
      { type: 'agent-preset/selected' },
      { type: 'agent-preset/selected', data: null },
      { type: 'agent-preset/selected', data: { agentPreset: 7 } },
      { type: 'agent-preset/selected', data: { agentPreset: '' } },
    ]
    for (const event of cases) {
      expect(resolveSessionPreset({ header: { agentPreset: 'base' }, events: [event] } as never))
        .toBe('base')
    }
  })

  it('returns undefined when nothing names a preset', () => {
    expect(resolveSessionPreset({ header: {}, events: [{ type: 'user/message' }] } as never))
      .toBeUndefined()
  })
})
