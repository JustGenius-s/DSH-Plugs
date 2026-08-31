import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../../../shared/config'
import type { CodexKey } from '../../locales'
import { pinnedUserKey, promptImageCount, promptImageSrcs, promptTextOf, userRowOf } from './model'
import { ensureStickyBubbleStyles } from './styles'

interface StickyUserBubbleProps {
  sessionId: string
  useSession: (selector: (snapshot: any) => any) => any
  scope?: SettingsScope<DshCodexConfig>
  t: (key: CodexKey) => string
}

function conversationRoot(from: Element | null): HTMLElement | null {
  if (from === null) return null
  const rooted = from.closest('[data-phase]')
  if (rooted instanceof HTMLElement) return rooted
  return from instanceof HTMLElement ? from : null
}

function scrollportOf(from: Element | null): HTMLElement | null {
  const root = conversationRoot(from)
  const scoped = root?.querySelector('[data-conversation-scroll]')
  if (scoped instanceof HTMLElement) return scoped
  const found = document.querySelector('[data-conversation-scroll]')
  return found instanceof HTMLElement ? found : null
}

function IconZoomOutline14(props: { size?: number }) {
  const size = props.size ?? 14
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
      <path d="M11 8v6" />
      <path d="M8 11h6" />
    </svg>
  )
}

function IconCloseOutline14(props: { size?: number }) {
  const size = props.size ?? 14
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

function StickyImagePreview(props: {
  src: string
  t: (key: CodexKey) => string
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      props.onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [props.onClose])

  return createPortal(
    <div
      className="dsh-codex-sticky-preview"
      role="dialog"
      aria-modal="true"
      aria-label={props.t('sticky.previewDialog')}
      onClick={props.onClose}
    >
      <button
        type="button"
        className="dsh-codex-sticky-preview-close"
        aria-label={props.t('sticky.previewClose')}
        onClick={(event) => {
          event.stopPropagation()
          props.onClose()
        }}
      >
        <IconCloseOutline14 />
      </button>
      <img
        src={props.src}
        alt=""
        onClick={(event) => event.stopPropagation()}
      />
    </div>,
    document.body,
  )
}

function StickyThumb(props: {
  src: string
  t: (key: CodexKey) => string
  onPreview: (src: string) => void
}) {
  const open = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    props.onPreview(props.src)
  }
  return (
    <span className="dsh-codex-sticky-thumb-wrap">
      <img className="dsh-codex-sticky-thumb" src={props.src} alt="" draggable={false} />
      <button
        type="button"
        className="dsh-codex-sticky-thumb-zoom"
        aria-label={props.t('sticky.previewAria')}
        title={props.t('sticky.previewAria')}
        onClick={open}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <IconZoomOutline14 />
      </button>
    </span>
  )
}

