import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z as zod } from 'zod'
import { DEBUG_POLICY } from './policy.ts'
import {
  DEBUG_LOG,
  LOGS_PATH,
  REPRO_PATH,
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
export { DEBUG_LOG, LOGS_PATH, REPRO_PATH, WAIT_FOR_REPRO } from './shared.ts'

export const name = 'dsh-debug-mode'
export const inject = ['tools', 'systemPrompt', 'sessions', 'webServer'] as const

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'debug/mode': { active: boolean }
    'debug/wait': DebugReproWait
    'debug/log': { logs: DebugLogEntry[] }
  }
}

interface PendingIntent {
  active: boolean
  narrate: boolean
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

const debugProjectionSchema = zod.object({
  active: zod.boolean(),
  pending: zod.boolean(),
  wait: zod.object({
    id: zod.string(),
    steps: zod.string(),
    waiting: zod.boolean(),
  }).nullable(),
  logs: zod.array(zod.object({
    id: zod.string(),
    at: zod.number(),
    source: zod.enum(['agent', 'user', 'ingest']),
    text: zod.string(),
  })),
})

export function apply(ctx: Context): void {
  const pendingIntents = new WeakMap<Session, PendingIntent>()
  const waits = new Map<string, LiveWait>()
  let disposed = false
  // [dsh-debug] distinguish whether debug events are known / writable as ignorable
  ctx.logger.warn('[dsh-debug] plugin apply known=%o appendArity=%s', {
    mode: KNOWN_SESSION_EVENT_TYPES.has('debug/mode'),
    wait: KNOWN_SESSION_EVENT_TYPES.has('debug/wait'),
    log: KNOWN_SESSION_EVENT_TYPES.has('debug/log'),
    knownSize: KNOWN_SESSION_EVENT_TYPES.size,
  }, String(({} as Session).append?.length ?? 'n/a'))

  ctx.effect(() => () => {
    disposed = true
    for (const [sessionId, wait] of waits) {
      waits.delete(sessionId)
      wait.reject(new Error('debug mode was reloaded while waiting for reproduction'))
    }
  }, 'dsh-debug-mode: close lifetime')

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    const pending = pendingIntents.get(agent.session)
    if (decision.kind === 'reject' || signal.aborted || pending === undefined) return decision
    const narration = narrationFor(agent.session, pending.active)
    try {
      commitPending(agent.session, pendingIntents)
    } catch (error) {
      ctx.logger.warn('dsh-debug-mode: failed to append selected debug mode at step start: %o', error)
      return decision
    }
    return !pending.narrate || narration === undefined
      ? decision
      : { ...decision, messages: [...decision.messages, narration] }
  })

  ctx.systemPrompt.section({
    name: 'debug:policy',
    order: 51,
    text: (context) => {
      if (context.agent === undefined) return ''
      const pending = pendingIntents.get(context.agent.session)
      return (pending?.active ?? foldDebugMode(context.agent.session.events)) ? DEBUG_POLICY : ''
    },
  })

  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register({
      key: 'debug',
      schema: debugProjectionSchema,
      init: (): FoldState => ({ active: false, wanted: null, wait: null, logs: [] }),
      apply: (state, event) => applyDebugEvent(state, event),
      view: (state): DebugProjection => ({
        active: state.active,
        pending: state.wanted !== null && state.wanted !== state.active,
        wait: state.wait?.waiting === true ? state.wait : null,
        logs: state.logs,
      }),
      stateVersion: 1,
    })
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
          closeOpenWait(agent.session)
          switch (setDebugMode(agent, false, pendingIntents)) {
            case 'committed':
              return { kind: 'success', text: 'Debug mode off.' }
            case 'queued':
              return { kind: 'success', text: 'Leaving debug mode (applies from the next step).' }
            case 'cancelled':
              return { kind: 'success', text: 'Debug mode entry cancelled.' }
            case 'noop':
              return foldDebugMode(agent.session.events)
                ? { kind: 'success', text: 'Leaving debug mode (applies from the next step).' }
                : { kind: 'success', text: 'Debug mode is already inactive.' }
          }
        }
        const outcome = setDebugMode(agent, true, pendingIntents)
        if (message !== '') {
          agent.steer(createUserMessage({ content: [{ type: 'text', text: message }], source: { kind: 'user' } }))
        }
        return {
          kind: 'success',
          text: outcome === 'committed'
            ? 'Debug mode on. Reproduce the bug, then use /debug off to leave.'
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
      if (!foldDebugMode(agent.session.events)) {
        throw new Error(`${WAIT_FOR_REPRO} is only available in debug mode`)
      }
      if (!/^#\s+\S/.test(args.steps.trim())) {
        throw new Error(`${WAIT_FOR_REPRO} requires markdown steps starting with a # heading`)
      }
      if (disposed) throw new Error('debug mode was reloaded; present the steps again')

      const sessionId = String(agent.session.id)
      cancelWait(waits, sessionId, new Error('A newer reproduction wait replaced this one.'))
      const wait: DebugReproWait = { id: mintDebugId('repro'), steps: args.steps, waiting: true }
      agent.session.append('debug/wait', wait)

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
          closeOpenWait(agent.session)
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
      if (!foldDebugMode(agent.session.events)) {
        throw new Error(`${DEBUG_LOG} is only available in debug mode`)
      }
      appendLog(agent.session, 'agent', args.message)
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
    path: LOGS_PATH,
    handler: (req, res) => handleLogs(ctx, req, res),
  }), 'dsh-debug-mode: logs route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: REPRO_PATH,
    handler: (req, res) => handleRepro(ctx, waits, req, res),
  }), 'dsh-debug-mode: repro route')
}

