/**
 * dsh-flow — Host half.
 *
 * Owns the workflow graph, dispatching each step to a child agent, and serves a
 * wire-safe projection to the browser canvas.
 *
 * Flow mode is OFF until the user turns it on with `/flow` (or the canvas
 * toggle). While it is off, the `flow.*` tools stay invisible and the Leader
 * contract is not injected — the plugin costs the model nothing.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { HOST_SERVICES, createUserMessage, errorMessage, readJsonBody, sendJson } from '@just-genius/dsh-plugin-runtime/host'
import type { Agent } from '@just-genius/dsh-plugin-runtime/host'

import { FlowOrchestrator } from './orchestrator.ts'
import { commitFlowMode, createFlowModeStore, sessionIdOf, setFlowMode, type FlowModeStore } from './mode.ts'
import { IDLE_HINT, LEADER_POLICY } from './policy.ts'
import { createFlowTools } from './tools.ts'
import {
  ACTION_PATH,
  FLOW_COMMAND,
  MODE_PATH,
  STATE_PATH,
  clampConcurrency,
  type FlowRequest,
  type FlowStateResponse,
  type HttpResult,
} from './shared.ts'

export const name = 'dsh-flow'
export const inject = [
  HOST_SERVICES.systemPrompt,
  HOST_SERVICES.tools,
  HOST_SERVICES.webServer,
] as const

/**
 * Where the Leader section sits in the assembled prompt.
 *
 * The repository's shared boundary pins an older `@deepseek-ai/dsh-system-prompt`
 * whose service does not expose `getSectionOrder`, so the band is a literal.
 * 30 places it after the deployment persona and before tool guidance.
 */
const LEADER_SECTION_ORDER = 30

/**
 * Tools the Leader may still call while Flow mode is on.
 *
 * Everything else — notably `edit`, `write`, `bash` — disappears from the
 * model's visible tool set, which is what makes "the Leader only plans" a
 * structural guarantee rather than a request. Read-only tools stay because a
 * Leader that can read the codebase plans better; the point is to remove the
 * ability to *do* the work, not to blind it.
 */
const LEADER_TOOL_ALLOWLIST = [
  'flow.plan',
  'flow.status',
  'flow.next',
  'flow.expand',
  'flow.confirm',
  'flow.report',
  'flow.patch',
  'flow.clear',
  'read',
  'glob',
  'grep',
  'read_image',
  'web_search',
  'web_fetch',
  'skill',
  'todo_write',
  'ask_user_question',
] as const

/** The subagent seam, narrowed to the two calls this plugin makes. */
interface SubagentService {
  start(provider: string, request: {
    readonly label?: string
    readonly prompt: readonly { readonly type: 'text'; readonly text: string }[]
    readonly parent: Agent
    readonly signal: AbortSignal
    readonly toolFilter?: { readonly allow?: readonly string[]; readonly deny?: readonly string[] }
    readonly persona?: string
  }): Promise<{
    readonly id: string
    readonly result: Promise<{
      readonly stopReason: string
      readonly output: readonly { readonly type: string; readonly text?: string }[]
      readonly diagnostic?: string
    }>
    dispose(): Promise<void>
  }>
}

