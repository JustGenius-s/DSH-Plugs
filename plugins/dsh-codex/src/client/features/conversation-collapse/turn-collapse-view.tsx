import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'

/** Lucide briefcase-business, DSH 16px stroke (idle glyph for the row). */
function IconBriefcaseBusiness16() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 12h.01" />
      <path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      <path d="M22 13a18.15 18.15 0 0 1-20 0" />
      <rect width="20" height="14" x="2" y="6" rx="2" />
    </svg>
  )
}
import type { SettingsScope, UseConversationSession } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../../../shared/config'
import type { CodexKey } from '../../locales'
import {
  COLLAPSED_ATTR,
  TURN_ATTR,
  WORK_ATTR,
  closingAssistantKey,
  cssEscape,
  fillTemplate,
  formatWorkedDuration,
  isWorkNode,
  type CodexTurnCollapseData,
} from './model'
import { ensureCollapseStyles } from './styles'

export interface TurnCollapseViewProps {
  node: { data: CodexTurnCollapseData; key: string }
  useSession: UseConversationSession
  t: (key: CodexKey) => string
  scope?: SettingsScope<DshCodexConfig>
}

function closingSeqOf(snapshot: ConversationSnapshot, turn: number): number | undefined {
  const location = snapshot.chat.timeline.turns.get(turn)
  const tail = location?.data.get('turn-tail') as
    | { closing?: { finalNode?: { seq?: number } } }
    | undefined
  return tail?.closing?.finalNode?.seq
}

function markedRows(flow: Element, turn: number): NodeListOf<Element> {
  return flow.querySelectorAll(`[${TURN_ATTR}="${turn}"]`)
}

function markWorkNodes(
  flow: Element,
  keys: readonly string[],
  turn: number,
  collapsed: boolean,
): void {
  const keep = new Set(keys)
  for (const row of markedRows(flow, turn)) {
    if (!(row instanceof HTMLElement)) continue
    const key = row.dataset.chatAnchorKey
    if (key !== undefined && keep.has(key)) continue
    row.removeAttribute(WORK_ATTR)
    row.removeAttribute(TURN_ATTR)
    row.removeAttribute(COLLAPSED_ATTR)
  }
  for (const key of keys) {
    const row = flow.querySelector(`[data-chat-anchor-key="${cssEscape(key)}"]`)
    if (!(row instanceof HTMLElement)) continue
    row.setAttribute(WORK_ATTR, 'true')
    row.setAttribute(TURN_ATTR, String(turn))
    if (collapsed) row.setAttribute(COLLAPSED_ATTR, 'true')
    else row.removeAttribute(COLLAPSED_ATTR)
  }
}

function unmarkTurn(flow: Element, turn: number): void {
  for (const row of markedRows(flow, turn)) {
    if (!(row instanceof HTMLElement)) continue
    row.removeAttribute(WORK_ATTR)
    row.removeAttribute(TURN_ATTR)
    row.removeAttribute(COLLAPSED_ATTR)
  }
}

export function TurnCollapseView(props: TurnCollapseViewProps) {
  const { node, useSession, t, scope } = props
  const data = node.data
  const scopeSnapshot = useSyncExternalStore(
    scope === undefined ? () => () => {} : listener => scope.subscribe(listener),
    scope === undefined ? () => undefined : () => scope.getSnapshot(),
    scope === undefined ? () => undefined : () => scope.getSnapshot(),
  )
  const enabled = scopeSnapshot?.value?.conversationCollapseEnabled
    ?? DEFAULT_CONFIG.conversationCollapseEnabled

  const hostRef = useRef<HTMLButtonElement | null>(null)
  const flowRef = useRef<Element | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (data.closed || data.startTime === undefined) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [data.closed, data.startTime])

  const order = useSession(snapshot => snapshot.chat.order)
  const nodes = useSession(snapshot => snapshot.chat.nodes)
  const locations = useSession(snapshot => snapshot.chat.locations)
  const closingSeq = useSession(snapshot => closingSeqOf(snapshot, data.turn))

  const workKeys = useMemo(() => {
    const keys = locations.getTurn(data.turn)
    const closingAssistant = closingAssistantKey(
      keys,
      key => nodes.get(key),
      closingSeq,
    )
    return keys.filter(key => isWorkNode(key, nodes.get(key), closingAssistant))
  }, [closingSeq, data.turn, locations, nodes, order])

  // Codex desktop closes the disclosure when the turn finishes: the visible
  // summary is `startTime → endTime` (the real worked span), never a live
  // clock. The user can still open the trace again from the row.
  const [detailsOpen, setDetailsOpen] = useState(() => !data.closed)
  const detailsWasClosedRef = useRef(data.closed)
  useEffect(() => {
    if (data.closed && !detailsWasClosedRef.current) setDetailsOpen(false)
    detailsWasClosedRef.current = data.closed
  }, [data.closed])

  useLayoutEffect(() => {
    ensureCollapseStyles()
    const found = hostRef.current?.closest('[data-chat-flow]')
    if (found !== null && found !== undefined) flowRef.current = found
    const flow = found ?? flowRef.current
    if (flow === null) return
    const apply = (): void => {
      if (!enabled) {
        unmarkTurn(flow, data.turn)
        return
      }
      markWorkNodes(flow, workKeys, data.turn, !detailsOpen)
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(flow, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      unmarkTurn(flow, data.turn)
    }
  }, [data.turn, enabled, detailsOpen, workKeys])

  if (!enabled) return null

  // Elapsed is stable after the turn ends (data.endTime); while running it
  // derives from `now` on a 1s cadence. Word order follows Codex desktop.
  const elapsedMs = data.startTime === undefined
    ? undefined
    : Math.max(0, (data.endTime ?? now) - data.startTime)
  const duration = elapsedMs === undefined ? undefined : formatWorkedDuration(elapsedMs)
  const word = data.closed
    ? (duration === undefined
      ? t('collapse.worked')
      : fillTemplate(t('collapse.workedFor'), { duration }))
    : (duration === undefined
      ? t('collapse.working')
      : fillTemplate(t('collapse.workingFor'), { duration }))

  return (
    <button
      ref={hostRef}
      type="button"
      className={'dsh-codex-collapse' + (detailsOpen ? ' is-open' : '')}
      aria-expanded={detailsOpen}
      aria-label={detailsOpen ? t('collapse.hideAria') : t('collapse.showAria')}
      onClick={() => setDetailsOpen(value => !value)}
    >
      <span className="dsh-codex-collapse-leading" aria-hidden="true">
        <span className="dsh-codex-collapse-idle">
          <IconBriefcaseBusiness16 />
        </span>
        <span className="dsh-codex-collapse-chevron">
          <IconChevronDownOutline14 />
        </span>
      </span>
      <span className="dsh-codex-collapse-label">{word}</span>
    </button>
  )
}
