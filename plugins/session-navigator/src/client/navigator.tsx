import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

// One rail per session: the turnTail chain renders once per completed turn,
// but the navigator is a single fixed overlay. The first mounted turn claims
// the rail for its session; every other turn renders nothing.
const claimedSessions = new Set<string>()

/** Stepped bar widths, indexed by distance from the hovered bar (e-pi effect). */
const LEVEL_WIDTHS = [18, 26, 34, 46]

// Hit-area geometry: a 16px tall transparent button per tick, overlapped by
// 5px so the visible bars stay ~8px apart while every pixel along the rail is
// hoverable (no dead zones between ticks).
const HIT_HEIGHT = 16
const OVERLAP = 5
/** Top margin left above the message when jumping (so it doesn't sit flush at the viewport top). */
const JUMP_MARGIN = 20

interface Entry {
  key: string
  seq: number
  label: string
}

function textOf(data: unknown): string {
  if (data && typeof data === 'object') {
    const content = (data as any).content
    if (Array.isArray(content)) {
      const text = content
        .filter((b: any) => b && typeof b === 'object' && b.type === 'text')
        .map((b: any) => String(b.text ?? ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (text) return text.length > 80 ? text.slice(0, 80) + '…' : text
    }
  }
  return 'Message'
}

export function NavigatorRail(props: any) {
  const { sessionId, useSession } = props
  const [claimed] = useState(() => {
    if (claimedSessions.has(sessionId)) return false
    claimedSessions.add(sessionId)
    return true
  })
  useEffect(() => () => { claimedSessions.delete(sessionId) }, [sessionId])
  if (!claimed) return null
  return <RailImpl sessionId={sessionId} useSession={useSession} />
}

function RailImpl({ sessionId, useSession }: any) {
  const hostRef = useRef<HTMLSpanElement | null>(null)
  const order = useSession((s: any) => s.chat.order)
  const nodes = useSession((s: any) => s.chat.nodes)

  const entries: Entry[] = useMemo(() => {
    const list: Entry[] = []
    for (const key of order ?? []) {
      const node = nodes?.get?.(key)
      if (node?.kind === 'user') {
        list.push({ key, seq: node.anchorSeq ?? 0, label: textOf(node.data) })
      }
    }
    return list
  }, [order, nodes])

  const [view, setView] = useState({ scrollTop: 0, left: 0 })
  const [offsets, setOffsets] = useState<Record<string, number>>({})
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const [tip, setTip] = useState<{ top: number; left: number; label: string } | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const sp = host.closest('[data-conversation-scroll]') as HTMLElement | null
    if (!sp) return
    const measure = () => {
      const rect = sp.getBoundingClientRect()
      const off: Record<string, number> = {}
      for (const e of entries) {
        const row = sp.querySelector(`[data-chat-anchor-key="${cssEscape(e.key)}"]`)
        if (row) off[e.key] = row.getBoundingClientRect().top - rect.top + sp.scrollTop
      }
      setOffsets(off)
      setView({ scrollTop: sp.scrollTop, left: rect.left })
    }
    const raf = requestAnimationFrame(measure)
    sp.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    const ro = new ResizeObserver(measure)
    ro.observe(sp)
    const flow = sp.querySelector('[data-chat-flow]')
    const mo = new MutationObserver(() => measure())
    mo.observe(flow ?? sp, { childList: true, subtree: true })
    return () => {
      cancelAnimationFrame(raf)
      sp.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      ro.disconnect()
      mo.disconnect()
    }
  }, [entries])

  const activeKey = useMemo(() => {
    let active: string | undefined
    for (const e of entries) if ((offsets[e.key] ?? 0) <= view.scrollTop + 1) active = e.key
    return active
  }, [entries, offsets, view.scrollTop])

  const jump = (key: string) => {
    const host = hostRef.current
    const sp = host?.closest('[data-conversation-scroll]') as HTMLElement | null
    if (!sp) {
      console.warn('[session-navigator] jump: scrollport not found')
      return
    }
    // Compute the target offset fresh from the DOM (never a stale snapshot).
    const row = sp.querySelector(`[data-chat-anchor-key="${cssEscape(key)}"]`)
    if (!row) {
      console.warn('[session-navigator] jump: row not found', key)
      return
    }
    const rect = sp.getBoundingClientRect()
    const offset = row.getBoundingClientRect().top - rect.top + sp.scrollTop
    const target = Math.max(0, offset - JUMP_MARGIN)
    animateScroll(sp, target)
  }

  const hoveredIndex = hoveredKey ? entries.findIndex((e) => e.key === hoveredKey) : -1

  const enter = (event: ReactMouseEvent<HTMLElement>, key: string, label: string) => {
    setHoveredKey(key)
    const rect = event.currentTarget.getBoundingClientRect()
    setTip({ top: rect.top + rect.height / 2, left: rect.right + 10, label })
  }
  const leave = () => {
    setHoveredKey(null)
    setTip(null)
  }

  const rail = (
    <div
      style={{
        position: 'fixed',
        top: '50%',
        transform: 'translateY(-50%)',
        left: Math.max(8, view.left + 8),
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        maxHeight: '80%',
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
      onMouseLeave={leave}
    >
      {entries.map((e, index) => {
        const active = e.key === activeKey
        const distance = hoveredIndex < 0 ? undefined : Math.abs(index - hoveredIndex)
        const level = distance === undefined ? 0 : distance === 0 ? 3 : distance === 1 ? 2 : distance === 2 ? 1 : 0
        const width = LEVEL_WIDTHS[level]
        const color = active
          ? 'var(--dsw-static-deepseek-500)'
          : distance === 0
            ? 'var(--dsw-alias-label-primary)'
            : 'var(--dsw-alias-label-tertiary)'
        return (
          <button
            key={e.key}
            type="button"
            aria-label={`Jump to: ${e.label}`}
            onMouseEnter={(ev) => enter(ev, e.key, e.label)}
            onClick={() => jump(e.key)}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              width: LEVEL_WIDTHS[3],
              height: HIT_HEIGHT,
              marginTop: index === 0 ? 0 : -OVERLAP,
              padding: 0,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              pointerEvents: 'auto',
            }}
          >
            <span
              style={{
                display: 'block',
                width,
                height: 3,
                borderRadius: 2,
                background: color,
                opacity: active || distance === 0 ? 1 : 0.55,
                transition: 'width .14s ease, background .14s ease',
              }}
            />
          </button>
        )
      })}
    </div>
  )

  return (
    <>
      <span ref={hostRef} style={{ display: 'none' }} />
      {createPortal(rail, document.body)}
      {tip &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              top: tip.top,
              left: tip.left,
              transform: 'translateY(-50%)',
              whiteSpace: 'nowrap',
              maxWidth: 320,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              background: 'var(--dsw-alias-bg-base)',
              border: '1px solid var(--dsw-alias-border-l2)',
              borderRadius: 8,
              padding: '6px 10px',
              fontSize: 12,
              color: 'var(--dsw-alias-label-primary)',
              boxShadow: 'var(--dsw-shadow-lv2)',
              pointerEvents: 'none',
              zIndex: 61,
            }}
          >
            {tip.label}
          </div>,
          document.body,
        )}
    </>
  )
}

/** rAF-driven scroll: sets scrollTop directly each frame so it cannot be
 * canceled by the browser (unlike scrollTo({behavior:'smooth'})) and keeps
 * re-asserting, which survives the ChatView's stick-to-bottom while at the
 * conversation floor. */
function animateScroll(sp: HTMLElement, target: number) {
  const start = sp.scrollTop
  const delta = target - start
  if (Math.abs(delta) < 1) return
  const duration = 280
  const startTime = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - startTime) / duration)
    const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
    sp.scrollTop = start + delta * eased
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

function cssEscape(value: string): string {
  const escape = (window as any).CSS?.escape
  if (typeof escape === 'function') return escape(value)
  return value.replace(/["'\\\0-\x1f]/g, (c: string) => '\\' + c)
}
