import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { errorMessage, readJsonBody, sendJson as json } from '@just-genius/dsh-plugin-runtime/host'
import { DEBUG_POLICY } from './policy.ts'
import {
  DEBUG_LOG,
  LOGS_PATH,
  REPRO_PATH,
  STATE_PATH,
  WAIT_FOR_REPRO,
  capLogs,
  mintDebugId,
  type DebugHttpResult,
  type DebugLogEntry,
  type DebugLogSource,
  type DebugReproAction,
  type DebugReproVerdict,
  type DebugReproWait,
} from './shared.ts'
import type { DebugProjection } from './types.ts'

export type { DebugProjection } from './types.ts'
export { DEBUG_LOG, LOGS_PATH, REPRO_PATH, STATE_PATH, WAIT_FOR_REPRO } from './shared.ts'

export const name = 'dsh-debug-mode'
export const inject = ['tools', 'systemPrompt', 'sessions', 'webServer'] as const

/**
 * Live debug collaboration state for one session.
 * Kept in process memory only — writing `debug/*` into the durable session log
 * would poison reload, because those types are outside KNOWN_SESSION_EVENT_TYPES
 * and Session.append cannot mark them `ignorable`.
 */
interface SessionDebugState {
  active: boolean
  /** Target while a turn is open, or retained until the next pre-step commit. */
  wanted: boolean | null
  wait: DebugReproWait | null
  logs: DebugLogEntry[]
  /** Last mode value narrated into the model context for this process lifetime. */
  toldActive: boolean | undefined
}

interface LiveWait {
  id: string
  steps: string
  resolve: (value: ReproResult) => void
  reject: (error: Error) => void
}

interface ReproResult {
  verdict: DebugReproVerdict
  notes: string
  logs: string
}

const WAIT_DESCRIPTION = 'Use only in debug mode. Present numbered reproduction steps and wait until the user presses Proceed or Mark as fixed. '
  + 'Send the COMPLETE steps as markdown, starting with a # heading that names them. '
  + 'After they finish, read verdict/notes/logs in the tool result and continue from that evidence.'

const EMPTY_VIEW: DebugProjection = {
  active: false,
  pending: false,
  wait: null,
  logs: [],
}

