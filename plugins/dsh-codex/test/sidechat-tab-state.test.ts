import { describe, expect, it, vi } from 'vitest'
import { createSideChatTabStateRegistry } from '../src/client/features/side-chat/tab-state'

describe('side-chat official tab state', () => {
  it('shares one snapshot between independently mounted title and body owners', () => {
    const registry = createSideChatTabStateRegistry()
    const controller = new AbortController()
    const title = registry.acquire('session:tab', controller.signal)
    const body = registry.acquire('session:tab', controller.signal)

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
    const handle = registry.acquire('session:tab', controller.signal)
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
    const handle = registry.acquire('session:tab', controller.signal)
    const listener = vi.fn()
    handle?.subscribe(listener)
    registry.update('session:tab', { title: '保留' })

    expect(registry.size).toBe(1)
    controller.abort()
    expect(registry.size).toBe(0)
    registry.update('session:tab', { title: '不会复活' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(registry.acquire('session:tab', controller.signal)).toBeUndefined()
  })

  it('disposes every retained occurrence at feature shutdown', () => {
    const registry = createSideChatTabStateRegistry()
    registry.acquire('one', new AbortController().signal)
    registry.acquire('two', new AbortController().signal)
    expect(registry.size).toBe(2)

    registry.dispose()
    expect(registry.size).toBe(0)
    expect(registry.acquire('three', new AbortController().signal)).toBeUndefined()
  })
})
