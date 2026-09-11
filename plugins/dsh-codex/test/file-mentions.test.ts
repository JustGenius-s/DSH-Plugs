import { describe, expect, it } from 'vitest'
import {
  adoptsMentionClick,
  isPlainMentionGesture,
  mentionPathFromFacts,
} from '../src/client/features/file-mentions/model'

/**
 * The mention rules are the whole feature's decision surface: which click is
 * ours, and which file it names. Rendering is never exercised (AGENTS.md
 * forbids UI tests), so the element facts and the gesture are fed in by hand
 * here exactly as `conversation-dom.ts` reads them off a real click.
 */

/** The shape DSH's markdown sheet emits for one resolved mention. */
const MENTION_CHIP = { buttonTag: 'BUTTON', parentTag: 'CODE', title: 'docs/plan.md' }

const PLAIN_CLICK = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
}

describe('mentionPathFromFacts', () => {
  it('reads the path off the chip the host renders for a resolved mention', () => {
    expect(mentionPathFromFacts(MENTION_CHIP)).toBe('docs/plan.md')
  })

  it('keeps the absolute path the host put in the title', () => {
    expect(mentionPathFromFacts({
      ...MENTION_CHIP,
      title: '/Users/someone/proj/repo/EFFORT-FIX-PLAN.md',
    })).toBe('/Users/someone/proj/repo/EFFORT-FIX-PLAN.md')
  })

  it('trims whitespace the attribute may carry', () => {
    expect(mentionPathFromFacts({ ...MENTION_CHIP, title: ' src/a.ts ' })).toBe('src/a.ts')
  })

  it('ignores a button that is not inside the inline-code wrapper', () => {
    // Every other button in the transcript — delivery cards, tool rows, the
    // action strip — is a button whose parent is not <code>.
    expect(mentionPathFromFacts({ ...MENTION_CHIP, parentTag: 'DIV' })).toBeUndefined()
    expect(mentionPathFromFacts({ ...MENTION_CHIP, parentTag: '' })).toBeUndefined()
  })

  it('ignores inline code that is not a mention', () => {
    // Unresolved inline code renders as a bare <code> with no button at all,
    // and a URL renders as an <a>. Neither may be claimed.
    expect(mentionPathFromFacts({ buttonTag: 'CODE', parentTag: 'P', title: '' })).toBeUndefined()
    expect(mentionPathFromFacts({ buttonTag: 'A', parentTag: 'P', title: '' })).toBeUndefined()
    expect(mentionPathFromFacts({ buttonTag: '', parentTag: '', title: '' })).toBeUndefined()
  })

  it('rejects a chip whose title names nothing', () => {
    expect(mentionPathFromFacts({ ...MENTION_CHIP, title: '' })).toBeUndefined()
    expect(mentionPathFromFacts({ ...MENTION_CHIP, title: '   ' })).toBeUndefined()
  })
})

describe('isPlainMentionGesture', () => {
  it('accepts the unmodified primary click, including keyboard activation', () => {
    // A keyboard-activated button click carries button === 0 and no modifiers.
    expect(isPlainMentionGesture(PLAIN_CLICK)).toBe(true)
  })

  it('leaves every modified click to the host', () => {
    // Each modifier keeps the chip's own destination reachable, so the
    // "open in the default application" action is not removed from the product.
    expect(isPlainMentionGesture({ ...PLAIN_CLICK, metaKey: true })).toBe(false)
    expect(isPlainMentionGesture({ ...PLAIN_CLICK, ctrlKey: true })).toBe(false)
    expect(isPlainMentionGesture({ ...PLAIN_CLICK, shiftKey: true })).toBe(false)
    expect(isPlainMentionGesture({ ...PLAIN_CLICK, altKey: true })).toBe(false)
  })

  it('ignores the non-primary buttons', () => {
    expect(isPlainMentionGesture({ ...PLAIN_CLICK, button: 1 })).toBe(false)
    expect(isPlainMentionGesture({ ...PLAIN_CLICK, button: 2 })).toBe(false)
  })
})

describe('adoptsMentionClick', () => {
  it('adopts a plain click on a mention chip', () => {
    expect(adoptsMentionClick({ path: 'docs/plan.md', plain: true })).toBe(true)
  })

  it('declines a plain click that is not on a mention chip', () => {
    expect(adoptsMentionClick({ path: undefined, plain: true })).toBe(false)
  })

  it('declines a modified click even on a mention chip', () => {
    expect(adoptsMentionClick({ path: 'docs/plan.md', plain: false })).toBe(false)
  })
})
