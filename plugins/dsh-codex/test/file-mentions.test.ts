import { describe, expect, it } from 'vitest'
import {
  isPlainMentionGesture,
  mentionPathFromFacts,
  mentionSidebarAddress,
} from '../src/client/features/file-mentions/model'

/**
 * The mention rules are the feature's whole decision surface: which click is
 * ours, and where it lands. Nothing renders here (AGENTS.md forbids UI and DOM
 * assertions) — the element facts and the gesture are fed in by hand exactly as
 * `host-adapters/conversation-dom.ts` reads them off a real click.
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
      title: '/Users/someone/proj/dsh-tencent/EFFORT-FIX-PLAN.md',
    })).toBe('/Users/someone/proj/dsh-tencent/EFFORT-FIX-PLAN.md')
  })

  it('trims whitespace the attribute may carry', () => {
    expect(mentionPathFromFacts({ ...MENTION_CHIP, title: ' src/a.ts ' })).toBe('src/a.ts')
  })

  it('ignores a button that is not inside the inline-code wrapper', () => {
    // Delivery cards, tool rows, and the action strip are all buttons whose
    // parent is not a <code>, so none of them may be claimed.
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

describe('mentionSidebarAddress', () => {
  const session = { sessionId: 'session-1', cwd: '/work/repo', plain: true } as const

  it('resolves a relative chip path to the Session address the chat view uses', () => {
    expect(mentionSidebarAddress({ ...session, path: 'docs/plan.md' }))
      .toBe('dsh-resource://file/session/session-1/docs/plan.md')
  })

  it('keeps an absolute path inside the workspace as a Session address', () => {
    // The reported case: a file the assistant delivered with an absolute path.
    // Only a Session address is claimable by the official text preview.
    expect(mentionSidebarAddress({
      ...session,
      cwd: '/Users/someone/proj/dsh-tencent',
      path: '/Users/someone/proj/dsh-tencent/EFFORT-FIX-PLAN.md',
    })).toBe('dsh-resource://file/session/session-1/EFFORT-FIX-PLAN.md')
  })

  it('declines a path outside the workspace so the host keeps the click', () => {
    // It would become an `absolute` address, which the preview declines;
    // suppressing the click there would swallow it into a dead chip.
    expect(mentionSidebarAddress({ ...session, path: '/elsewhere/notes.md' })).toBeUndefined()
  })

  it('declines when the click is not on a mention chip', () => {
    expect(mentionSidebarAddress({ ...session, path: undefined })).toBeUndefined()
  })

  it('declines a modified click even on a mention chip', () => {
    expect(mentionSidebarAddress({ ...session, path: 'docs/plan.md', plain: false })).toBeUndefined()
  })

  it('declines when there is no Session to resolve a relative path against', () => {
    expect(mentionSidebarAddress({ ...session, path: 'docs/plan.md', sessionId: undefined }))
      .toBeUndefined()
  })
})
