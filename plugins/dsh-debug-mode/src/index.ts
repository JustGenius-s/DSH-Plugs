import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import type { Agent } from '@just-genius/dsh-plugin-runtime/host'
import type { Session, SessionEvent } from '@just-genius/dsh-plugin-runtime/host'
import { createUserMessage } from '@just-genius/dsh-plugin-runtime/host'
import { defineTool } from '@just-genius/dsh-plugin-runtime/host'
import { HOST_SERVICES, errorMessage, readJsonBody, sendJson as json } from '@just-genius/dsh-plugin-runtime/host'
import { DEBUG_POLICY } from './policy.ts'
import { sessionEvents } from './session-events.ts'
import {
  appendLogFile,
  archiveLogFile,
  clearLogFile,
  installDebugKit,
  loadLogFile,
  type DebugKit,
} from './kit.ts'
import { collectIngestLines } from './ingest.ts'
import { foldDuplicateLog } from './dedup.ts'
import { parseHypothesisStatus, upsertHypothesis, type DebugHypothesis } from './hypotheses.ts'
import { formatCompareLogs, lastArchivedRun, startRun, type DebugRun } from './runs.ts'
import { resolveIngestSessionId } from './resolve.ts'
import { effectiveDebugOn } from './view.ts'
import { corsHeaders } from './cors.ts'
import { browserIngestUrl, startIngestSidecar } from './ingest-server.ts'
import {
  appendDebugMode,
  foldDebugActive,
  sessionCanPersistDebug,
  type IgnorableAppendSession,
} from './persist.ts'
import {
  CLEAR_PATH,
  COMMAND_PATH,
  DEBUG_BROWSER_LOG,
  DEBUG_KIT_DIR,
  DEBUG_LOG,
  DEBUG_LOG_FILE,
  LOGS_PATH,
  REPRO_PATH,
  STATE_PATH,
  WAIT_FOR_REPRO,
  capLogs,
  mintDebugId,
  type DebugLogEntry,
  type DebugLogSource,
  type DebugReproAction,
  type DebugReproVerdict,
  type DebugReproWait,
  type IngestSink,
} from './shared.ts'
import type { DebugProjection } from './types.ts'

export type { DebugProjection } from './types.ts'
export { CLEAR_PATH, COMMAND_PATH, DEBUG_LOG, LOGS_PATH, REPRO_PATH, STATE_PATH, WAIT_FOR_REPRO } from './shared.ts'

export const name = 'dsh-debug-mode'
export const inject = [
  HOST_SERVICES.agents,
  HOST_SERVICES.tools,
  HOST_SERVICES.systemPrompt,
  HOST_SERVICES.sessions,
  HOST_SERVICES.webServer,
] as const

/**
 * Live debug collaboration state for one session.
 * Mode stance may persist as ignorable `debug/mode` on 0.1.6+.
 * Runs, hypotheses, and the open wait stay process-local.
 */
interface SessionDebugState {
  active: boolean
  /** Target while a turn is open, or retained until the next pre-step commit. */
  wanted: boolean | null
  wait: DebugReproWait | null
  logs: DebugLogEntry[]
  runId: string | null
  runs: DebugRun[]
  hypotheses: DebugHypothesis[]
  /** Workspace kit written on /debug; null when the session has no cwd. */
  kit: DebugKit | null
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
  previousLogs: string
  runId: string
  previousRunId: string
}

const WAIT_DESCRIPTION = 'Debug mode only. Markdown starting with # Reproduction Steps, then a numbered list. '
  + 'Remind the user to restart anything that must load new probes. Do not ask them to type done. '
  + 'Archives the live dock as the previous run (pre-fix stays on disk). Optional runId: pre-fix or post-fix. '
  + 'Call this and stop. After Proceed/fixed, read verdict/notes/logs/previousLogs and continue from evidence.'

