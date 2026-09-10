import type { ConversationNodeDefinition } from '@just-genius/dsh-plugin-runtime/client'
import type { CodexTurnCollapseData, CollapseState } from './model'
import { TURN_COLLAPSE_KIND, turnFromEvent } from './model'

declare module '@just-genius/dsh-plugin-runtime/client' {
  interface PluginChatNodeDataMap {
    /** Collapsible per-turn work disclosure. */
    'codex-turn-collapse': CodexTurnCollapseData
  }
}

const WORK_EVENT_TYPES = new Set([
  'tool/call',
  'tool-workflow/run-start',
])

/** Events that can appear as the first expanded row under "Worked for". */
const POSITION_EVENT_TYPES = new Set([
  ...WORK_EVENT_TYPES,
  'assistant/chunk',
  'assistant/message',
])

function isWorkEvent(type: string): boolean {
  return WORK_EVENT_TYPES.has(type)
}

function isPositionEvent(type: string): boolean {
  return POSITION_EVENT_TYPES.has(type)
}

function withFirstWorkSeq(state: CollapseState, seq: number): CollapseState {
  return {
    ...state,
    firstWorkSeq: Math.min(state.firstWorkSeq ?? seq, seq),
  }
}

/** One disclosure row per agent turn that actually ran tools. */
export const turnCollapseDefinition: ConversationNodeDefinition<CollapseState> = {
  kind: TURN_COLLAPSE_KIND,
  target: 'chat',
  match: (event) => {
    const turn = turnFromEvent(event)
    if (turn === undefined) return null
    if (event.type === 'turn/start') return { id: String(turn), role: 'start' }
    if (event.type === 'turn/end' || isPositionEvent(event.type)) {
      return { id: String(turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    const turn = turnFromEvent(match.event)
    if (turn === undefined) throw new Error('codex-turn-collapse start requires data.turn')
    return {
      turn,
      startTime: match.event.time,
      hasWork: false,
    }
  },
  update: (context, match) => {
    if (match.event.type === 'turn/end') {
      return { ...context.state, endTime: match.event.time }
    }
    const next = withFirstWorkSeq(context.state, match.event.seq)
    if (isWorkEvent(match.event.type)) {
      return { ...next, hasWork: true }
    }
    return next
  },
  publication: (match) => {
    if (match.event.type === 'turn/end' || isWorkEvent(match.event.type)) {
      return 'immediate'
    }
    return 'none'
  },
  buildViewNode: (context) => {
    const state = context.state
    if (
      state === undefined
      || !state.hasWork
      || state.firstWorkSeq === undefined
      || context.start === undefined
    ) {
      return null
    }
    return {
      key: context.key,
      kind: TURN_COLLAPSE_KIND,
      id: context.id,
      target: 'chat',
      // Sit immediately before the first think/tool row. `turn/start + 0.5`
      // can land above the user bubble (that event is often later than
      // turn/start). Anchoring on the first tool left the settled
      // assistant-step (思考过程) above the header, because that row uses
      // its message seq, which is earlier than the first tool.
      anchorSeq: state.firstWorkSeq - 0.5,
      location: context.start.location,
      visibility: 'visible',
      data: {
        turn: state.turn,
        closed: state.endTime !== undefined,
        startTime: state.startTime,
        ...state.endTime === undefined ? {} : { endTime: state.endTime },
      },
    }
  },
}
