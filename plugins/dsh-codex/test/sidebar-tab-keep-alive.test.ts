import { describe, expect, it } from 'vitest'
import {
  captureRetainedScroll,
  createRetainedTabRegistry,
  restoreRetainedScroll,
  restoreRetainedScrollAfterLayout,
  sidebarTabOccurrenceKey,
  type RetainedTabPlatform,
} from '../src/client/sidebar-tab-keep-alive'

interface FakeContainer {
  id: number
  holder?: string
  renders: string[]
  unmounts: number
}

function fakePlatform(): RetainedTabPlatform<FakeContainer, string, string> {
  let nextId = 0
  return {
    createContainer: () => ({
      id: nextId++,
      renders: [],
      unmounts: 0,
    }),
    createRoot: container => ({
      render: content => { container.renders.push(content) },
      unmount: () => { container.unmounts += 1 },
    }),
    attach: (container, holder) => { container.holder = holder },
    detach: container => { container.holder = undefined },
  }
}

describe('sidebar tab keep-alive lifecycle', () => {
  it('restores offsets on the same retained scroll targets', () => {
    const vertical = { scrollTop: 480, scrollLeft: 0 }
    const horizontal = { scrollTop: 12, scrollLeft: 96 }
    const offsets = captureRetainedScroll([vertical, horizontal])
    vertical.scrollTop = 0
    horizontal.scrollTop = 0
    horizontal.scrollLeft = 0

    restoreRetainedScroll(offsets)

    expect(vertical).toEqual({ scrollTop: 480, scrollLeft: 0 })
    expect(horizontal).toEqual({ scrollTop: 12, scrollLeft: 96 })
  })

  it('reasserts retained offsets after layout only for the current attachment', () => {
    const target = { scrollTop: 360, scrollLeft: 24 }
    const offsets = captureRetainedScroll([target])
    const scheduled: Array<() => void> = []
    let current = true
    target.scrollTop = 0
    target.scrollLeft = 0

    restoreRetainedScrollAfterLayout(offsets, callback => scheduled.push(callback), () => current)
    expect(target).toEqual({ scrollTop: 360, scrollLeft: 24 })

    target.scrollTop = 0
    target.scrollLeft = 0
    scheduled[0]?.()
    expect(target).toEqual({ scrollTop: 360, scrollLeft: 24 })

    target.scrollTop = 0
    current = false
    scheduled[0]?.()
    expect(target.scrollTop).toBe(0)
  })

  it('detaches and reattaches one renderer without unmounting it', () => {
    const containers: FakeContainer[] = []
    const platform = fakePlatform()
    const originalCreate = platform.createContainer
    platform.createContainer = () => {
      const container = originalCreate()
      containers.push(container)
      return container
    }
    const registry = createRetainedTabRegistry(platform)
    const occurrence = new AbortController()

    registry.attach('tab', occurrence.signal, 'first-holder')
    registry.update('tab', occurrence.signal, true, visible => String(visible))
    registry.detach('tab', 'first-holder')
    registry.attach('tab', occurrence.signal, 'second-holder')

    expect(containers).toHaveLength(1)
    expect(containers[0]?.holder).toBe('second-holder')
    expect(containers[0]?.renders).toEqual(['true', 'false', 'true'])
    expect(containers[0]?.unmounts).toBe(0)
    expect(registry.size).toBe(1)

    occurrence.abort()
    expect(containers[0]?.holder).toBeUndefined()
    expect(containers[0]?.unmounts).toBe(1)
    expect(registry.size).toBe(0)
  })

  it('ignores an obsolete holder cleanup after a dock/float move', () => {
    const containers: FakeContainer[] = []
    const platform = fakePlatform()
    const originalCreate = platform.createContainer
    platform.createContainer = () => {
      const container = originalCreate()
      containers.push(container)
      return container
    }
    const registry = createRetainedTabRegistry(platform)
    const occurrence = new AbortController()

    registry.attach('tab', occurrence.signal, 'dock')
    registry.update('tab', occurrence.signal, true, visible => String(visible))
    registry.attach('tab', occurrence.signal, 'float')
    registry.detach('tab', 'dock')

    expect(containers[0]?.holder).toBe('float')
    expect(containers[0]?.renders.at(-1)).toBe('true')
  })

  it('treats a reused id with a new signal as a new occurrence', () => {
    const containers: FakeContainer[] = []
    const platform = fakePlatform()
    const originalCreate = platform.createContainer
    platform.createContainer = () => {
      const container = originalCreate()
      containers.push(container)
      return container
    }
    const registry = createRetainedTabRegistry(platform)
    const first = new AbortController()
    const second = new AbortController()

    registry.attach('tab', first.signal, 'first')
    registry.update('tab', first.signal, true, visible => String(visible))
    registry.attach('tab', second.signal, 'second')

    expect(containers).toHaveLength(2)
    expect(containers[0]?.unmounts).toBe(1)
    expect(containers[1]?.holder).toBe('second')
    first.abort()
    expect(registry.size).toBe(1)
  })

  it('cannot reacquire a renderer after feature disposal', () => {
    const containers: FakeContainer[] = []
    const platform = fakePlatform()
    const originalCreate = platform.createContainer
    platform.createContainer = () => {
      const container = originalCreate()
      containers.push(container)
      return container
    }
    const registry = createRetainedTabRegistry(platform)
    const occurrence = new AbortController()

    registry.attach('tab', occurrence.signal, 'first')
    registry.dispose()
    registry.attach('tab', occurrence.signal, 'late')
    registry.update('tab', occurrence.signal, true, visible => String(visible))

    expect(containers).toHaveLength(1)
    expect(containers[0]?.unmounts).toBe(1)
    expect(registry.size).toBe(0)
  })

  it('separates equal tab ids from different Sessions', () => {
    expect(sidebarTabOccurrenceKey('session-a', 'tab-1')).not.toBe(
      sidebarTabOccurrenceKey('session-b', 'tab-1'),
    )
    expect(sidebarTabOccurrenceKey('a:b', 'c')).not.toBe(
      sidebarTabOccurrenceKey('a', 'b:c'),
    )
  })
})