const EMPTY_VIEW: DebugProjection = {
  active: false,
  pending: false,
  wait: null,
  logs: [],
  logFile: null,
  runId: null,
  runs: [],
  hypotheses: [],
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
    const session = agent.session
    hydrate(store, session, ingestSink(ctx, sessionId))
    const state = store.get(sessionId)
    if (state === undefined || state.wanted === null) return decision
    const target = state.wanted
    const narration = narrationFor(state, target, ingestSink(ctx, sessionId))
    commitWanted(state, session)
    return narration === undefined
      ? decision
      : { ...decision, messages: [...decision.messages, narration] }
  })

  ctx.systemPrompt.section({
    name: 'debug:policy',
    order: 51,
    text: (context) => {
      if (context.agent === undefined) return ''
      const session = context.agent.session
      const sessionId = String(session.id)
      const state = hydrate(store, session, ingestSink(ctx, sessionId))
      const on = state.wanted ?? loggedActive(session, state)
      return on ? DEBUG_POLICY : ''
    },
  })

  ctx.systemPrompt.section({
    name: 'debug:ingest',
    order: 52,
    text: (context) => {
      if (context.agent === undefined) return ''
      const session = context.agent.session
      const sessionId = String(session.id)
      const sink = ingestSink(ctx, sessionId)
      const state = hydrate(store, session, sink)
      const on = state.wanted ?? loggedActive(session, state)
      return on ? formatIngestBlock(sink, state.kit) : ''
    },
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: COMMAND_PATH,
    handler: (req, res) => handleCommand(ctx, store, waits, req, res),
  }), 'dsh-debug-mode: command route')

  ctx.tools.register(defineTool({
    name: WAIT_FOR_REPRO,
    description: WAIT_DESCRIPTION,
    parameters: {
      steps: {
        type: 'string',
        required: true,
        description: 'The complete reproduction steps, as markdown, starting with a # heading that names them.',
      },
      runId: {
        type: 'string',
        description: 'Optional run bucket. First wait defaults to pre-fix; the next to post-fix.',
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
          previousLogs: { type: 'string', required: true },
          runId: { type: 'string', required: true },
          previousRunId: { type: 'string', required: true },
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
      const steps = toolString(args.steps)
      if (!/^#\s+\S/.test(steps.trim())) {
        throw new Error(`${WAIT_FOR_REPRO} requires markdown steps starting with a # heading`)
      }
      if (disposed) throw new Error('debug mode was reloaded; present the steps again')

      const sessionId = String(agent.session.id)
      const requestedRun = toolString(args.runId).trim()
      beginRun(store, agent.session, requestedRun === '' ? undefined : requestedRun)
      cancelWait(waits, sessionId, new Error('A newer reproduction wait replaced this one.'))
      const wait: DebugReproWait = { id: mintDebugId('repro'), steps, waiting: true }
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
      title: firstHeading(toolString(args.steps)) ?? 'Reproduction Steps',
      kind: 'other',
      content: [{ type: 'text', text: toolString(args.steps) }],
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
    description: 'Register or score a hypothesis, or leave a note. Runtime evidence still goes through ingest. Pass hypothesisId and optional status (open|confirmed|rejected|inconclusive).',
    parameters: {
      message: {
        type: 'string',
        required: true,
        description: 'Hypothesis statement, or a one-line note in the dock.',
      },
      hypothesisId: {
        type: 'string',
        description: 'Stable hypothesis letter or id (A, H-C, …).',
      },
      status: {
        type: 'string',
        description: 'open | confirmed | rejected | inconclusive',
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
      const message = toolString(args.message)
      const hypothesisId = toolString(args.hypothesisId).trim()
      const status = parseHypothesisStatus(args.status)
      if (hypothesisId !== '') {
        const state = ensureState(store, String(agent.session.id))
        state.hypotheses = upsertHypothesis(state.hypotheses, hypothesisId, {
          statement: message,
          status,
        })
      }
      appendLog(store, agent.session, 'agent', message, {
        hypothesisId: hypothesisId === '' ? undefined : hypothesisId,
      })
      return { recorded: true as const }
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Debug log',
      kind: 'other',
      content: [{ type: 'text', text: toolString(args.message) }],
    }),
  }))

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATE_PATH,
    handler: (req, res) => handleState(ctx, store, req, res),
  }), 'dsh-debug-mode: state route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: LOGS_PATH,
    handler: (req, res) => handleLogs(ctx, store, req, res),
  }), 'dsh-debug-mode: logs route')

  ctx.effect(() => {
    const sidecar = startIngestSidecar((req, res) => handleLogs(ctx, store, req, res))
    return () => sidecar.close()
  }, 'dsh-debug-mode: ingest sidecar')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: REPRO_PATH,
    handler: (req, res) => handleRepro(ctx, store, waits, req, res),
  }), 'dsh-debug-mode: repro route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CLEAR_PATH,
    handler: (req, res) => handleClear(ctx, store, req, res),
  }), 'dsh-debug-mode: clear route')
}

function ensureState(store: Map<string, SessionDebugState>, sessionId: string): SessionDebugState {
  const existing = store.get(sessionId)
  if (existing !== undefined) return existing
  const fresh: SessionDebugState = {
    active: false,
    wanted: null,
    wait: null,
    logs: [],
    runId: null,
    runs: [],
    hypotheses: [],
    kit: null,
    toldActive: undefined,
  }
  store.set(sessionId, fresh)
  return fresh
}

