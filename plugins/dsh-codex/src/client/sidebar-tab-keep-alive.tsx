import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

/** Renderer owned by one retained tab occurrence. */
export interface RetainedTabRoot<Content> {
  render(content: Content): void
  unmount(): void
}

/** Small platform seam: lifecycle can be tested without rendering a component. */
export interface RetainedTabPlatform<Container, Holder, Content> {
  createContainer(): Container
  createRoot(container: Container): RetainedTabRoot<Content>
  attach(container: Container, holder: Holder): void
  detach(container: Container): void
}

export type RetainedTabRender<Content> = (visible: boolean) => Content

export interface RetainedScrollTarget {
  scrollTop: number
  scrollLeft: number
}

export interface RetainedScrollOffset<Target extends RetainedScrollTarget> {
  target: Target
  top: number
  left: number
}

/** Snapshot marked scrollports before their retained DOM leaves a pane. */
export function captureRetainedScroll<Target extends RetainedScrollTarget>(
  targets: readonly Target[],
): RetainedScrollOffset<Target>[] {
  return targets.map(target => ({
    target,
    top: target.scrollTop,
    left: target.scrollLeft,
  }))
}

/** Restore the same scrollport nodes after their retained DOM is reattached. */
export function restoreRetainedScroll<Target extends RetainedScrollTarget>(
  offsets: readonly RetainedScrollOffset<Target>[],
): void {
  for (const { target, top, left } of offsets) {
    target.scrollTop = top
    target.scrollLeft = left
  }
}

/**
 * Restore once immediately and once after the attached pane has laid out.
 *
 * Chromium can accept `scrollTop` while a retained subtree is first attached,
 * then clamp it back to zero when its new flex ancestors finish layout. The
 * guarded second write happens on the next frame and is ignored if the tab was
 * detached or moved again in the meantime.
 */
export function restoreRetainedScrollAfterLayout<Target extends RetainedScrollTarget>(
  offsets: readonly RetainedScrollOffset<Target>[],
  schedule: (callback: () => void) => void,
  isCurrent: () => boolean,
): void {
  restoreRetainedScroll(offsets)
  schedule(() => {
    if (isCurrent()) restoreRetainedScroll(offsets)
  })
}

interface RetainedTabEntry<Container, Holder, Content> {
  signal: AbortSignal
  container: Container
  root: RetainedTabRoot<Content>
  holder?: Holder
  visible: boolean
  render?: RetainedTabRender<Content>
  abort: () => void
}

export interface RetainedTabRegistry<Container, Holder, Content> {
  /** Number of live official tab occurrences retained by this registry. */
  readonly size: number
  attach(key: string, signal: AbortSignal, holder: Holder): void
  update(
    key: string,
    signal: AbortSignal,
    visible: boolean,
    render: RetainedTabRender<Content>,
  ): void
  detach(key: string, holder: Holder): void
  dispose(): void
}

/**
 * Compose the official per-Session tab identity into one collision-free key.
 * DSH only promises tab ids to be unique inside their owning Session.
 */
export function sidebarTabOccurrenceKey(sessionId: string, tabId: string): string {
  return `${String(sessionId.length)}:${sessionId}${String(tabId.length)}:${tabId}`
}

/**
 * Retain actual renderer roots until their official `tab.signal` ends.
 *
 * DSH's DockSurface renders only the active body in each docked pane. Its
 * lightweight slot body therefore comes and goes on every tab switch, while
 * the content root kept here is merely detached and reattached. Component
 * hooks, DOM nodes, scroll positions and live controllers all survive.
 */
export function createRetainedTabRegistry<Container, Holder, Content>(
  platform: RetainedTabPlatform<Container, Holder, Content>,
): RetainedTabRegistry<Container, Holder, Content> {
  const entries = new Map<string, RetainedTabEntry<Container, Holder, Content>>()
  let disposed = false

  const paint = (entry: RetainedTabEntry<Container, Holder, Content>): void => {
    if (entry.render === undefined) return
    entry.root.render(entry.render(entry.holder !== undefined && entry.visible))
  }

  const release = (
    key: string,
    entry: RetainedTabEntry<Container, Holder, Content>,
  ): void => {
    if (entries.get(key) !== entry) return
    entries.delete(key)
    entry.signal.removeEventListener('abort', entry.abort)
    platform.detach(entry.container)
    entry.root.unmount()
  }

  const acquire = (
    key: string,
    signal: AbortSignal,
  ): RetainedTabEntry<Container, Holder, Content> | undefined => {
    if (disposed) return undefined
    const current = entries.get(key)
    if (current?.signal === signal) return current
    if (current !== undefined) release(key, current)
    if (signal.aborted) return undefined

    const container = platform.createContainer()
    const root = platform.createRoot(container)
    const entry: RetainedTabEntry<Container, Holder, Content> = {
      signal,
      container,
      root,
      visible: false,
      abort: () => release(key, entry),
    }
    entries.set(key, entry)
    signal.addEventListener('abort', entry.abort, { once: true })
    // AbortSignal does not replay an abort that raced before addEventListener.
    if (signal.aborted) {
      release(key, entry)
      return undefined
    }
    return entry
  }

  return {
    get size() {
      return entries.size
    },
    attach(key, signal, holder) {
      const entry = acquire(key, signal)
      if (entry === undefined) return
      entry.holder = holder
      platform.attach(entry.container, holder)
      paint(entry)
    },
    update(key, signal, visible, render) {
      const entry = acquire(key, signal)
      if (entry === undefined) return
      entry.visible = visible
      entry.render = render
      paint(entry)
    },
    detach(key, holder) {
      const entry = entries.get(key)
      // Dock -> float and pane moves may overlap for one commit. An obsolete
      // mount must never detach the container from its newer holder.
      if (entry === undefined || entry.holder !== holder) return
      entry.holder = undefined
      paint(entry)
      platform.detach(entry.container)
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const [key, entry] of [...entries]) release(key, entry)
    },
  }
}

