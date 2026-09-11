import { describe, expect, it } from 'vitest'
import {
  LONG_MESSAGE_COLLAPSE_MAX_PX,
  LONG_MESSAGE_COLLAPSE_SLACK_PX,
  isLongMessageRowKind,
  longMessagePresentation,
} from '../src/client/features/long-message-collapse/model'

describe('isLongMessageRowKind', () => {
  it('accepts the host message kinds that can grow a transcript', () => {
    expect(isLongMessageRowKind('user')).toBe(true)
    expect(isLongMessageRowKind('steering')).toBe(true)
    expect(isLongMessageRowKind('assistant-step')).toBe(true)
  })

  it('ignores tool and chrome rows', () => {
    expect(isLongMessageRowKind('tool-call')).toBe(false)
    expect(isLongMessageRowKind('turn-tail')).toBe(false)
    expect(isLongMessageRowKind(undefined)).toBe(false)
  })
})

describe('longMessagePresentation', () => {
  const tall = LONG_MESSAGE_COLLAPSE_MAX_PX + LONG_MESSAGE_COLLAPSE_SLACK_PX + 1
  const short = LONG_MESSAGE_COLLAPSE_MAX_PX

  it('leaves a streaming row alone so the live answer can grow', () => {
    expect(longMessagePresentation({
      contentHeight: tall,
      streaming: true,
      expanded: false,
    })).toBe('none')
  })

  it('leaves a short finished row alone', () => {
    expect(longMessagePresentation({
      contentHeight: short,
      streaming: false,
      expanded: false,
    })).toBe('none')
  })

  it('does not clamp a message that only barely exceeds the max', () => {
    expect(longMessagePresentation({
      contentHeight: LONG_MESSAGE_COLLAPSE_MAX_PX + LONG_MESSAGE_COLLAPSE_SLACK_PX,
      streaming: false,
      expanded: false,
    })).toBe('none')
  })

  it('collapses a finished oversized message until the user expands it', () => {
    expect(longMessagePresentation({
      contentHeight: tall,
      streaming: false,
      expanded: false,
    })).toBe('collapsed')
    expect(longMessagePresentation({
      contentHeight: tall,
      streaming: false,
      expanded: true,
    })).toBe('expanded')
  })
})