export function apply(ctx: Context): void {
  const store = new Map<string, SessionDebugState>()
  const waits = new Map<string, LiveWait>()
  let disposed = false

  ctx.effect(() => () => {
    disposed = true
    for (const [sessionId, wait] of waits) {
      waits.delete(sessionId)
      wait.reject(new Error('debug mode was reloaded while waiting for reproduction'))
    }
    store.clear()
  }, 'dsh-debug-mode: close lifetime')

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const sessionId = String(agent.session.id)
    const state = store.get(sessionId)
    if (state === undefined || state.wanted === null) return decision
    const target = state.wanted
    const narration = narrationFor(state, target)
    commitWanted(state)
    return narration === undefined
      ? decision
      : { ...decision, messages: [...decision.messages, narration] }
  })

  ctx.systemPrompt.section({
    name: 'debug:policy',
    order: 51,
    text: (context) => {
      if (context.agent === undefined) return ''
      const state = store.get(String(context.agent.session.id))
      if (state === undefined) return ''
      const on = state.wanted ?? state.active
      return on ? DEBUG_POLICY : ''
    },
  })

  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'debug',
      description: 'Enter or leave debug mode',
      input: { hint: '[off|message]' },
      handler: ({ agent, rawInput }) => {
        const message = rawInput.trim()
        if (message === 'off') {
          cancelWait(waits, String(agent.session.id), new Error('The user left debug mode.'))
          closeOpenWait(store, agent.session)
          switch (setDebugMode(store, agent, false)) {
            case 'committed':
              return { kind: 'success', text: 'Debug mode off.' }
            case 'queued':
              return { kind: 'success', text: 'Leaving debug mode (applies from the next step).' }
            case 'cancelled':
              return { kind: 'success', text: 'Debug mode entry cancelled.' }
            case 'noop':
              return isActive(store, agent.session)
                ? { kind: 'success', text: 'Leaving debug mode (applies from the next step).' }
                : { kind: 'success', text: 'Debug mode is already inactive.' }
          }
        }
        const outcome = setDebugMode(store, agent, true)
        if (message !== '') {
          agent.steer(createUserMessage({ content: [{ type: 'text', text: message }], source: { kind: 'user' } }))
        }
        return {
          kind: 'success',
          text: outcome === 'committed'
            ? 'Debug mode on for this live session only (not persisted across reload). Reproduce the bug, then use /debug off to leave.'
            : 'Entering debug mode (applies from the next step). Use /debug off to leave.',
        }
      },
    })
  })

  ctx.tools.register(defineTool({
    name: WAIT_FOR_REPRO,
    description: WAIT_DESCRIPTION,
    parameters: {
      steps: {
        type: 'string',
        required: true,
        description: 'The complete reproduction steps, as markdown, starting with a # heading that names them.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          verdict: { type: 'string', required: true },
          notes: { type: 'string', required: true },
          logs: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderReproResult(value as ReproResult) }],
    },
    execute: async (args, exec) => {
      const agent = exec.agent
      if (agent === undefined) throw new Error(`${WAIT_FOR_REPRO} requires a calling agent`)
      if (!isActive(store, agent.session)) {
        throw new Error(`${WAIT_FOR_REPRO} is only available in debug mode`)
      }
      if (!/^#\s+\S/.test(args.steps.trim())) {
        throw new Error(`${WAIT_FOR_REPRO} requires markdown steps starting with a # heading`)
      }
      if (disposed) throw new Error('debug mode was reloaded; present the steps again')

      const sessionId = String(agent.session.id)
      cancelWait(waits, sessionId, new Error('A newer reproduction wait replaced this one.'))
      const wait: DebugReproWait = { id: mintDebugId('repro'), steps: args.steps, waiting: true }
      ensureState(store, sessionId).wait = wait

      return await new Promise<ReproResult>((resolve, reject) => {
        const live: LiveWait = {
          id: wait.id,
          steps: wait.steps,
          resolve: (value) => {
            waits.delete(sessionId)
            resolve(value)
          },
          reject: (error) => {
            waits.delete(sessionId)
            reject(error)
          },
        }
        waits.set(sessionId, live)
        const onAbort = () => {
          if (waits.get(sessionId) !== live) return
          closeOpenWait(store, agent.session)
          live.reject(new Error('The reproduction wait was cancelled.'))
        }
        if (exec.signal.aborted) {
          onAbort()
          return
        }
        exec.signal.addEventListener('abort', onAbort, { once: true })
      })
    },
    presentCall: args => ({
      card: 'generic',
      title: firstHeading(args.steps) ?? 'Reproduction Steps',
      kind: 'other',
      content: [{ type: 'text', text: args.steps }],
    }),
    presentResult: (_args, result) => ({
      card: 'generic',
      title: 'Reproduction',
      content: result.content,
    }),
    isConcurrencySafe: () => false,
  }))

  ctx.tools.register(defineTool({
    name: DEBUG_LOG,
    description: 'Append one line to the Debug Logs dock. Use for hypothesis notes or captured runtime evidence the user should see.',
    parameters: {
      message: {
        type: 'string',
        required: true,
        description: 'One log line to show in the Debug Logs dock.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          recorded: { type: 'boolean', const: true, required: true },
        },
      },
      render: args => [{ type: 'text', text: String(args.message) }],
    },
    execute: async (args, exec) => {
      const agent = exec.agent
      if (agent === undefined) throw new Error(`${DEBUG_LOG} requires a calling agent`)
      if (!isActive(store, agent.session)) {
        throw new Error(`${DEBUG_LOG} is only available in debug mode`)
      }
      appendLog(store, agent.session, 'agent', args.message)
      return { recorded: true as const }
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Debug log',
      kind: 'other',
      content: [{ type: 'text', text: args.message }],
    }),
  }))

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATE_PATH,
    handler: (req, res) => handleState(store, req, res),
  }), 'dsh-debug-mode: state route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: LOGS_PATH,
    handler: (req, res) => handleLogs(ctx, store, req, res),
  }), 'dsh-debug-mode: logs route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: REPRO_PATH,
    handler: (req, res) => handleRepro(ctx, store, waits, req, res),
  }), 'dsh-debug-mode: repro route')
}