function browserPlatform(): RetainedTabPlatform<HTMLElement, HTMLElement, ReactNode> {
  const retainedScroll = new WeakMap<HTMLElement, RetainedScrollOffset<HTMLElement>[]>()
  const attachmentVersions = new WeakMap<HTMLElement, number>()

  const captureScroll = (container: HTMLElement): RetainedScrollOffset<HTMLElement>[] =>
    captureRetainedScroll(Array.from(
      container.querySelectorAll<HTMLElement>('[data-dsh-codex-retained-scroll]'),
    ))

  return {
    createContainer() {
      const container = document.createElement('div')
      container.className = 'dsh-codex-retained-tab-content'
      container.dataset.dshCodexRetainedTabContent = ''
      Object.assign(container.style, {
        // Keep the mounted tab root in a normal block formatting context. Making
        // it a flex item caused roots without an explicit `flex` value (files,
        // changes, graph) to shrink to their intrinsic width.
        display: 'block',
        flex: '1 1 auto',
        width: '100%',
        height: '100%',
        minWidth: '0',
        minHeight: '0',
        overflow: 'hidden',
      })
      return container
    },
    createRoot(container) {
      const root: Root = createRoot(container)
      return root
    },
    attach(container, holder) {
      if (container.parentElement === holder) return
      const offsets = retainedScroll.get(container) ?? captureScroll(container)
      const version = (attachmentVersions.get(container) ?? 0) + 1
      attachmentVersions.set(container, version)
      holder.appendChild(container)
      // These are the same DOM nodes, so restoring their native offsets does
      // not synthesize or rebuild component state.
      restoreRetainedScrollAfterLayout(
        offsets,
        callback => requestAnimationFrame(callback),
        () => attachmentVersions.get(container) === version
          && container.parentElement === holder,
      )
      retainedScroll.delete(container)
    },
    detach(container) {
      attachmentVersions.set(container, (attachmentVersions.get(container) ?? 0) + 1)
      retainedScroll.set(container, captureScroll(container))
      container.remove()
    },
  }
}

export type SidebarTabKeepAliveRegistry = RetainedTabRegistry<
  HTMLElement,
  HTMLElement,
  ReactNode
>

/** Create one browser registry per feature registration lifecycle. */
export function createSidebarTabKeepAliveRegistry(): SidebarTabKeepAliveRegistry {
  return createRetainedTabRegistry(browserPlatform())
}

export interface SidebarTabKeepAliveMountProps {
  registry: SidebarTabKeepAliveRegistry
  sessionId: string
  tabId: string
  signal: AbortSignal
  /** Official visibility; detachment is combined with this value. */
  visible: boolean
  render: RetainedTabRender<ReactNode>
}

/**
 * Disposable body DSH may remount. Only this empty holder follows DockSurface;
 * the renderer created by `registry` remains mounted until `signal` aborts.
 */
export function SidebarTabKeepAliveMount(props: SidebarTabKeepAliveMountProps) {
  const { registry, sessionId, tabId, signal, visible, render } = props
  const holderRef = useRef<HTMLDivElement>(null)
  const key = sidebarTabOccurrenceKey(sessionId, tabId)

  useLayoutEffect(() => {
    const holder = holderRef.current
    if (holder === null) return
    registry.attach(key, signal, holder)
    return () => registry.detach(key, holder)
  }, [key, registry, signal])

  useLayoutEffect(() => {
    registry.update(key, signal, visible, render)
  }, [key, registry, render, signal, visible])

  return (
    <div
      ref={holderRef}
      className="dsh-codex-retained-tab-mount"
      data-dsh-codex-retained-tab-mount=""
      style={{
        display: 'flex',
        flex: '1 1 auto',
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    />
  )
}