export function apply(ctx: Context): void {
  // Read the subagent service once, tolerantly: without it the plugin still
  // mounts and the Flow tab explains why it cannot dispatch.
  const subagents = ctx.get('subagents') as SubagentService | undefined
  const orchestrator = new FlowOrchestrator(ctx, subagents)
  const modes = createFlowModeStore()

  if (subagents === undefined) {
    ctx.logger('dsh-flow').warn('subagent service unavailable; plans will validate but never dispatch')
  }

  ctx.effect(() => {
    const tools = createFlowTools({
      orchestrator,
      parentOf: (exec) => exec.agent,
      isEnabled: (sessionId) => modes.isOn(sessionId),
    })
    const disposers = tools.map((tool) => ctx.tools.register(tool))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-flow: model tools')

  // The Leader contract is injected for EVERY session but renders empty unless
  // this session's mode is on. Registering unconditionally and gating on state
  // (rather than registering per-session) keeps the section ordered relative to
  // the deployment persona, and makes the mode toggle take effect immediately.
  ctx.effect(
    () => ctx.systemPrompt.section({
      name: 'dsh-flow:leader',
      order: LEADER_SECTION_ORDER,
      text: (context) => {
        const agent = (context as { agent?: Agent }).agent
        if (agent === undefined) return ''
        if (!modes.isOn(sessionIdOf(agent))) return ''
        return orchestrator.view() === null ? `${LEADER_POLICY}\n\n${IDLE_HINT}` : LEADER_POLICY
      },
    }),
    'dsh-flow: leader section',
  )

  // While Flow mode is on, remove the Leader's ability to execute. Registered
  // unconditionally and enforced per-session through a guard, because a
  // scoped `tools.restrict` would have to be re-applied on every toggle.
  ctx.effect(
    () => ctx.tools.guard((exec) => {
      const agent = exec.agent
      if (agent === undefined) return undefined
      if (!modes.isOn(sessionIdOf(agent))) return undefined
      if (LEADER_TOOL_ALLOWLIST.includes(exec.name as never)) return undefined
      return `Flow mode is on: "${exec.name}" is unavailable to the Leader. Express this work as a step in the graph (flow.plan / flow.patch) and let a child agent execute it, or leave Flow mode with \`/flow off\`.`
    }),
    'dsh-flow: leader tool guard',
  )

  // A mid-turn mode switch cannot rewrite the prompt already sent to the model,
  // so it is staged and committed here — the last point where a fresh assembly
  // can still happen. The listener only observes; the decision stays with the
  // rest of the waterfall.
  ctx.effect(
    () => ctx.on('agent/pre-step', (payload, next) => {
      commitFlowMode(modes, sessionIdOf(payload.agent))
      return next()
    }),
    'dsh-flow: commit mode at pre-step',
  )

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATE_PATH,
    handler: (req, res) => { void handleState(req, res, orchestrator, modes) },
  }), 'dsh-flow: state route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ACTION_PATH,
    handler: (req, res) => { void handleAction(req, res, orchestrator, modes) },
  }), 'dsh-flow: action route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: MODE_PATH,
    handler: (req, res) => { void handleMode(req, res, modes) },
  }), 'dsh-flow: mode route')

  ctx.inject([HOST_SERVICES.commands], (commandCtx) => {
    ctx.effect(() => commandCtx.commands.register({
      name: FLOW_COMMAND,
      description: 'Enter or leave Flow mode (Leader plans, child agents execute)',
      input: { hint: '[off|message]' },
      handler: ({ agent, rawInput }) => handleFlowCommand(agent, rawInput, modes, orchestrator),
    }), 'dsh-flow: command')
  })

  ctx.effect(() => () => {
    orchestrator.shutdown()
    modes.clear()
  }, 'dsh-flow: shutdown')
}

/** `/flow [off|message]` — the explicit switch the user asked for. */
function handleFlowCommand(
  agent: Agent,
  rawInput: string,
  modes: FlowModeStore,
  orchestrator: FlowOrchestrator,
): { kind: 'success'; text: string } {
  const sessionId = sessionIdOf(agent)
  const message = rawInput.trim()
  const turnOpen = agent.status === 'running'
  const outcome = setFlowMode(modes, sessionId, message !== 'off', turnOpen)

  if (message === 'off') {
    // Leaving the mode abandons the plan: a Leader that can no longer act on
    // child results would leave children running with nobody steering them.
    if (orchestrator.view() !== null) orchestrator.applyAction({ kind: 'clear' })
    return { kind: 'success', text: formatOff(outcome) }
  }

  // Slash commands consume the whole line. Without this, `/flow 修这个 bug`
  // only toggles the mode and the task never reaches the model — which looks
  // like "I sent /flow and nothing happened".
  if (message !== '') {
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: message }],
      source: { kind: 'user' },
    }))
  }

  return { kind: 'success', text: formatOn(outcome, turnOpen, message !== '') }
}

function formatOn(outcome: string, turnOpen: boolean, forwarded: boolean): string {
  const forwardedNote = forwarded ? ' The rest of the line was forwarded as the task.' : ''
  switch (outcome) {
    case 'noop':
      return `Flow mode is already on.${forwardedNote}`
    case 'queued':
      return `Entering Flow mode (applies from the next step).${forwardedNote}`
    default:
      return turnOpen
        ? `Flow mode on. From the next step I will plan work as a graph and delegate each step to a child agent.${forwardedNote}`
        : [
            'Flow mode on. I am now the Leader: I plan work as a dependency graph and',
            'delegate each step to a child agent. Execution tools are unavailable to me',
            'while this mode is on — use `/flow off` to leave.',
          ].join(' ') + forwardedNote
  }
}