interface FoldState {
  active: boolean
  wanted: boolean | null
  wait: DebugReproWait | null
  logs: DebugLogEntry[]
}

function applyDebugEvent(state: FoldState, event: SessionEvent): FoldState {
  if (event.type.startsWith('debug/')) {
    // [dsh-debug] H1/H4: inspect persisted debug envelopes during projection fold
    console.warn('[dsh-debug] fold', event.type, 'seq=', event.seq, 'ignorable=', event.ignorable === true, 'known=', KNOWN_SESSION_EVENT_TYPES.has(event.type))
  }
  if (event.type === 'command/run' && event.data.name === 'debug') {
    if (event.data.args === undefined) return state
    const wanted = event.data.args.trim() !== 'off'
    return wanted === state.wanted ? state : { ...state, wanted }
  }
  if (event.type === 'debug/mode') {
    return { ...state, active: event.data.active, wanted: null }
  }
  if (event.type === 'debug/wait') {
    return { ...state, wait: event.data }
  }
  if (event.type === 'debug/log') {
    return { ...state, logs: event.data.logs }
  }
  return state
}

function foldDebugMode(events: readonly SessionEvent[], end = events.length): boolean {
  let active = false
  let index = 0
  for (const event of events) {
    if (index >= end) break
    index++
    if (event.type === 'debug/mode') active = event.data.active
  }
  return active
}

function foldLogs(events: readonly SessionEvent[]): DebugLogEntry[] {
  let logs: DebugLogEntry[] = []
  for (const event of events) {
    if (event.type === 'debug/log') logs = event.data.logs
  }
  return logs
}

function hasOpenTurn(events: readonly SessionEvent[]): boolean {
  let open = false
  for (const event of events) {
    if (event.type === 'turn/start') open = true
    else if (event.type === 'turn/end') open = false
  }
  return open
}

function debugModeAtLastHeader(events: readonly SessionEvent[]): boolean | undefined {
  let lastHeader = -1
  let index = 0
  for (const event of events) {
    if (event.type === 'request/header') lastHeader = index
    index++
  }
  if (lastHeader < 0) return undefined
  return foldDebugMode(events, lastHeader + 1)
}