function hydrate(
  store: Map<string, SessionDebugState>,
  session: Session,
  sink: IngestSink,
): SessionDebugState {
  const state = ensureState(store, String(session.id))
  if (sessionCanPersistDebug(session) && foldDebugActive(sessionEvents(session))) {
    state.active = true
  }
  if (state.active && state.kit === null) attachKit(store, session, sink)
  return state
}

function loggedActive(session: Session, state: SessionDebugState): boolean {
  if (state.active) return true
  return sessionCanPersistDebug(session) && foldDebugActive(sessionEvents(session))
}

function viewOf(state: SessionDebugState, session?: Session): DebugProjection {
  const logged = session === undefined ? state.active : loggedActive(session, state)
  const active = effectiveDebugOn(state.wanted, logged)
  return {
    active,
    pending: state.wanted !== null && state.wanted !== logged,
    wait: state.wait?.waiting === true ? state.wait : null,
    logs: state.logs,
    logFile: state.kit?.relLogFile ?? null,
    runId: state.runId,
    runs: state.runs.map(run => ({
      id: run.id,
      endedAt: run.endedAt,
      logCount: run.logs.length,
    })),
    hypotheses: state.hypotheses,
  }
}

function isActive(store: Map<string, SessionDebugState>, session: Session): boolean {
  const state = store.get(String(session.id))
  const wanted = state?.wanted
  if (wanted !== null && wanted !== undefined) return wanted
  if (state === undefined) {
    return sessionCanPersistDebug(session) && foldDebugActive(sessionEvents(session))
  }
  return loggedActive(session, state)
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
  sink: IngestSink,
): 'committed' | 'queued' | 'cancelled' | 'noop' {
  const session = agent.session
  const state = hydrate(store, session, sink)
  const logged = loggedActive(session, state)
  const target = state.wanted ?? logged
  if (active === target) return 'noop'
  if (hasOpenTurn(sessionEvents(session))) {
    state.wanted = active
    return logged === active ? 'cancelled' : 'queued'
  }
  if (active === logged) {
    state.wanted = null
    return 'cancelled'
  }
  commitMode(session, state, active)
  if (active) attachKit(store, session, sink)
  const narration = narrationFor(state, active, sink)
  if (narration !== undefined) {
    state.toldActive = active
    agent.inject(narration)
  } else {
    state.toldActive = active
  }
  return 'committed'
}

function runDebugSlash(
  ctx: Context,
  store: Map<string, SessionDebugState>,
  waits: Map<string, LiveWait>,
  agent: Agent,
  rawInput: string,
): { kind: 'success'; text: string } {
  const message = rawInput.trim()
  const sink = ingestSink(ctx, String(agent.session.id))
  if (message === 'off') {
    cancelWait(waits, String(agent.session.id), new Error('The user left debug mode.'))
    closeOpenWait(store, agent.session)
    switch (setDebugMode(store, agent, false, sink)) {
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
  const outcome = setDebugMode(store, agent, true, sink)
  attachKit(store, agent.session, sink)
  if (message !== '') {
    agent.steer(createUserMessage({ content: [{ type: 'text', text: message }], source: { kind: 'user' } }))
  }
  return {
    kind: 'success',
    text: formatDebugOnCommand(outcome, store.get(String(agent.session.id))?.kit ?? null),
  }
}

function commitMode(session: Session, state: SessionDebugState, active: boolean): void {
  if (sessionCanPersistDebug(session)) {
    appendDebugMode(session as unknown as IgnorableAppendSession, active)
  }
  state.active = active
}

function attachKit(
  store: Map<string, SessionDebugState>,
  session: Session,
  sink: IngestSink,
): DebugKit | null {
  const state = ensureState(store, String(session.id))
  const kit = installDebugKit(session, sink)
  state.kit = kit
  if (kit !== null && state.logs.length === 0) {
    state.logs = loadLogFile(kit)
  }
  return kit
}

function commitWanted(state: SessionDebugState, session: Session): void {
  if (state.wanted === null) return
  const logged = loggedActive(session, state)
  if (state.wanted === logged) {
    state.wanted = null
    return
  }
  commitMode(session, state, state.wanted)
  state.wanted = null
  state.toldActive = state.active
}

function narrationFor(state: SessionDebugState, target: boolean, sink: IngestSink) {
  if (target) {
    if (state.toldActive === true) return undefined
    const text = formatDebugOnNotice()
    return createUserMessage({
      content: [{ type: 'text', text }],
      source: {
        kind: 'plugin',
        plugin: 'dsh-debug-mode',
        form: 'notice',
        summary: 'Debug mode on.',
      },
    })
  }
  if (state.toldActive !== true) return undefined
  const text = 'The user switched this session back to the default mode.'
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-debug-mode', form: 'notice', summary: text },
  })
}

