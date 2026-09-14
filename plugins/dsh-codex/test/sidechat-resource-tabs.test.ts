import { describe, expect, it } from 'vitest'
import {
  SIDE_CHAT_RESOURCE_PATTERN,
  isSideChatResourceAddress,
  sideChatResourceAddress,
  sideChatResourceAddressForTab,
} from '../src/client/features/side-chat/contract'
import {
  SIDE_CHAT_TAB_KIND,
  sideChatTabDefinition,
} from '../src/client/features/side-chat/definition'

describe('side-chat resource addresses', () => {
  it('derives one address per tab id, so a remount cannot multiply tabs', () => {
    const first = sideChatResourceAddressForTab(
      'sidebar://dsh-codex-side-chat',
      'tab-1',
    )
    const second = sideChatResourceAddressForTab(
      'sidebar://dsh-codex-side-chat',
      'tab-2',
    )

    // Two different tabs ARE two side chats, so their addresses must differ —
    // that is what lets the store keep both records. The derivation must also
    // be pure: asking twice for the same tab yields one address, or a remount
    // would open a second window.
    expect(first).not.toBe(second)
    expect(sideChatResourceAddressForTab('sidebar://dsh-codex-side-chat', 'tab-1')).toBe(first)
    expect(isSideChatResourceAddress(first)).toBe(true)
    expect(first).toBe(sideChatResourceAddress('tab-1'))
  })

  it('converts a guide page into a side-chat resource exactly once', () => {
    const address = sideChatResourceAddressForTab(
      'sidebar://dsh-codex-side-chat',
      'tab / 1',
    )

    expect(isSideChatResourceAddress(address)).toBe(true)
    // An address that is already a resource passes through untouched, so the
    // conversion is idempotent however many times a body remounts.
    expect(sideChatResourceAddressForTab(address, 'another-tab')).toBe(address)
  })

  it('never mistakes the page address for a resource address', () => {
    expect(isSideChatResourceAddress('sidebar://dsh-codex-side-chat')).toBe(false)
    expect(isSideChatResourceAddress('dsh-resource://dsh-codex-side-chat/')).toBe(false)
  })
})

describe('side-chat tab definition', () => {
  it('claims resource addresses while keeping the guide entry', () => {
    const definition = sideChatTabDefinition(key => key)

    expect(definition.kind).toBe(SIDE_CHAT_TAB_KIND)
    expect(definition.patterns).toEqual([SIDE_CHAT_RESOURCE_PATTERN])
    // The guide capsule is the ONLY entry point, so it must stay registered:
    // picking it again is how a second window gets opened.
    expect(definition.guide).toHaveLength(1)
    expect(definition.canOpen?.(sideChatResourceAddress('tab-1'))).toBe(true)
    // A page address reaches this type by kind (the registry does not consult
    // globs for a named kind), and must be refused by a glob claim so the two
    // stages cannot disagree.
    expect(definition.canOpen?.('sidebar://dsh-codex-side-chat')).toBe(false)
  })
})
