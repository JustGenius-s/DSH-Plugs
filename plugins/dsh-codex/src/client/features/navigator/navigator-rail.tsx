import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { DshCodexConfig } from '../../../shared/config'
import { isAppendSurfaceEvent, isReplacementSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  IApiClient,
  SessionEvent,
} from '@deepseek-ai/dsh-client-connection/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  chatAnchorRow,
  chatFlow,
  closestConversationScroll,
} from '../../host-adapters/conversation-dom'
import type { NavigatorRegistry } from './registry'
import {
  readConversationHistoryPage,
  type ConversationHistoryAddress,
} from '../../host-adapters/conversation-history'

/** Stepped bar widths, indexed by distance from the hovered bar (e-pi effect). */
const LEVEL_WIDTHS = [18, 26, 34, 46]

/** Hit-area geometry: a 16px tall transparent button per tick, overlapped by
 * 5px so the visible bars stay ~8px apart while every pixel along the rail is
 * hoverable (no dead zones between ticks). */
const HIT_HEIGHT = 16
const OVERLAP = 5

/** Top margin left above the message when jumping (so it doesn't sit flush at the viewport top). */
const JUMP_MARGIN = 20

/** Page size used when reading the full session history from the host. */
const HISTORY_PAGE_SIZE = 50

interface Entry {
  key: string | null
  seq: number
  label: string
}

interface HistoryEntry {
  seq: number
  label: string
}

