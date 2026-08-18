import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
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

/**
 * Collapsed-state glyph for the Worked-for row. Official Lucide pickaxe, drawn
 * as a round-cap stroke (fill none) and displayed at DSH 14px.
 */
function IconPickaxeOutline14(props: {
  size?: number
  className?: string
}) {
  const size = props.size ?? 14
  return (
    <svg
      width={size}
      height={size}
      className={props.className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="m14 13-8.381 8.38a1 1 0 0 1-3.001-3L11 9.999" />
      <path
        d={
          'M15.973 4.027A13 13 0 0 0 5.902 2.373c-1.398.342-1.092 '
          + '2.158.277 2.601a19.9 19.9 0 0 1 5.822 3.024'
        }
      />
      <path
        d={
          'M16.001 11.999a19.9 19.9 0 0 1 3.024 5.824c.444 1.369 2.26 '
          + '1.676 2.603.278A13 13 0 0 0 20 8.069'
        }
      />
      <path
        d={
          'M18.352 3.352a1.205 1.205 0 0 0-1.704 0l-5.296 5.296a1.205 '
          + '1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l'
          + '5.296-5.296a1.205 1.205 0 0 0 0-1.704z'
        }
      />
    </svg>
  )
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
  const [expanded, setExpanded] = useState(() => !data.closed)
  const wasClosedRef = useRef(data.closed)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (data.closed && !wasClosedRef.current) setExpanded(false)
    wasClosedRef.current = data.closed
  }, [data.closed])

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
      markWorkNodes(flow, workKeys, data.turn, !expanded)
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(flow, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      unmarkTurn(flow, data.turn)
    }
  }, [data.turn, enabled, expanded, workKeys])

  if (!enabled) return null

  const elapsedMs = data.startTime === undefined
    ? undefined
    : Math.max(0, (data.endTime ?? now) - data.startTime)
  const duration = elapsedMs === undefined ? undefined : formatWorkedDuration(elapsedMs)
  const label = data.closed
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
      className="dsh-codex-collapse"
      aria-expanded={expanded}
      aria-label={expanded ? t('collapse.collapseAria') : t('collapse.expandAria')}
      onClick={() => setExpanded(value => !value)}
    >
      <span className="dsh-codex-collapse-icon" aria-hidden="true">
        <span className="dsh-codex-collapse-pickaxe">
          <IconPickaxeOutline14 />
        </span>
        <span className="dsh-codex-collapse-chevron">
          <IconChevronDownOutline14 />
        </span>
      </span>
      <span className="dsh-codex-collapse-label">{label}</span>
    </button>
  )
}