function ensureState(store: Map<string, SessionDebugState>, sessionId: string): SessionDebugState {
  const existing = store.get(sessionId)
  if (existing !== undefined) return existing
  const fresh: SessionDebugState = {
    active: false,
    wanted: null,
    wait: null,
    logs: [],
    toldActive: undefined,
  }
  store.set(sessionId, fresh)
  return fresh
}

function viewState(state: SessionDebugState | undefined): DebugProjection {
  if (state === undefined) return EMPTY_VIEW
  return {
    active: state.active,
    pending: state.wanted !== null && state.wanted !== state.active,
    wait: state.wait?.waiting === true ? state.wait : null,
    logs: state.logs,
  }
}

function isActive(store: Map<string, SessionDebugState>, session: Session): boolean {
  const state = store.get(String(session.id))
  if (state === undefined) return false
  return state.wanted ?? state.active
}

function hasOpenTurn(events: readonly SessionEvent[]): boolean {
  let open = false
  for (const event of events) {
    if (event.type === 'turn/start') open = true
    else if (event.type === 'turn/end') open = false
  }
  return open
}

function setDebugMode(
  store: Map<string, SessionDebugState>,
  agent: Agent,
  active: boolean,
): 'committed' | 'queued' | 'cancelled' | 'noop' {
  const session = agent.session
  const state = ensureState(store, String(session.id))
  const target = state.wanted ?? state.active
  if (active === target) return 'noop'
  if (hasOpenTurn(session.events)) {
    state.wanted = active
    return state.active === active ? 'cancelled' : 'queued'
  }
  if (active === state.active) {
    state.wanted = null
    return 'cancelled'
  }
  state.active = active
  state.wanted = null
  const narration = narrationFor(state, active)
  if (narration !== undefined) {
    state.toldActive = active
    agent.inject(narration)
  } else {
    state.toldActive = active
  }
  return 'committed'
}

function commitWanted(state: SessionDebugState): void {
  if (state.wanted === null) return
  if (state.wanted === state.active) {
    state.wanted = null
    return
  }
  state.active = state.wanted
  state.wanted = null
  state.toldActive = state.active
}

function narrationFor(state: SessionDebugState, target: boolean) {
  if (state.toldActive === undefined || state.toldActive === target) return undefined
  const text = target
    ? 'The user switched this session to debug mode.'
    : 'The user switched this session back to the default mode.'
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-debug-mode', form: 'notice', summary: text },
  })
}

function appendLog(
  store: Map<string, SessionDebugState>,
  session: Session,
  source: DebugLogSource,
  text: string,
): DebugLogEntry {
  const state = ensureState(store, String(session.id))
  const entry: DebugLogEntry = {
    id: mintDebugId('log'),
    at: Date.now(),
    source,
    text: text.trim(),
  }
  state.logs = capLogs([...state.logs, entry])
  return entry
}

function closeOpenWait(store: Map<string, SessionDebugState>, session: Session): void {
  const state = store.get(String(session.id))
  if (state === undefined || state.wait === null || !state.wait.waiting) return
  state.wait = { ...state.wait, waiting: false }
}

function cancelWait(waits: Map<string, LiveWait>, sessionId: string, error: Error): void {
  const wait = waits.get(sessionId)
  if (wait === undefined) return
  wait.reject(error)
}

function firstHeading(text: string): string | undefined {
  for (const line of text.split('\n')) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line)
    if (match) return match[1]
  }
  return undefined
}