function textOf(data: unknown): string {
  if (data && typeof data === 'object') {
    const content = 'content' in data ? data.content : undefined
    if (Array.isArray(content)) {
      const text = content
        .filter(block => block && typeof block === 'object' && 'type' in block && block.type === 'text')
        .map(block => String('text' in block ? block.text ?? '' : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (text) return text.length > 80 ? text.slice(0, 80) + '…' : text
    }
  }
  return 'Message'
}

/** Mirror the ChatView classification: compaction checkpoints are markers, not user messages. */
function isCompactionCheckpoint(event: SessionEvent): boolean {
  if (!event || event.type !== 'user/message') return false
  const source = event.data?.source
  return source?.kind === 'plugin' && source?.plugin === 'compact' && isReplacementSurfaceEvent(event)
}

/** True for one durable user-authored append-surface message. */
function isUserMessageEvent(event: SessionEvent): boolean {
  if (!event || event.type !== 'user/message') return false
  const data = event.data
  if (!data || data.source?.kind !== 'user') return false
  if (!isAppendSurfaceEvent(event)) return false
  return !isCompactionCheckpoint(event)
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

type NavigatorRailProps = PropsRuntime<'conversation.chat.turnTail'> & {
  scope: SettingsScope<DshCodexConfig>
  registry: NavigatorRegistry
  api: IApiClient
  loadOlder: () => Promise<void>
}

export function NavigatorRail(props: NavigatorRailProps) {
  const { registry, scope, sessionId, seq } = props
  const tokenRef = useRef<symbol | null>(null)
  tokenRef.current ??= Symbol(`navigator:${sessionId}:${seq}`)
  const token = tokenRef.current

  useEffect(() => registry.register(sessionId, token, seq), [registry, seq, sessionId, token])
  const registrySnapshot = useSyncExternalStore(registry.subscribe, registry.getSnapshot)
  const scopeSnapshot = useSyncExternalStore(
    listener => scope.subscribe(listener),
    () => scope.getSnapshot(),
    () => scope.getSnapshot(),
  )
  const navigatorEnabled = scopeSnapshot?.value?.navigatorEnabled ?? true
  if (!navigatorEnabled || !registry.isOwner(registrySnapshot, sessionId, token)) return null
  return <NavigatorRailContent {...props} />
}

function NavigatorRailContent(props: NavigatorRailProps) {
  const { sessionId, useSession, api, loadOlder } = props
  const hostRef = useRef<HTMLSpanElement | null>(null)
  const order = useSession((snapshot: ConversationSnapshot) => snapshot.chat.order)
  const nodes = useSession((snapshot: ConversationSnapshot) => snapshot.chat.nodes)
  const hasMore = useSession((snapshot: ConversationSnapshot) => snapshot.hasMore)
  const loadingOlder = useSession((snapshot: ConversationSnapshot) => snapshot.loadingOlder)
  const subagent = useSession((snapshot: ConversationSnapshot) => snapshot.subagent)

  const address: ConversationHistoryAddress | undefined = subagent === null
    ? undefined
    : {
        parentSessionId: String(subagent.address.parentSessionId),
        childSessionId: String(subagent.address.childSessionId),
        mode: subagent.address.mode,
      }
  const addressKey = address
    ? `subagent:${address.parentSessionId}:${address.childSessionId}:${address.mode}`
    : 'session'

  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([])
  const [view, setView] = useState({ scrollTop: 0, left: 0, height: window.innerHeight, viewport: window.innerHeight })
  const [offsets, setOffsets] = useState<Record<string, number>>({})
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const [tip, setTip] = useState<{ top: number; left: number; label: string } | null>(null)
  const [pendingSeq, setPendingSeq] = useState<number | null>(null)
  const lastFirstSeqRef = useRef<number | null>(null)
  const loadAttemptsRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    const acc = new Map<number, HistoryEntry>()
    const publish = () => {
      if (cancelled) return
      setHistoryEntries([...acc.values()].sort((a, b) => a.seq - b.seq))
    }
    ;(async () => {
      let beforeSeq: number | undefined
      while (!cancelled) {
        const page = await readConversationHistoryPage(
          api,
          sessionId,
          address,
          beforeSeq,
          HISTORY_PAGE_SIZE,
        )
        if (cancelled) return
        if (!page) break
        for (const item of page.events) {
          const event = item?.event
          if (!isUserMessageEvent(event)) continue
          acc.set(event.seq, { seq: event.seq, label: textOf(event.data) })
        }
        publish()
        if (!page.hasMore) break
        const first = page.events[0]?.event
        if (!first || first.seq <= 0) break
        if (beforeSeq !== undefined && first.seq >= beforeSeq) break
        beforeSeq = first.seq
      }
    })()
    return () => { cancelled = true }
  }, [api, sessionId, addressKey])

  const entries: Entry[] = useMemo(() => {
    const loadedBySeq = new Map<number, Entry>()
    for (const key of order ?? []) {
      const node = nodes?.get?.(key)
      if (node?.kind === 'user') {
        const seq = node.anchorSeq ?? 0
        loadedBySeq.set(seq, { key, seq, label: textOf(node.data) })
      }
    }
    const seen = new Set<number>()
    const merged: Entry[] = []
    const push = (entry: Entry) => {
      if (seen.has(entry.seq)) return
      seen.add(entry.seq)
      merged.push(entry)
    }
    for (const item of historyEntries) push(loadedBySeq.get(item.seq) ?? { key: null, seq: item.seq, label: item.label })
    for (const item of loadedBySeq.values()) push(item)
    return merged.sort((a, b) => a.seq - b.seq)
  }, [historyEntries, order, nodes])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const sp = closestConversationScroll(host)
    if (!sp) return
    const measure = () => {
      const rect = sp.getBoundingClientRect()
      const off: Record<string, number> = {}
      for (const e of entries) {
        if (!e.key) continue
        const row = chatAnchorRow(sp, e.key)
        if (row) off[e.key] = row.getBoundingClientRect().top - rect.top + sp.scrollTop
      }
      setOffsets(off)
      setView({ scrollTop: sp.scrollTop, left: rect.left, height: window.innerHeight, viewport: rect.height })
    }
    const raf = requestAnimationFrame(measure)
    sp.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    const ro = new ResizeObserver(measure)
    ro.observe(sp)
    const flow = chatFlow(sp)
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
    for (const e of entries) {
      if (!e.key) continue
      const offset = offsets[e.key]
      if (offset !== undefined && offset < view.scrollTop + view.viewport) active = e.key
    }
    return active
  }, [entries, offsets, view.scrollTop, view.viewport])

  const jumpToKey = (key: string) => {
    const host = hostRef.current
    const sp = host === null || host === undefined ? null : closestConversationScroll(host)
    if (!sp) {
      console.warn('[session-navigator] jump: scrollport not found')
      return
    }
    const row = chatAnchorRow(sp, key)
    if (!row) {
      console.warn('[session-navigator] jump: row not found', key)
      return
    }
    const rect = sp.getBoundingClientRect()
    const offset = row.getBoundingClientRect().top - rect.top + sp.scrollTop
    const target = Math.max(0, offset - JUMP_MARGIN)
    animateScroll(sp, target)
  }

  const jumpToEntry = (entry: Entry) => {
    if (entry.key) {
      jumpToKey(entry.key)
      return
    }
    const host = hostRef.current
    const sp = host === null || host === undefined ? null : closestConversationScroll(host)
    if (sp) sp.scrollTop = 0
    setPendingSeq(entry.seq)
  }

  useEffect(() => {
    if (pendingSeq === null) return
    const loaded = entries.find((e) => e.seq === pendingSeq && e.key !== null)
    if (loaded?.key) {
      setPendingSeq(null)
      const key = loaded.key
      requestAnimationFrame(() => jumpToKey(key))
      return
    }
    if (!hasMore) {
      console.warn('[session-navigator] jump: message not in window and no more history', pendingSeq)
      setPendingSeq(null)
      return
    }
    if (loadingOlder) return
    if (typeof loadOlder !== 'function') {
      console.warn('[session-navigator] jump: loadOlder unavailable')
      setPendingSeq(null)
      return
    }
    const firstLoadedSeq = entries.find((e) => e.key !== null)?.seq ?? null
    if (firstLoadedSeq !== null && pendingSeq >= firstLoadedSeq) {
      console.warn('[session-navigator] jump: target is not a user node in the loaded window', pendingSeq)
      setPendingSeq(null)
      return
    }
    if (firstLoadedSeq === lastFirstSeqRef.current) {
      loadAttemptsRef.current += 1
    } else {
      loadAttemptsRef.current = 0
      lastFirstSeqRef.current = firstLoadedSeq
    }
    if (loadAttemptsRef.current > 3) {
      console.warn('[session-navigator] jump: history page did not advance', pendingSeq)
      setPendingSeq(null)
      return
    }
    const id = window.setTimeout(() => {
      try {
        const host = hostRef.current
        const sp = host === null || host === undefined ? null : closestConversationScroll(host)
        if (sp) sp.scrollTop = 0
        void loadOlder().catch(() => {})
      } catch (error) {
        console.warn('[session-navigator] jump: loadOlder failed', error)
        setPendingSeq(null)
      }
    }, 0)
    return () => window.clearTimeout(id)
  }, [pendingSeq, entries, hasMore, loadingOlder, loadOlder])

  const hoveredIndex = hoveredKey
    ? entries.findIndex((e) => (e.key ?? `seq:${e.seq}`) === hoveredKey)
    : -1

  const enter = (event: ReactMouseEvent<HTMLElement>, key: string, label: string) => {
    setHoveredKey(key)
    const rect = event.currentTarget.getBoundingClientRect()
    setTip({ top: rect.top + rect.height / 2, left: rect.right + 10, label })
  }
  const leave = () => {
    setHoveredKey(null)
    setTip(null)
  }

  const railHeight = Math.max(160, view.height * 0.8)
  const spacing = entries.length <= 1
    ? HIT_HEIGHT - OVERLAP
    : Math.max(3, Math.min(HIT_HEIGHT - OVERLAP, (railHeight - OVERLAP) / entries.length))
  const hitHeight = spacing + OVERLAP
  const railScrollable = entries.length * spacing + OVERLAP > railHeight

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
        maxHeight: railHeight,
        overflowY: railScrollable ? 'auto' : 'hidden',
        overscrollBehavior: 'contain',
        pointerEvents: railScrollable ? 'auto' : 'none',
        scrollbarWidth: 'none',
      }}
      onMouseLeave={leave}
    >
      {entries.map((e, index) => {
        const hoverId = e.key ?? `seq:${e.seq}`
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
            key={hoverId}
            type="button"
            aria-label={`Jump to: ${e.label}`}
            onMouseEnter={(ev) => enter(ev, hoverId, e.label)}
            onClick={() => jumpToEntry(e)}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              width: LEVEL_WIDTHS[3],
              height: hitHeight,
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