function ingestSink(_ctx: Context, sessionId: string): IngestSink {
  return {
    url: browserIngestUrl(),
    sessionId,
  }
}

function formatIngestBlock(sink: IngestSink, kit: DebugKit | null): string {
  const logFile = kit?.relLogFile ?? DEBUG_LOG_FILE
  const fetchLine = `fetch('${sink.url}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:'…',hypothesisId:'A',location:'file.ts:1',data:{},timestamp:Date.now()})}).catch((e)=>console.warn('[dsh-debug]',e))`
  const lines = [
    'Debug logging for this session:',
    `  endpoint: ${sink.url}  (stable sidecar; does not change when Desktop restarts)`,
    '  sessionId: omit when exactly one debug session is live; otherwise pass it.',
    '  Do not POST to the Desktop GUI port (that number moves on every restart).',
    `  logFile: ${logFile} (live). Archived runs: .dsh/debug/debug.<runId>.log`,
    `  Vite / bundled apps: do not import ${DEBUG_BROWSER_LOG}. Paste the inline fetch inside \`// #region agent log\`, then delete the region on cleanup.`,
    `  inline: ${fetchLine}`,
    "  Node JS/TS: import { debugLog } from '<relative>/.dsh/debug/log.mjs'",
    '  Unload probes: node .dsh/debug/unload.mjs <file>…',
    "  Call shape: debugLog('message', { hypothesisId, location, data, runId, edge }). Identical (location, hypothesisId, payload) is dropped unless { edge: false }.",
    '  Flash / first-frame bugs: probe the gate first paint or an immediate watch transition — not fetch in/out, not every computed tick.',
  ]
  if (kit === null) {
    lines.push('Kit missing (no cwd). Last resort: the inline fetch above.')
  }
  return lines.join('\n')
}

function formatDebugOnNotice(): string {
  return 'Debug mode on. Follow the debug policy. Do not acknowledge this notice — start with 3–5 hypotheses, then instrument.'
}

function formatDebugOnCommand(
  outcome: 'committed' | 'queued' | 'cancelled' | 'noop',
  kit: DebugKit | null,
): string {
  const head = outcome === 'committed'
    ? 'Debug mode on (this session only).'
    : outcome === 'queued'
      ? 'Entering debug mode (next step).'
      : 'Debug mode is already on.'
  const kitLine = kit === null ? '' : ` Helper: ${DEBUG_KIT_DIR}/.`
  return `${head}${kitLine} /debug off to leave.`
}

function appendLog(
  store: Map<string, SessionDebugState>,
  session: Session,
  source: DebugLogSource,
  text: string,
  extras: Partial<Pick<DebugLogEntry, 'hypothesisId' | 'location' | 'data' | 'runId'>> = {},
): DebugLogEntry {
  const state = ensureState(store, String(session.id))
  const entry: DebugLogEntry = {
    id: mintDebugId('log'),
    at: Date.now(),
    source,
    text: text.trim(),
    ...extras,
  }
  if (entry.runId === undefined && state.runId !== null) entry.runId = state.runId
  if (entry.hypothesisId !== undefined) {
    state.hypotheses = upsertHypothesis(state.hypotheses, entry.hypothesisId)
  }
  state.logs = capLogs(foldDuplicateLog(state.logs, entry))
  appendLogFile(state.kit, entry)
  return entry
}

function clearLogs(store: Map<string, SessionDebugState>, session: Session): number {
  const state = ensureState(store, String(session.id))
  const cleared = state.logs.length
  state.logs = []
  clearLogFile(state.kit)
  return cleared
}

function beginRun(
  store: Map<string, SessionDebugState>,
  session: Session,
  runId?: string,
): string {
  const state = ensureState(store, String(session.id))
  const previousId = state.runId
  const next = startRun(state, runId)
  if (previousId !== null) archiveLogFile(state.kit, previousId)
  return next
}