function setDebugMode(
  agent: Agent,
  active: boolean,
  pendingIntents: WeakMap<Session, PendingIntent>,
): 'committed' | 'queued' | 'cancelled' | 'noop' {
  const session = agent.session
  const pending = pendingIntents.get(session)
  const target = pending?.active ?? foldDebugMode(session.events)
  if (active === target) return 'noop'
  if (hasOpenTurn(session.events)) {
    pendingIntents.set(session, { active, narrate: true })
    return foldDebugMode(session.events) === active ? 'cancelled' : 'queued'
  }
  if (active === foldDebugMode(session.events)) {
    pendingIntents.delete(session)
    return 'cancelled'
  }
  const written = session.append('debug/mode', { active })
  // [dsh-debug] H2: does append persist ignorable on out-of-repo events?
  console.warn('[dsh-debug] append debug/mode seq=', written.seq, 'ignorable=', written.ignorable === true, 'keys=', Object.keys(written))
  pendingIntents.delete(session)
  const narration = narrationFor(session, active)
  if (narration !== undefined) agent.inject(narration)
  return 'committed'
}

function commitPending(session: Session, pendingIntents: WeakMap<Session, PendingIntent>): void {
  const pending = pendingIntents.get(session)
  if (pending === undefined) return
  if (pending.active === foldDebugMode(session.events)) {
    pendingIntents.delete(session)
    return
  }
  const written = session.append('debug/mode', { active: pending.active })
  console.warn('[dsh-debug] append pending debug/mode seq=', written.seq, 'ignorable=', written.ignorable === true)
  pendingIntents.delete(session)
}

function narrationFor(session: Session, target: boolean) {
  const told = debugModeAtLastHeader(session.events)
  if (told === undefined || told === target) return undefined
  const text = target
    ? 'The user switched this session to debug mode.'
    : 'The user switched this session back to the default mode.'
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-debug-mode', form: 'notice', summary: text },
  })
}

function appendLog(session: Session, source: DebugLogSource, text: string): DebugLogEntry {
  const entry: DebugLogEntry = {
    id: mintDebugId('log'),
    at: Date.now(),
    source,
    text: text.trim(),
  }
  const logs = capLogs([...foldLogs(session.events), entry])
  session.append('debug/log', { logs })
  return entry
}

function closeOpenWait(session: Session): void {
  const wait = foldWait(session.events)
  if (wait === null || !wait.waiting) return
  session.append('debug/wait', { ...wait, waiting: false })
}

function foldWait(events: readonly SessionEvent[]): DebugReproWait | null {
  let wait: DebugReproWait | null = null
  for (const event of events) {
    if (event.type === 'debug/wait') wait = event.data
  }
  return wait
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

async function handleLogs(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
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
  if (!foldDebugMode(session.events)) {
    json(res, 409, { ok: false, message: 'debug mode is not active' })
    return
  }
  const entry = appendLog(session, source, text)
  json(res, 200, { ok: true, value: entry })
}

async function handleRepro(
  ctx: Context,
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
  closeOpenWait(session)
  if (action === 'cancel') {
    live.reject(new Error('The user dismissed the reproduction wait to speak instead.'))
    json(res, 200, { ok: true, value: { cancelled: true } })
    return
  }
  const result: ReproResult = {
    verdict: action,
    notes,
    logs: formatLogs(foldLogs(session.events)),
  }
  live.resolve(result)
  json(res, 200, { ok: true, value: result })
}

function parseReproAction(value: unknown): DebugReproAction | undefined {
  if (value === 'proceed' || value === 'fixed' || value === 'cancel') return value
  return undefined
}

function json(res: ServerResponse, status: number, value: DebugHttpResult<unknown> | { ok: false; message: string }): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function readJsonBody(req: IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}
