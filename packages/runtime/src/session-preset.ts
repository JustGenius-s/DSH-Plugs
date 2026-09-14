/**
 * Session-preset resolution against the DSH 0.1.2 agent-presets API.
 *
 * 0.1.2 removed `resolveSessionPreset` from `@deepseek-ai/dsh-agent-presets`.
 * Preset selection is now a session projection (`agentPreset`) that starts from
 * the creation header and advances on an `agent-preset/selected` event, so the
 * old "scan the event log" helper no longer exists upstream. This module
 * reproduces that projection for plugins that need the value synchronously,
 * without depending on the projection service being mounted.
 */
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { sessionEventsOf } from './session-events.ts'

/** A session log in the shape preset resolution consumes. */
export interface PresetBearingSession {
  header: SessionHeader
  events: readonly SessionEvent[]
}

/** The event that re-selects a session's preset while it is still blank. */
const PRESET_SELECTED = 'agent-preset/selected'

/**
 * Resolve the preset a session currently runs under.
 *
 * Mirrors the `agentPreset` projection 0.1.2 ships in dsh-agent-presets:
 * - `init: (header) => header.agentPreset ?? null`
 * - `apply: (state, event) => event.type === 'agent-preset/selected'
 *     ? event.data.agentPreset : state`
 *
 * The selection event carries the preset under `data`, not at the top level —
 * reading the wrong path silently keeps the header's value, which then fails
 * later when the preset is resolved for real.
 *
 * @param session - header and event log to read.
 * @returns the preset id, or `undefined` when the session names none.
 */
export function resolveSessionPreset(
  session: PresetBearingSession,
): string | undefined {
  let preset = presetOfHeader(session.header)
  // A missing or non-iterable log must not fail the whole call — the header
  // value is still a valid answer.
  for (const event of sessionEventsOf(session)) {
    const selected = presetOfEvent(event as SessionEvent)
    if (selected !== undefined) preset = selected
  }
  return preset
}

function presetOfHeader(header: SessionHeader): string | undefined {
  const value = (header as { agentPreset?: unknown }).agentPreset
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function presetOfEvent(event: SessionEvent): string | undefined {
  if (event.type !== PRESET_SELECTED) return undefined
  // The projection reads event.data.agentPreset — the payload is nested.
  const data = (event as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return undefined
  const value = (data as { agentPreset?: unknown }).agentPreset
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
