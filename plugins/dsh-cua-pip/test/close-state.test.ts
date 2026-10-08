import { describe, expect, it } from 'vitest'
import { beginPreviewClose, finishPreviewClose, isPreviewClosing } from '../src/client/close-state.ts'

describe('preview close requests', () => {
  const first = { sessionId: 'clock', openedAt: 100 }
  const reopened = { sessionId: 'clock', openedAt: 200 }

  it('lets a newer explicit open remain visible while the old close is pending', () => {
    const pending = beginPreviewClose(new Map(), first)
    expect(isPreviewClosing(pending, first)).toBe(true)
    expect(isPreviewClosing(pending, reopened)).toBe(false)
    expect(isPreviewClosing(pending, { sessionId: 'ima', openedAt: 100 })).toBe(false)
  })

  it('does not let an older close response clear the newer close', () => {
    const pending = beginPreviewClose(beginPreviewClose(new Map(), first), reopened)
    const afterOldResponse = finishPreviewClose(pending, first)
    expect(isPreviewClosing(afterOldResponse, reopened)).toBe(true)
    expect(isPreviewClosing(finishPreviewClose(afterOldResponse, reopened), reopened)).toBe(false)
  })
})