export function StickyUserBubble(props: StickyUserBubbleProps) {
  const { useSession, scope, t } = props
  const scopeSnapshot = useSyncExternalStore(
    scope === undefined ? () => () => {} : listener => scope.subscribe(listener),
    scope === undefined ? () => undefined : () => scope.getSnapshot(),
    scope === undefined ? () => undefined : () => scope.getSnapshot(),
  )
  const enabled = scopeSnapshot?.value?.stickyUserBubbleEnabled
    ?? DEFAULT_CONFIG.stickyUserBubbleEnabled
  const mode = scopeSnapshot?.value?.stickyUserBubbleMode
    ?? DEFAULT_CONFIG.stickyUserBubbleMode
  const running = useSession((snapshot: { running?: boolean }) => snapshot?.running === true)
  const order = useSession((snapshot: any) => snapshot?.chat?.order)
  const nodes = useSession((snapshot: any) => snapshot?.chat?.nodes)

  const hostRef = useRef<HTMLSpanElement | null>(null)
  const pinRef = useRef<HTMLDivElement | null>(null)
  const [layout, setLayout] = useState({
    top: 0,
    left: 0,
    width: 0,
    key: null as string | null,
    imageSrcs: [] as string[],
  })
  const [expanded, setExpanded] = useState(false)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)

  const entries = useMemo(() => {
    const list: Array<{ key: string; label: string; imageCount: number }> = []
    for (const key of order ?? []) {
      const node = nodes?.get?.(key)
      if (node?.kind !== 'user') continue
      const imageCount = promptImageCount(node.data)
      list.push({
        key,
        label: promptTextOf(node.data, imageCount > 0 ? '' : t('sticky.empty')),
        imageCount,
      })
    }
    return list
  }, [nodes, order, t])

  useEffect(() => {
    setExpanded(false)
    setPreviewSrc(null)
  }, [layout.key])

  useEffect(() => {
    if (!expanded && previewSrc === null) return
    const fromPin = (target: EventTarget | null): boolean => (
      target instanceof Node
      && (
        (pinRef.current?.contains(target) ?? false)
        || (target instanceof Element && target.closest('.dsh-codex-sticky-preview') !== null)
      )
    )
    const collapse = (): void => {
      setExpanded(false)
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (fromPin(event.target)) return
      collapse()
    }
    const onWheel = (event: WheelEvent): void => {
      if (fromPin(event.target)) return
      collapse()
    }
    const onScroll = (event: Event): void => {
      if (fromPin(event.target)) return
      collapse()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (previewSrc !== null) return
      if (event.key === 'Escape') collapse()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { capture: true, passive: true })
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [expanded, previewSrc])

  useEffect(() => {
    ensureStickyBubbleStyles()
    const host = hostRef.current
    const scrollport = scrollportOf(host)
    if (scrollport === null) {
      const retry = window.setTimeout(() => {
        if (scrollportOf(hostRef.current) !== null) setLayout(current => ({ ...current }))
      }, 50)
      return () => window.clearTimeout(retry)
    }

    const active = enabled && (mode === 'always' || running)

    const measure = (): void => {
      const flow = scrollport.querySelector('[data-chat-flow]') as HTMLElement | null
      const portRect = scrollport.getBoundingClientRect()
      const flowRect = flow?.getBoundingClientRect()
      const left = flowRect?.left ?? portRect.left
      const width = flowRect?.width ?? portRect.width
      if (!active) {
        setLayout({ top: portRect.top, left, width, key: null, imageSrcs: [] })
        return
      }
      const key = pinnedUserKey(
        scrollport,
        entries.map(entry => entry.key),
        portRect,
      )
      const imageSrcs = key === null ? [] : promptImageSrcs(userRowOf(scrollport, key))
      setLayout({ top: portRect.top, left, width, key, imageSrcs })
    }

    measure()
    const raf = requestAnimationFrame(measure)
    scrollport.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    const observer = new ResizeObserver(measure)
    observer.observe(scrollport)
    const flow = scrollport.querySelector('[data-chat-flow]')
    if (flow instanceof HTMLElement) observer.observe(flow)
    const mutations = new MutationObserver(measure)
    mutations.observe(flow ?? scrollport, { childList: true, subtree: true })
    return () => {
      cancelAnimationFrame(raf)
      scrollport.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      observer.disconnect()
      mutations.disconnect()
    }
  }, [enabled, entries, mode, running])

  const active = entries.find(entry => entry.key === layout.key)
  const show = active !== undefined && layout.width > 0

  useLayoutEffect(() => {
    if (!show || expanded) return
    const thumbs = pinRef.current?.querySelector('.dsh-codex-sticky-thumbs')
    if (!(thumbs instanceof HTMLElement)) return
    const mark = (): void => {
      thumbs.toggleAttribute('data-overflow', thumbs.scrollWidth > thumbs.clientWidth + 1)
    }
    mark()
    const observer = new ResizeObserver(mark)
    observer.observe(thumbs)
    const images = [...thumbs.querySelectorAll('img')]
    for (const image of images) image.addEventListener('load', mark)
    return () => {
      observer.disconnect()
      for (const image of images) image.removeEventListener('load', mark)
    }
  }, [show, expanded, layout.imageSrcs, layout.width, active?.imageCount])

  const toggleExpanded = (): void => {
    setExpanded(value => !value)
  }

  const onBubbleKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    toggleExpanded()
  }

  return (
    <>
      <span ref={hostRef} style={{ display: 'none' }} aria-hidden="true" />
      {show && active !== undefined
        ? createPortal(
          <div
            ref={pinRef}
            className="dsh-codex-sticky-pin"
            style={{ top: layout.top, left: layout.left, width: layout.width }}
          >
            <div
              className="dsh-codex-sticky-bubble"
              role="button"
              tabIndex={0}
              data-expanded={expanded ? 'true' : 'false'}
              aria-expanded={expanded}
              aria-label={expanded ? t('sticky.collapseAria') : t('sticky.expandAria')}
              onClick={toggleExpanded}
              onKeyDown={onBubbleKey}
            >
              {active.imageCount > 0 ? (
                <span className="dsh-codex-sticky-thumbs">
                  {(layout.imageSrcs.length > 0 ? layout.imageSrcs : Array.from({ length: active.imageCount }, () => '')).map((src, index) => (
                    src === ''
                      ? <span key={index} className="dsh-codex-sticky-thumb-wrap" aria-hidden="true" />
                      : (
                        <StickyThumb
                          key={`${src}:${index}`}
                          src={src}
                          t={t}
                          onPreview={setPreviewSrc}
                        />
                      )
                  ))}
                </span>
              ) : null}
              {active.label !== '' ? (
                <span className="dsh-codex-sticky-text">{active.label}</span>
              ) : null}
            </div>
          </div>,
          document.body,
        )
        : null}
      {previewSrc !== null
        ? (
          <StickyImagePreview
            src={previewSrc}
            t={t}
            onClose={() => setPreviewSrc(null)}
          />
        )
        : null}
    </>
  )
}
