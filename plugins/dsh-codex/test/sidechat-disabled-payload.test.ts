/**
 * The "side chat is switched off" answer must arrive as a state, not a failure.
 *
 * The Host refuses an open with `409 { disabled: true, reason }` instead of an
 * error payload. Routed through the generic error path, the panel would show an
 * error bar with an empty message and an empty stack — the user turned a
 * feature off, and got what looks like a crash with nothing to report.
 *
 * These pin the discrimination: the panel needs a typed fact it can render as
 * "switched off", and it must not mistake an unrelated 409 for the user's own
 * switch (409 is a status the Host can reach for other reasons).
 *
 * Pure functions only — no fetch and no rendering.
 */

import { describe, expect, it } from 'vitest'
import { isDisabledPayload } from '../src/client/features/side-chat/api'

describe('isDisabledPayload', () => {
  it("recognizes the Host's switched-off answer", () => {
    expect(isDisabledPayload({ disabled: true, reason: 'side-chat-disabled' }, 409)).toBe(true)
  })

  it('ignores a conflict that is not the switch', () => {
    // The whole reason the check reads the body and not just the status: a 409
    // from anywhere else must stay an ordinary error.
    expect(isDisabledPayload({ error: 'parent session is archived' }, 409)).toBe(false)
  })

  it('ignores the right body on the wrong status', () => {
    expect(isDisabledPayload({ disabled: true }, 200)).toBe(false)
    expect(isDisabledPayload({ disabled: true }, 500)).toBe(false)
  })

  it('ignores a disabled flag that is not literally true', () => {
    expect(isDisabledPayload({ disabled: 'true' }, 409)).toBe(false)
    expect(isDisabledPayload({ disabled: 1 }, 409)).toBe(false)
  })

  it('ignores payloads that are not objects', () => {
    expect(isDisabledPayload(null, 409)).toBe(false)
    expect(isDisabledPayload(undefined, 409)).toBe(false)
    expect(isDisabledPayload('disabled', 409)).toBe(false)
    expect(isDisabledPayload(409, 409)).toBe(false)
  })
})