function formatOff(outcome: string): string {
  switch (outcome) {
    case 'noop':
      return 'Flow mode is already off.'
    case 'queued':
      return 'Leaving Flow mode (applies from the next step).'
    default:
      return 'Flow mode off. Execution tools restored; any running child agents were cancelled.'
  }
}

async function handleState(
  req: IncomingMessage,
  res: ServerResponse,
  orchestrator: FlowOrchestrator,
  modes: FlowModeStore,
): Promise<void> {
  if (req.method !== 'GET') {
    send(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  const sessionId = sessionOf(req)
  if (sessionId === null) {
    send(res, 400, { ok: false, message: 'sessionId is required' })
    return
  }
  const state = modes.get(sessionId)
  const body: FlowStateResponse = {
    plan: orchestrator.view(),
    mode: modes.isOn(sessionId),
    modePending: state?.wanted ?? null,
    degraded: orchestrator.degradedReason !== null,
    degradedReason: orchestrator.degradedReason,
  }
  send(res, 200, { ok: true, value: body })
}

async function handleAction(
  req: IncomingMessage,
  res: ServerResponse,
  orchestrator: FlowOrchestrator,
  modes: FlowModeStore,
): Promise<void> {
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  const sessionId = sessionOf(req)
  if (sessionId === null) {
    send(res, 400, { ok: false, message: 'sessionId is required' })
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    send(res, 400, { ok: false, message: errorMessage(error) })
    return
  }
  const action = parseRequest(body)
  if (action === null) {
    send(res, 400, { ok: false, message: 'invalid action' })
    return
  }
  if (action.kind === 'setMode') {
    const outcome = setFlowMode(modes, sessionId, action.on, false)
    if (!action.on && orchestrator.view() !== null) orchestrator.applyAction({ kind: 'clear' })
    send(res, 200, { ok: true, value: { ok: true, message: outcome } })
    return
  }
  if (action.kind === 'setConcurrency') {
    orchestrator.setConcurrency(clampConcurrency(action.concurrency))
    send(res, 200, { ok: true, value: { ok: true, message: null } })
    return
  }
  const result = orchestrator.applyAction(action)
  send(res, 200, { ok: true, value: result })
}

/** `GET/POST MODE_PATH` — lets the canvas toggle Flow mode without the command. */
async function handleMode(req: IncomingMessage, res: ServerResponse, modes: FlowModeStore): Promise<void> {
  const sessionId = sessionOf(req)
  if (sessionId === null) {
    send(res, 400, { ok: false, message: 'sessionId is required' })
    return
  }
  if (req.method === 'GET') {
    const state = modes.get(sessionId)
    send(res, 200, {
      ok: true,
      value: { mode: modes.isOn(sessionId), pending: state?.wanted ?? null },
    })
    return
  }
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, message: 'method not allowed' })
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    send(res, 400, { ok: false, message: errorMessage(error) })
    return
  }
  const value = (body ?? {}) as { on?: unknown }
  if (typeof value.on !== 'boolean') {
    send(res, 400, { ok: false, message: '`on` must be a boolean' })
    return
  }
  const outcome = setFlowMode(modes, sessionId, value.on, false)
  send(res, 200, { ok: true, value: { ok: true, message: outcome } })
}

type ParsedRequest = FlowRequest | { kind: 'setConcurrency'; concurrency: number }

function parseRequest(body: unknown): ParsedRequest | null {
  if (body === null || typeof body !== 'object') return null
  const value = body as Record<string, unknown>
  if (value.kind === 'setMode' && typeof value.on === 'boolean') {
    return { kind: 'setMode', on: value.on }
  }
  if (value.kind === 'setConcurrency' && typeof value.concurrency === 'number') {
    return { kind: 'setConcurrency', concurrency: value.concurrency }
  }
  if (value.kind === 'next') {
    return { kind: 'next' }
  }
  const nodeId = value.nodeId
  if (typeof nodeId !== 'string' || nodeId === '') return null
  if (value.kind === 'retry' || value.kind === 'skip' || value.kind === 'cancel') {
    return { kind: value.kind, nodeId }
  }
  return null
}

function sessionOf(req: IncomingMessage): string | null {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const value = url.searchParams.get('sessionId')
  return value === null || value === '' ? null : value
}

function send(res: ServerResponse, status: number, value: HttpResult<unknown>): void {
  sendJson(res, status, value)
}
