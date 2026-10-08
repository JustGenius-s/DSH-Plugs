import { describe, expect, it } from 'vitest'
import {
  pickConversationSurfaceCandidate,
  type ConversationSurfaceCandidate,
} from '../src/client/conversation-surface.ts'

const candidate = (
  scope: ConversationSurfaceCandidate['scope'],
  visible = true,
): ConversationSurfaceCandidate => ({ scope, visible })

describe('conversation surface selection', () => {
  it('keeps a primary preview out of embedded side-panel conversations', () => {
    const main = candidate('main')
    expect(pickConversationSurfaceCandidate([candidate('embedded'), main], true)).toBe(main)
  })

  it('does not substitute another conversation when the main view is hidden', () => {
    expect(pickConversationSurfaceCandidate([
      candidate('main', false),
      candidate('fallback'),
      candidate('embedded'),
    ], true)).toBeUndefined()
  })

  it('does not substitute a legacy candidate before the main view has mounted its body', () => {
    expect(pickConversationSurfaceCandidate([candidate('fallback')], true)).toBeUndefined()
  })

  it('accepts one visible legacy conversation without a main outlet', () => {
    const fallback = candidate('fallback')
    expect(pickConversationSurfaceCandidate([
      candidate('fallback', false),
      candidate('embedded'),
      fallback,
    ], false)).toBe(fallback)
  })

  it('hides the preview when standalone conversation ownership is ambiguous', () => {
    expect(pickConversationSurfaceCandidate([
      candidate('fallback'),
      candidate('fallback'),
    ], false)).toBeUndefined()
  })

  it('hides the preview when multiple main surfaces are visible', () => {
    expect(pickConversationSurfaceCandidate([candidate('main'), candidate('main')], true))
      .toBeUndefined()
  })

  it('never promotes an embedded conversation when no main surface is present', () => {
    expect(pickConversationSurfaceCandidate([candidate('embedded')], false)).toBeUndefined()
  })

  it('hides the preview when there is no conversation surface', () => {
    expect(pickConversationSurfaceCandidate([], false)).toBeUndefined()
  })
})