function renderReproResult(value: ReproResult): string {
  const notes = value.notes.trim() === '' ? '(none)' : value.notes.trim()
  const logs = value.logs.trim() === '' ? '(no log entries)' : value.logs.trim()
  return `verdict: ${value.verdict}\nnotes: ${notes}\nlogs:\n${logs}`
}

function formatLogs(logs: readonly DebugLogEntry[]): string {
  if (logs.length === 0) return ''
  return logs.map((entry) => {
    const time = new Date(entry.at).toISOString()
    return `[${time}] [${entry.source}] ${entry.text}`
  }).join('\n')
}

function handleState(
  store: Map<string, SessionDebugState>,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (req.method !== 'GET') {
    json(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  const url = new URL(req.url ?? '', 'http://dsh.local')
  const sessionId = url.searchParams.get('sessionId')?.trim() ?? ''
  if (sessionId === '') {
    json(res, 400, { ok: false, message: 'sessionId is required' })
    return
  }
  json(res, 200, { ok: true, value: viewState(store.get(sessionId)) })
}

async function handleLogs(
  ctx: Context,
  store: Map<string, SessionDebugState>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    json(res, 400, { ok: false, message: errorMessage(error) })
    return
  }
  if (body === null || typeof body !== 'object') {
    json(res, 400, { ok: false, message: 'invalid body' })
    return
  }
  const value = body as { sessionId?: unknown; text?: unknown; source?: unknown }
  const sessionId = typeof value.sessionId === 'string' ? value.sessionId : ''
  const text = typeof value.text === 'string' ? value.text.trim() : ''
  const source = value.source === 'ingest' || value.source === 'agent' ? value.source : 'user'
  if (sessionId === '' || text === '') {
    json(res, 400, { ok: false, message: 'sessionId and text are required' })
    return
  }
  const session = ctx.sessions.get(sessionId as never)
  if (session === undefined) {
    json(res, 404, { ok: false, message: 'session not found' })
    return
  }
  if (!isActive(store, session)) {
    json(res, 409, { ok: false, message: 'debug mode is not active' })
    return
  }
  const entry = appendLog(store, session, source, text)
  json(res, 200, { ok: true, value: entry })
}

async function handleRepro(
  ctx: Context,
  store: Map<string, SessionDebugState>,
  waits: Map<string, LiveWait>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    json(res, 400, { ok: false, message: errorMessage(error) })
    return
  }
  if (body === null || typeof body !== 'object') {
    json(res, 400, { ok: false, message: 'invalid body' })
    return
  }
  const value = body as { sessionId?: unknown; action?: unknown; notes?: unknown }
  const sessionId = typeof value.sessionId === 'string' ? value.sessionId : ''
  const action = parseReproAction(value.action)
  const notes = typeof value.notes === 'string' ? value.notes : ''
  if (sessionId === '' || action === undefined) {
    json(res, 400, { ok: false, message: 'sessionId and a proceed/fixed/cancel action are required' })
    return
  }
  const session = ctx.sessions.get(sessionId as never)
  if (session === undefined) {
    json(res, 404, { ok: false, message: 'session not found' })
    return
  }
  const live = waits.get(sessionId)
  if (live === undefined) {
    json(res, 409, { ok: false, message: 'no live reproduction wait' })
    return
  }
  closeOpenWait(store, session)
  if (action === 'cancel') {
    live.reject(new Error('The user dismissed the reproduction wait to speak instead.'))
    json(res, 200, { ok: true, value: { cancelled: true } })
    return
  }
  const state = store.get(sessionId)
  const result: ReproResult = {
    verdict: action,
    notes,
    logs: formatLogs(state?.logs ?? []),
  }
  live.resolve(result)
  json(res, 200, { ok: true, value: result })
}

function parseReproAction(value: unknown): DebugReproAction | undefined {
  if (value === 'proceed' || value === 'fixed' || value === 'cancel') return value
  return undefined
}
