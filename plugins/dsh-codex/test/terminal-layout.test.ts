import { describe, expect, it } from 'vitest'
import { terminalDocumentNeedsScroll } from '../src/client/features/terminal/layout'

describe('terminalDocumentNeedsScroll', () => {
  it('keeps an empty terminal free of a scrollbar', () => {
    expect(terminalDocumentNeedsScroll(0, 96, 800)).toBe(false)
  })

  it('ignores one pixel of layout rounding noise', () => {
    expect(terminalDocumentNeedsScroll(700.5, 100, 800)).toBe(false)
  })

  it('enables scrolling once real content exceeds the viewport', () => {
    expect(terminalDocumentNeedsScroll(760, 100, 800)).toBe(true)
  })
})
