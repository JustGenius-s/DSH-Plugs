/**
 * dsh-flow — Host half.
 *
 * Owns the workflow graph, dispatching each step to a child agent, and serves a
 * wire-safe projection to the browser canvas.
 *
 * Flow mode is OFF until the user turns it on with `/flow` or its menu action.
 * While it is off, the Leader contract is not injected and the Flow planning
 * tools reject calls from the Leader.
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
  FLOW_TOOL_NAMES,
  MODE_PATH,
  STATE_PATH,
  clampConcurrency,
  type FlowRequest,
  type FlowStateResponse,
  type HttpResult,
} from './shared.ts'

export const name = 'dsh-flow'
export const inject = [
  HOST_SERVICES.agents,
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

/** Execution allowlist for the Leader; all investigation and implementation belongs to children. */
const LEADER_TOOL_ALLOWLIST = [
  FLOW_TOOL_NAMES.plan,
  FLOW_TOOL_NAMES.status,
  FLOW_TOOL_NAMES.next,
  FLOW_TOOL_NAMES.patch,
  FLOW_TOOL_NAMES.confirm,
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
    readonly localAgent?: { readonly session: { readonly events?: unknown; readonly snapshotEvents?: () => unknown } }
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
      // PTC/code mode exposes only this reserved transport to the model. Its
      // SDK sub-calls retain the Leader agent and run through this guard again.
      if (exec.name === 'run_code') return undefined
      if (LEADER_TOOL_ALLOWLIST.includes(exec.name as never)) return undefined
      return `Flow mode is on: "${exec.name}" is unavailable to the Leader. Express this work as a step in the graph (flow_plan / flow_patch) and let a child agent execute it, or leave Flow mode with \`/flow off\`.`
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
    handler: (req, res) => { void handleAction(ctx, req, res, orchestrator, modes) },
  }), 'dsh-flow: action route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: MODE_PATH,
    handler: (req, res) => { void handleMode(ctx, req, res, modes, orchestrator) },
  }), 'dsh-flow: mode route')

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
  const forwardedNote = forwarded ? '命令后的内容已作为任务发送。' : ''
  switch (outcome) {
    case 'noop':
      return `Flow 模式已开启。${forwardedNote}`
    case 'queued':
      return `正在开启 Flow 模式，将从下一步生效。${forwardedNote}`
    default:
      return turnOpen
        ? `Flow 模式已开启。从下一步开始，主 Agent 负责规划流程，并将各步骤交给子 Agent 执行。${forwardedNote}`
        : `Flow 模式已开启。主 Agent 负责规划流程，子 Agent 负责执行各步骤。主 Agent 的执行工具已禁用，输入 \`/flow off\` 可退出。${forwardedNote}`
  }
}

function formatOff(outcome: string): string {
  switch (outcome) {
    case 'noop':
      return 'Flow 模式已关闭。'
    case 'queued':
      return '正在退出 Flow 模式，将从下一步生效。'
    default:
      return 'Flow 模式已关闭，执行工具已恢复，正在运行的子 Agent 已取消。'
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
  ctx: Context,
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
    respondCommand(ctx, res, modes, orchestrator, sessionId, action.on ? '' : 'off')
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

/** `GET/POST MODE_PATH` — menu, typed command, and chip share mode semantics. */
async function handleMode(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
  modes: FlowModeStore,
  orchestrator: FlowOrchestrator,
): Promise<void> {
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
  const value = (body ?? {}) as { on?: unknown; rawInput?: unknown }
  if (value.rawInput !== undefined) {
    if (typeof value.rawInput !== 'string' || value.on !== undefined) {
      send(res, 400, { ok: false, message: '`rawInput` must be a string and cannot be combined with `on`' })
      return
    }
    respondCommand(ctx, res, modes, orchestrator, sessionId, value.rawInput)
    return
  }
  if (typeof value.on !== 'boolean') {
    send(res, 400, { ok: false, message: '`on` must be a boolean' })
    return
  }
  respondCommand(ctx, res, modes, orchestrator, sessionId, value.on ? '' : 'off')
}

function respondCommand(
  ctx: Context,
  res: ServerResponse,
  modes: FlowModeStore,
  orchestrator: FlowOrchestrator,
  sessionId: string,
  rawInput: string,
): void {
  const agent = ctx.agents.get(sessionId as never)
  if (agent === undefined) {
    send(res, 404, { ok: false, message: 'session not found' })
    return
  }
  const result = handleFlowCommand(agent, rawInput, modes, orchestrator)
  send(res, 200, { ok: true, value: { ok: true, message: result.text } })
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
  if (value.kind === 'retry' || value.kind === 'skip' || value.kind === 'cancel' || value.kind === 'pause' || value.kind === 'resume') {
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