function activeDebugSessionIds(
  ctx: Context,
  store: Map<string, SessionDebugState>,
): string[] {
  const ids: string[] = []
  for (const [sessionId] of store) {
    const session = ctx.sessions.get(sessionId as never)
    if (session !== undefined && isActive(store, session)) ids.push(sessionId)
  }
  return ids
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

function toolString(value: unknown): string {
  return typeof value === 'string' ? value : ''
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
  const previous = value.previousLogs.trim() === '' ? '(none)' : value.previousLogs.trim()
  const run = value.runId === '' ? '(none)' : value.runId
  const previousRun = value.previousRunId === '' ? '(none)' : value.previousRunId
  return `verdict: ${value.verdict}\nrun: ${run}\npreviousRun: ${previousRun}\nnotes: ${notes}\nlogs:\n${logs}\npreviousLogs:\n${previous}`
}

function handleState(
  ctx: Context,
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
  const session = ctx.sessions.get(sessionId as never)
  if (session === undefined) {
    const state = store.get(sessionId)
    json(res, 200, { ok: true, value: state === undefined ? EMPTY_VIEW : viewOf(state) })
    return
  }
  const state = hydrate(store, session, ingestSink(ctx, sessionId))
  json(res, 200, { ok: true, value: viewOf(state, session) })
}

function logsJson(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  value: unknown,
): void {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
  json(res, status, value, corsHeaders(origin))
}

async function handleLogs(
  ctx: Context,
  store: Map<string, SessionDebugState>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
  const activeIds = activeDebugSessionIds(ctx, store)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin))
    res.end()
    return
  }
  if (req.method !== 'POST') {
    logsJson(req, res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    logsJson(req, res, 400, { ok: false, message: errorMessage(error) })
    return
  }
  if (body === null || typeof body !== 'object') {
    logsJson(req, res, 400, { ok: false, message: 'invalid body' })
    return
  }
  const value = body as { sessionId?: unknown }
  const requested = typeof value.sessionId === 'string' ? value.sessionId.trim() : ''
  const lines = collectIngestLines(body)
  if (lines.length === 0) {
    logsJson(req, res, 400, { ok: false, message: 'message, text, or lines are required' })
    return
  }
  const resolved = resolveIngestSessionId(requested, activeIds)
  if (!resolved.ok) {
    logsJson(req, res, 409, {
      ok: false,
      message: resolved.reason === 'ambiguous'
        ? 'multiple debug sessions; pass sessionId'
        : 'sessionId is required (no live debug session)',
    })
    return
  }
  const sessionId = resolved.sessionId
  const session = ctx.sessions.get(sessionId as never)
  if (session === undefined) {
    logsJson(req, res, 404, { ok: false, message: 'session not found' })
    return
  }
  hydrate(store, session, ingestSink(ctx, sessionId))
  if (!isActive(store, session)) {
    logsJson(req, res, 409, { ok: false, message: 'debug mode is not active' })
    return
  }
  const entries = lines.map(line => appendLog(store, session, 'ingest', line.text, {
    hypothesisId: line.hypothesisId,
    location: line.location,
    data: line.data,
    runId: line.runId,
  }))
  logsJson(req, res, 200, { ok: true, value: { recorded: entries.length, entries } })
}

async function handleCommand(
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
  const value = body as { sessionId?: unknown; rawInput?: unknown }
  const sessionId = typeof value.sessionId === 'string' ? value.sessionId.trim() : ''
  const rawInput = typeof value.rawInput === 'string' ? value.rawInput : ''
  if (sessionId === '') {
    json(res, 400, { ok: false, message: 'sessionId is required' })
    return
  }
  const agent = ctx.agents.get(sessionId as never)
  if (agent === undefined) {
    json(res, 404, { ok: false, message: 'session not found' })
    return
  }
  json(res, 200, { ok: true, value: runDebugSlash(ctx, store, waits, agent, rawInput).text })
}

async function handleClear(
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
  const sessionId = typeof (body as { sessionId?: unknown }).sessionId === 'string'
    ? (body as { sessionId: string }).sessionId
    : ''
  if (sessionId === '') {
    json(res, 400, { ok: false, message: 'sessionId is required' })
    return
  }
  const session = ctx.sessions.get(sessionId as never)
  if (session === undefined) {
    json(res, 404, { ok: false, message: 'session not found' })
    return
  }
  hydrate(store, session, ingestSink(ctx, sessionId))
  if (!isActive(store, session)) {
    json(res, 409, { ok: false, message: 'debug mode is not active' })
    return
  }
  const cleared = clearLogs(store, session)
  json(res, 200, { ok: true, value: { cleared } })
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
  const compare = formatCompareLogs(state?.logs ?? [], state === undefined ? null : lastArchivedRun(state))
  const result: ReproResult = {
    verdict: action,
    notes,
    logs: compare.logs,
    previousLogs: compare.previousLogs,
    runId: state?.runId ?? '',
    previousRunId: compare.previousRunId,
  }
  live.resolve(result)
  json(res, 200, { ok: true, value: result })
}

function parseReproAction(value: unknown): DebugReproAction | undefined {
  if (value === 'proceed' || value === 'fixed' || value === 'cancel') return value
  return undefined
}
