import { describe, expect, it, vi } from 'vitest'
import {
  createSideChatTabStateRegistry,
  sideChatTabCaption,
} from '../src/client/features/side-chat/tab-state'

/** Stand-in for the locale lookup, so captions are asserted literally. */
const t = (key: string): string => (key === 'sideChat.numbered' ? '侧聊 {index}' : key)
const SCOPE = { sessionId: 'session-1' }

describe('side-chat official tab state', () => {
  it('shares one snapshot between independently mounted title and body owners', () => {
    const registry = createSideChatTabStateRegistry()
    const controller = new AbortController()
    const title = registry.acquire('session:tab', controller.signal, SCOPE)
    const body = registry.acquire('session:tab', controller.signal, SCOPE)

    expect(title).toBe(body)
    registry.update('session:tab', { sideSessionId: 'side-1' })
    registry.update('session:tab', { title: '检查这个错误' })
    expect(title?.getSnapshot()).toEqual({
      sideSessionId: 'side-1',
      title: '检查这个错误',
    })
  })

  it('notifies only when tab metadata actually changes', () => {
    const registry = createSideChatTabStateRegistry()
    const controller = new AbortController()
    const handle = registry.acquire('session:tab', controller.signal, SCOPE)
    const listener = vi.fn()
    handle?.subscribe(listener)

    registry.update('session:tab', { title: '问题' })
    registry.update('session:tab', { title: '问题' })
    registry.update('session:tab', { sideSessionId: 'side-1' })

    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('drops a tab occurrence only when its official signal aborts', () => {
    const registry = createSideChatTabStateRegistry()
    const controller = new AbortController()
    const handle = registry.acquire('session:tab', controller.signal, SCOPE)
    const listener = vi.fn()
    handle?.subscribe(listener)
    registry.update('session:tab', { title: '保留' })

    expect(registry.size).toBe(1)
    controller.abort()
    expect(registry.size).toBe(0)
    registry.update('session:tab', { title: '不会复活' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(registry.acquire('session:tab', controller.signal, SCOPE)).toBeUndefined()
  })

  it('disposes every retained occurrence at feature shutdown', () => {
    const registry = createSideChatTabStateRegistry()
    registry.acquire('one', new AbortController().signal, SCOPE)
    registry.acquire('two', new AbortController().signal, SCOPE)
    expect(registry.size).toBe(2)

    registry.dispose()
    expect(registry.size).toBe(0)
    expect(registry.acquire('three', new AbortController().signal, SCOPE)).toBeUndefined()
  })
})

describe('side-chat window numbering', () => {
  it('leaves a lone side chat unnumbered', () => {
    const registry = createSideChatTabStateRegistry()
    const only = registry.acquire('a', new AbortController().signal, SCOPE)

    // One window needs no separating from itself, so it carries no number at
    // all rather than "侧聊 1".
    expect(only?.getSnapshot().ordinal).toBeUndefined()
  })

  it('numbers the second window 1 and the third 2', () => {
    const registry = createSideChatTabStateRegistry()
    const first = registry.acquire('a', new AbortController().signal, SCOPE)
    const second = registry.acquire('b', new AbortController().signal, SCOPE)
    const third = registry.acquire('c', new AbortController().signal, SCOPE)

    expect(first?.getSnapshot().ordinal).toBeUndefined()
    expect(second?.getSnapshot().ordinal).toBe(1)
    expect(third?.getSnapshot().ordinal).toBe(2)
  })

  it('counts per Session, so each Session numbers its own windows', () => {
    const registry = createSideChatTabStateRegistry()
    registry.acquire('a', new AbortController().signal, { sessionId: 'session-1' })
    const hereOne = registry.acquire('b', new AbortController().signal, { sessionId: 'session-1' })
    const thereOne = registry.acquire('c', new AbortController().signal, { sessionId: 'session-2' })
    const thereTwo = registry.acquire('d', new AbortController().signal, { sessionId: 'session-2' })

    expect(hereOne?.getSnapshot().ordinal).toBe(1)
    // A second Session starts its own sequence: its lone window has no number.
    expect(thereOne?.getSnapshot().ordinal).toBeUndefined()
    expect(thereTwo?.getSnapshot().ordinal).toBe(1)
  })

  it('renumbers the survivors when a window closes', () => {
    const registry = createSideChatTabStateRegistry()
    const firstController = new AbortController()
    registry.acquire('a', firstController.signal, SCOPE)
    const second = registry.acquire('b', new AbortController().signal, SCOPE)
    const third = registry.acquire('c', new AbortController().signal, SCOPE)
    expect(second?.getSnapshot().ordinal).toBe(1)
    expect(third?.getSnapshot().ordinal).toBe(2)

    // Closing the FIRST window promotes the other two by one position, so the
    // unnumbered window is still the earliest one open — a stale rank would
    // leave the surviving window captioned "侧聊 2" as the first of two.
    firstController.abort()

    expect(second?.getSnapshot().ordinal).toBeUndefined()
    expect(third?.getSnapshot().ordinal).toBe(1)
  })

  it('drops back to no numbering when only one window is left', () => {
    const registry = createSideChatTabStateRegistry()
    const survivor = registry.acquire('a', new AbortController().signal, SCOPE)
    const closing = new AbortController()
    const second = registry.acquire('b', closing.signal, SCOPE)
    expect(second?.getSnapshot().ordinal).toBe(1)

    closing.abort()

    // The SURVIVOR is re-ranked, not the handle that just went away: a lone
    // side chat must go back to carrying no number.
    expect(survivor?.getSnapshot().ordinal).toBeUndefined()
  })

  it('returns a restarted occurrence to the same position', () => {
    const registry = createSideChatTabStateRegistry()
    const controller = new AbortController()
    const handle = registry.acquire('a', controller.signal, SCOPE)
    registry.acquire('b', new AbortController().signal, SCOPE)

    // Same key AND same signal is the same occurrence — a remount must not
    // consume a second position and shift every later window.
    expect(registry.acquire('a', controller.signal, SCOPE)).toBe(handle)
    expect(handle?.getSnapshot().ordinal).toBeUndefined()
  })

  it('joins the sequence when a reused occurrence turns out to be a window', () => {
    const registry = createSideChatTabStateRegistry()
    const controller = new AbortController()
    // Acquired as the guide's page tab (no scope), then re-read by the seat
    // once the record is a real side chat. The entry is reused, so it has to
    // be upgraded rather than keep its scope-less state forever.
    const page = registry.acquire('a', controller.signal)
    const real = registry.acquire('a', controller.signal, SCOPE)
    const second = registry.acquire('b', new AbortController().signal, SCOPE)

    expect(real).toBe(page)
    expect(page?.getSnapshot().ordinal).toBeUndefined()
    expect(second?.getSnapshot().ordinal).toBe(1)
  })

  it('keeps an unnumbered occurrence out of the sequence entirely', () => {
    const registry = createSideChatTabStateRegistry()
    // The guide's page tab is the case: it renders nothing and is replaced by
    // its own resource tab, so ranking it would shift every real window by one.
    const page = registry.acquire('page', new AbortController().signal)
    const first = registry.acquire('a', new AbortController().signal, SCOPE)
    const second = registry.acquire('b', new AbortController().signal, SCOPE)

    expect(page?.getSnapshot().ordinal).toBeUndefined()
    expect(first?.getSnapshot().ordinal).toBeUndefined()
    expect(second?.getSnapshot().ordinal).toBe(1)
  })
})

describe('sideChatTabCaption', () => {
  it('numbers a window that has no message yet', () => {
    expect(sideChatTabCaption({ ordinal: 2 }, t)).toBe('侧聊 2')
  })

  it('shows a lone unnumbered window as the plain label', () => {
    expect(sideChatTabCaption({}, t)).toBe('view.sideChat')
  })

  it('drops the number once a conversation title exists', () => {
    // The title identifies the window better than a number does, and a leading
    // digit on every tab is noise.
    expect(sideChatTabCaption({ ordinal: 2, title: '检查构建错误' }, t))
      .toBe('检查构建错误')
    expect(sideChatTabCaption({ title: '检查构建错误' }, t)).toBe('检查构建错误')
  })

  it('treats an empty title as no message yet', () => {
    expect(sideChatTabCaption({ ordinal: 1, title: '' }, t)).toBe('侧聊 1')
  })
})
