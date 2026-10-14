/**
 * Host half of the dsh-codex side-chat feature.
 *
 * A side chat shares the parent's world but not its history: it inherits the
 * parent's cwd (so it shares the parent's sandbox), the parent's agent preset
 * composition, and the parent's last logged model selection, but it never
 * loads the parent's conversation log — the side chat's transcript starts empty
 * and only contains what is asked inside it.
 *
 * At creation it receives only a link to the parent and an agent-scoped tool
 * for reading the parent's latest conversation on demand. Parent task details
 * never compete with the side chat's first user prompt.
 * It is an ordinary live agent under the parent's workspace — NOT the active
 * conversation — so the main task keeps running uninterrupted while the side
 * chat answers in its own session.
 *
 * The host keeps an in-process registry (sideSessionId -> parent) and exposes
 * the lifecycle over `/dsh-codex/side-chat/*` routes plus the `/side` slash
 * command. Message posting is the stock `session.prompt` path, so this feature
 * adds no message transport of its own.
 *
 * Security note: the routes are served through the same webServer as /api and
 * must be reachable only from the trusted web client. They are thin — they
 * take a sessionId and delegate to existing host services; no new capability
 * beyond forking sessions a caller could already fork.
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { SessionId, type Session, type SessionEvent } from '@just-genius/dsh-plugin-runtime/host'
import type { CommandInvocation, CommandResult } from '@just-genius/dsh-plugin-runtime/host'
import { ReasoningEffortId, resolveSessionPreset, sessionEventsOf } from '@just-genius/dsh-plugin-runtime/host'
import {
  SIDE_CHAT_CLOSE_PATH,
  SIDE_CHAT_DEBUG_PATH,
  SIDE_CHAT_LIST_PATH,
  SIDE_CHAT_OPEN_PATH,
  SIDE_CHAT_REFERENCES_PATH,
  SIDE_COMMAND,
  SIDE_CHAT_DISABLED_REASON,
  type SideChatContextState,
  type SideChatDisabled,
  type SideChatSummary,
} from '../../shared/side-chat'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../../shared/config'
import { buildParentLinkMessage } from './context'
import { createSideChatParentTool } from './parent-tool'
import { workspaceReferenceCandidates, type ReferenceResolver, type ReferenceSessionList } from './references'
import {
  inheritedModelSelection,
  initializeSideChatModel,
  type SideChatModelSession,
} from './model-selection'

/** Structured failure for the /side-chat routes. */
class SideChatError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SideChatError'
  }
}

/**
 * Poll `read` until it yields a value or the budget runs out.
 *
 * Pure and injectable so it is testable without a Host context: the caller
 * supplies the read, and may supply the sleep.
 */
export async function pollForValue<T>(
  read: () => T | undefined,
  options: {
    timeoutMs: number
    intervalMs: number
    sleep?: (ms: number) => Promise<void>
  },
): Promise<T | undefined> {
  const sleep = options.sleep
    ?? ((ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms) }))
  const deadline = Date.now() + options.timeoutMs
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() >= deadline) return undefined
    await sleep(options.intervalMs)
  }
}

/**
 * How long `open` waits for its parent session before giving up.
 *
 * A side chat is forked from the conversation the user is looking at, but the
 * panel can mount before that session has entered the Host's store — a page
 * reload, a session switch, or a cold restore all race the fork. The client
 * already polls for its own side session to appear (see `waitForListed`);
 * the Host must do the same for the parent instead of failing the very first
 * attempt with 404.
 */
const PARENT_WAIT_TIMEOUT_MS = 5_000
const PARENT_POLL_INTERVAL_MS = 100

export interface DshCodexSideChatServer {
  dispose(): void
}

/** Maximum length of a derived side-chat title (approximate, CJK-aware). */
export const SIDE_CHAT_TITLE_MAX = 24

/**
 * Derive a short display title for a side chat from its OWN first user
 * message — DSH's title system deliberately skips sessions with a parent, so
 * side chats carry no title; this is a deterministic, recomputable label.
 *
 * The side session never loads the parent's history (blank start), so the
 * first user message is always the question actually asked IN the side chat.
 */
export function sideChatTitleOf(session: Session): string | undefined {
  // A freshly forked side session has no event log yet — `session.events` is
  // undefined until the host materializes it. Reading `.find` there threw
  // "Cannot read properties of undefined", which failed the whole LIST route,
  // so the panel could not enumerate its side chats at all.
  const events = sessionEventsOf(session) as readonly SessionEvent[]
  if (!Array.isArray(events)) return undefined
  const first = events.find(
    (event): event is SessionEvent<'user/message'> =>
      event.type === 'user/message'
      && event.data?.source?.kind === 'user',
  )
  if (first === undefined) return undefined
  const text = (first.data?.content ?? [])
    .filter((block): block is { type: 'text'; text: string } =>
      typeof block === 'object' && block !== null
      && (block as { type?: unknown }).type === 'text')
    .map(block => (block as { text: string }).text)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (text.length === 0) return undefined
  if (text.length <= SIDE_CHAT_TITLE_MAX) return text
  return `${text.slice(0, SIDE_CHAT_TITLE_MAX)}…`
}

/**
 * Compose the child agent under the parent's preset, mirroring host fork behavior.
 *
 * Exported so the stale-preset fallback is testable without a Host: both the
 * preset registry and the logger arrive through `ctx`.
 */
export async function composeAgentFor(
  ctx: Context,
  presetId: string | undefined,
): Promise<{ agentPreset?: string; setup: (agentCtx: Context) => Promise<void> }> {
  const presets = ctx.get('agentPresets')
  if (presets === undefined || presetId === undefined) {
    return { setup: async () => {} }
  }
  // Best-effort: the parent's preset decides which tools and prompt sections
  // the side agent gets, but a preset that no longer resolves (renamed,
  // deleted, or a root that failed to scan) must not block opening the side
  // chat — a default agent is perfectly usable. `presets.resolve()` THROWS for
  // an unknown id, so this is the only thing standing between a stale preset
  // and a 500, which is exactly how a side chat became impossible to open.
  try {
    const resolvedId = (await presets.resolve(presetId)).id
    return {
      agentPreset: resolvedId,
      setup: async (agentCtx: Context) => {
        await presets.mount(agentCtx, resolvedId)
      },
    }
  } catch (error: unknown) {
    ctx.logger.warn(
      `[dsh-codex] side chat preset "${presetId}" did not resolve, using the default agent: ${String(error)}`,
    )
    return { setup: async () => {} }
  }
}

/**
 * Tell a freshly created side chat which main session it can consult.
 *
 * Injects the link as NON-WAKING model-facing context (`agent.inject`, which
 * targets the next step boundary without waking the driver), so the side chat's
 * transcript stays blank and no turn opens until the user asks something inside
 * it. It is claimed at the side agent's first pre-step — the same boundary the
 * system prompt is assembled at — so the context is present for the very first
 * request the side agent makes.
 *
 * Best-effort by design: an injection failure must never block opening a side chat.
 *
 * @param handle - the handle `agents.create` resolved to. The reference DSH
 *   side-chat plugins inject on THIS handle rather than looking the agent up
 *   in the registry: `create` resolving is not the same moment as the registry
 *   entry becoming visible, and a `agents.get()` on the same tick silently
 *   degraded every side chat to 'none'.
 * @returns whether the link actually reached the side agent.
 */
function linkParentContext(
  ctx: Context,
  handle: { agent?: { inject(message: unknown): void } } | undefined,
  parentSessionId: SessionId,
): SideChatContextState {
  try {
    const agent = handle?.agent
    if (agent === undefined) {
      ctx.logger.warn('[dsh-codex] side chat agent handle missing; main-session link not injected')
      return 'none'
    }
    agent.inject(buildParentLinkMessage(parentSessionId))
    return 'linked'
  } catch (error: unknown) {
    ctx.logger.warn(`[dsh-codex] side chat could not link main session: ${String(error)}`)
    return 'none'
  }
}

/**
 * Whether a new side chat can discover and read its main session.
 *
 * `sideChatContextEnabled` is the user's switch; when it is off the side chat
 * still opens without a parent link or read tool. Reported as `off` so the
 * client can distinguish this setting from a failed link injection.
 */
export function inheritContextOf(config: DshCodexConfig | undefined): boolean {
  return (config ?? DEFAULT_CONFIG).sideChatContextEnabled !== false
}

/** What `/side` says when the feature is switched off in the settings. */
export const SIDE_COMMAND_DISABLED_TEXT = '侧聊已在 Codex 设置中关闭，如需使用请先开启。'

/**
 * What `/side` reports after opening one.
 *
 * The side chat can read its main session on demand, the link failed, or the
 * option is switched off.
 */
export function sideCommandText(
  sideSessionId: string,
  context: SideChatContextState,
): string {
  if (context === 'linked') {
    return `已打开侧边对话（${sideSessionId}），可按需查看主对话，可在侧边面板中提问。`
  }
  if (context === 'inherited') {
    return `已打开侧边对话（${sideSessionId}），已带上当前对话上下文，可在侧边面板中提问。`
  }
  if (context === 'off') {
    return `已打开侧边对话（${sideSessionId}），按设置未关联主对话，可在侧边面板中提问。`
  }
  return `已打开侧边对话（${sideSessionId}），主对话关联不可用，可在侧边面板中提问。`
}

/** The on-disk debug trace file (server-side, so no browser console needed). */
export function sideChatDebugFile(): string {
  return join(tmpdir(), 'dsh-codex-sidechat.log')
}

/**
 * Append one line to the side-chat debug trace.
 *
 * The browser console is not reachable from this GUI, so the render/prompt
 * probes cannot be read there. This sink is the transport instead: the client
 * POSTs its probe payload to `/dsh-codex/side-chat/debug`, and the host appends
 * it — alongside the host's own `session/event` observations — to one local
 * file that can be read after a single send. Never throws: a debug write must
 * not break the feature it observes.
 */
function trace(record: Record<string, unknown>): void {
  try {
    const file = sideChatDebugFile()
    mkdirSync(join(file, '..'), { recursive: true })
    appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), ...record }) + '\n')
  } catch {
    // debug sink is best-effort by design
  }
}

/** A compact summary of one session event for the trace (no full payloads). */
function summarizeEvent(event: SessionEvent): Record<string, unknown> {
  const data = (event as { data?: unknown }).data
  const content = (data as { content?: readonly unknown[] } | undefined)?.content
  const message = (data as { message?: { content?: readonly unknown[] } } | undefined)?.message
  const blocks = content ?? message?.content
  return {
    seq: (event as { seq?: unknown }).seq,
    type: event.type,
    ...(Array.isArray(blocks)
      ? {
          blocks: blocks.map(block =>
            typeof block === 'object' && block !== null
              ? (block as { type?: unknown }).type
              : typeof block,
          ),
        }
      : {}),
  }
}

export function createDshCodexSideChatServer(
  ctx: Context,
  getConfig: () => DshCodexConfig = () => DEFAULT_CONFIG,
): DshCodexSideChatServer {
  // In-process registry: sideSessionId -> owning parent + live handle. The
  // sessions themselves persist through ordinary session persistence; this
  // registry only records the side-chat grouping, so a process restart loses
  // the grouping (the sessions remain reachable as ordinary forks).
  const registry = new Map<SessionId, {
    parentSessionId: SessionId
    createdAt: number
    handle: unknown
    context: SideChatContextState
  }>()

  // Host-side observation of every side chat's event log. The client cannot
  // reach a console, so this is how we see what the side agent actually
  // appended (user message landed? assistant turn started? chunk/message
  // streamed?) — the evidence that decides whether "对话流断掉" is the agent
  // not running or the events never reaching the client.
  const traceEvent = ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (!registry.has(session.id)) return
    trace({ src: 'host-event', sessionId: session.id, ...summarizeEvent(event) })
  })

  /**
   * The one gate every side-chat creation passes through.
   *
   * Both the `/side` command and the panel's REST call funnel into `open` /
   * `openSideChat`, so a single check here closes the whole feature off: with
   * the switch down there is no path that still forks a side agent, and the
   * disabled reason is what the client maps to a translated message.
   *
   * @returns the refusal, or `undefined` when side chat is enabled.
   */
  function disabledReason(): SideChatDisabled | undefined {
    if ((getConfig() ?? DEFAULT_CONFIG).sideChatEnabled === false) {
      return { disabled: true, reason: SIDE_CHAT_DISABLED_REASON }
    }
    return undefined
  }

  /**
   * Create a side chat for a parent session.
   *
   * Reports the context outcome alongside the new id: the injected link only
   * reaches the durable log once the first turn claims it.
   */
  async function openSideChat(
    parentSessionId: SessionId,
  ): Promise<{ sideSessionId: SessionId; context: SideChatContextState }> {
    // The parent is the conversation the user is looking at, but the panel can
    // mount before that session has entered the Host store. Wait a bounded
    // moment for it rather than failing the very first fork with a 404 — the
    // client already polls for its own session the same way.
    const parent = await pollForValue(
      () => ctx.sessions.get(parentSessionId),
      { timeoutMs: PARENT_WAIT_TIMEOUT_MS, intervalMs: PARENT_POLL_INTERVAL_MS },
    )
    if (parent === undefined) {
      throw new SideChatError(
        404,
        `parent session "${parentSessionId}" not found (it may have been closed or archived, or has not opened yet)`,
      )
    }
    const composition = await composeAgentFor(
      ctx,
      // Same defensive read as `sessionEventsOf`: a parent whose log has not
      // materialized would otherwise throw inside preset resolution and fail
      // the fork with an unrelated-looking error.
      resolveSessionPreset({
        header: parent.header,
        events: sessionEventsOf(parent) as readonly SessionEvent[],
      }),
    )
    const childId = `session-${randomUUID()}` as SessionId
    const projections = ctx.get('sessionProjections') as {
      stateOf(session: Session, key: 'modelSelection'): { pending?: unknown } | undefined
    } | undefined
    const selection = inheritedModelSelection(
      parent,
      projections?.stateOf(parent, 'modelSelection')?.pending,
    )
    const linkParent = inheritContextOf(getConfig())
    // A side chat is TEMPORARY, so it is deliberately NOT linked as a fork:
    // `parentSession` is the durable lineage field the workspace tree and the
    // subagent catalog read, and setting it makes the side chat a permanent
    // child of the main conversation. The reference DSH side-chat plugins do
    // the same (`hiddenSideChatMeta` strips `parentSession`).
    //
    // The parent relationship lives in this process's `registry` instead, so
    // it survives for the session's lifetime and vanishes on close — which is
    // exactly the "临时" semantics. The sandbox (cwd) is still inherited, so
    // the side chat reads the same files.
    const handle = await ctx.agents.create({
      sessionId: childId,
      meta: {
        ...(parent.header.cwd === undefined ? {} : { cwd: parent.header.cwd }),
        ...(composition.agentPreset === undefined
          ? {}
          : { agentPreset: composition.agentPreset }),
      },
      ...(selection === undefined
        ? {}
        : { agentOptions: {
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) }),
        } }),
      setup: async (agentCtx, agent) => {
        await composition.setup(agentCtx)
        if (linkParent) {
          agentCtx.tools.register(createSideChatParentTool(ctx, childId, parentSessionId))
        }
        if (selection === undefined) return
        initializeSideChatModel(agent.session as unknown as SideChatModelSession, selection)
      },
    })

    // The link contains no parent turns. History is read only if the side
    // agent calls its scoped tool for a relevant side-chat request.
    const context = linkParent
      ? linkParentContext(ctx, handle, parentSessionId)
      : 'off'
    registry.set(childId, {
      parentSessionId,
      createdAt: Date.now(),
      handle,
      context,
    })
    trace({ src: 'open', sideSessionId: childId, parentSessionId, context })
    return { sideSessionId: childId, context }
  }

  /** List side chats of one parent, newest first. */
  function listSideChats(parentSessionId: SessionId): SideChatSummary[] {
    const rows: SideChatSummary[] = []
    for (const [sideSessionId, record] of registry) {
      if (record.parentSessionId !== parentSessionId) continue
      const agent = ctx.agents.get(sideSessionId)
      const side = ctx.sessions.get(sideSessionId)
      rows.push({
        sideSessionId,
        parentSessionId,
        createdAt: record.createdAt,
        running: agent?.status === 'running',
        title: side === undefined ? '' : (sideChatTitleOf(side) ?? ''),
        context: record.context,
      })
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * Close a side chat: dispose the agent (removes the live session → the GUI
   * drops it via `host/session-removed`) and archive the session so it stays
   * hidden from the workspace tree even though the persisted log remains
   * (DSH has no persisted-log delete; archiving is the native "removed from
   * view" operation the workspace browser honors).
   */
  async function closeSideChat(sideSessionId: SessionId): Promise<void> {
    const record = registry.get(sideSessionId)
    if (record === undefined) {
      throw new SideChatError(404, `side chat "${sideSessionId}" not found`)
    }
    registry.delete(sideSessionId)
    const handle = record.handle as { dispose: () => Promise<void> }
    try {
      await handle.dispose()
    } finally {
      // Best-effort: without the workspace service composed, the live dispose
      // above still removes the session from the GUI.
      const workspaces = ctx.get('workspaceRegistry') as
        | { archiveSession(id: SessionId): Promise<void> }
        | undefined
      if (workspaces !== undefined) {
        await workspaces.archiveSession(sideSessionId).catch((error: unknown) => {
          ctx.logger.warn(
            `[dsh-codex] archive side chat "${sideSessionId}" failed: ${String(error)}`,
          )
        })
      }
    }
  }

  // Orphan cleanup: when a session is disposed, dispose every side chat
  // (transitively) that descends from it. A parent conversation closed or
  // removed must not leave running side agents behind.
  const disposeOrphanCleanup = ctx.on('session/disposed', (session: Session) => {
    void (async () => {
      const doomed: SessionId[] = []
      const seen = new Set<SessionId>([session.id])
      for (let changed = true; changed;) {
        changed = false
        for (const [id, record] of registry) {
          if (!seen.has(record.parentSessionId) || seen.has(id)) continue
          seen.add(id)
          doomed.push(id)
          changed = true
        }
      }
      for (const id of doomed) {
        const record = registry.get(id)
        registry.delete(id)
        if (record === undefined) continue
        try {
          await (record.handle as { dispose: () => Promise<void> }).dispose()
        } catch (error: unknown) {
          ctx.logger.warn(
            `[dsh-codex] orphan side chat "${id}" cleanup failed: ${String(error)}`,
          )
        }
      }
    })()
  })

  // ── /side-chat routes ──────────────────────────────────────────────────
  const disposeOpen = ctx.webServer.register({
    kind: 'exact',
    path: SIDE_CHAT_OPEN_PATH,
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'method not allowed' })
          return
        }
        const body = (await readJsonBody(req)) as { parentSessionId?: unknown }
        const parentSessionId = body?.parentSessionId
        if (typeof parentSessionId !== 'string') {
          throw new SideChatError(400, 'missing string field: parentSessionId')
        }
        const refused = disabledReason()
        if (refused !== undefined) {
          // 409, not 404: the route exists, the feature is switched off. The
          // `reason` field is what the client maps to a translated message, so
          // the panel can say "侧聊已关闭" rather than surfacing an error.
          writeJson(res, 409, refused)
          return
        }
        const opened = await openSideChat(parentSessionId as SessionId)
        writeJson(res, 200, {
          sideSessionId: opened.sideSessionId,
          context: opened.context,
        })
      } catch (error) {
        handleRouteError(ctx, res, error)
      }
    },
  })
  const disposeList = ctx.webServer.register({
    kind: 'exact',
    path: SIDE_CHAT_LIST_PATH,
    handler: async (req, res) => {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          writeJson(res, 405, { error: 'method not allowed' })
          return
        }
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const parentSessionId = url.searchParams.get('parentSessionId')
        if (parentSessionId === null) {
          throw new SideChatError(400, 'missing query param: parentSessionId')
        }
        writeJson(res, 200, {
          sideChats: listSideChats(parentSessionId as SessionId),
        })
      } catch (error) {
        handleRouteError(ctx, res, error)
      }
    },
  })
  const disposeReferences = ctx.webServer.register({
    kind: 'exact',
    path: SIDE_CHAT_REFERENCES_PATH,
    handler: async (req, res) => {
      try {
        if (req.method !== 'GET') {
          writeJson(res, 405, { error: 'method not allowed' })
          return
        }
        const id = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('sideSessionId') as SessionId | null
        const record = id === null ? undefined : registry.get(id)
        if (record === undefined || id === null) throw new SideChatError(404, 'side chat not found')
        const parent = ctx.sessions.get(record.parentSessionId)
        const agent = ctx.agents.get(id)
        if (parent === undefined || agent === undefined) throw new SideChatError(404, 'session not found')
        const resolver = ctx.get('sessionReferenceResolver') as ReferenceResolver | undefined
        if (resolver === undefined) throw new SideChatError(503, '会话引用服务不可用')
        const sessions = ctx.get('sessionController') as ReferenceSessionList | undefined
        if (sessions === undefined) throw new SideChatError(503, '会话活跃记录服务不可用')
        const archivedSessionIds = ctx.get('workspaceRegistry')?.archivedSessionIds ?? []
        writeJson(res, 200, { candidates: await workspaceReferenceCandidates(
          resolver, agent, parent.header.cwd, sessions, Date.now(), archivedSessionIds,
        ) })
      } catch (error) {
        handleRouteError(ctx, res, error)
      }
    },
  })
  const disposeClose = ctx.webServer.register({
    kind: 'exact',
    path: SIDE_CHAT_CLOSE_PATH,
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'method not allowed' })
          return
        }
        const body = (await readJsonBody(req)) as { sideSessionId?: unknown }
        const sideSessionId = body?.sideSessionId
        if (typeof sideSessionId !== 'string') {
          throw new SideChatError(400, 'missing string field: sideSessionId')
        }
        await closeSideChat(sideSessionId as SessionId)
        writeJson(res, 200, { ok: true })
      } catch (error) {
        handleRouteError(ctx, res, error)
      }
    },
  })
  // Client probe sink: the panel POSTs its snapshot/prompt observations here
  // because the browser console is unreachable from this GUI. Best-effort —
  // the write never fails the caller.
  const disposeDebug = ctx.webServer.register({
    kind: 'exact',
    path: SIDE_CHAT_DEBUG_PATH,
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'method not allowed' })
          return
        }
        const body = await readJsonBody(req)
        trace({ src: 'client', ...(typeof body === 'object' && body !== null ? body as Record<string, unknown> : { body }) })
        writeJson(res, 200, { ok: true })
      } catch (error) {
        handleRouteError(ctx, res, error)
      }
    },
  })

  // ── /side human command ────────────────────────────────────────────────
  const disposeCommand = ctx.commands.register({
    name: SIDE_COMMAND,
    description: '打开一个可按需查看当前对话的临时侧边对话（不打断主任务）',
    recordInput: false,
    handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
      // Same gate as the panel's route: the switch is one setting, not two,
      // so `/side` cannot fork a side chat the panel refuses to show.
      if (disabledReason() !== undefined) {
        return { kind: 'error', text: SIDE_COMMAND_DISABLED_TEXT }
      }
      const parentSessionId = invocation.agent.session.id
      const opened = await openSideChat(parentSessionId)
      return {
        kind: 'success',
        text: sideCommandText(opened.sideSessionId, opened.context),
      }
    },
  })

  return {
    dispose() {
      disposeOpen()
      disposeList()
      disposeReferences()
      disposeClose()
      disposeDebug()
      disposeCommand()
      disposeOrphanCleanup()
      traceEvent()
    },
  }
}

/**
 * Report one route failure to the client.
 *
 * The stack goes over the wire deliberately: these routes are the only place a
 * Host-side failure becomes visible, and a bare message cannot say which call
 * in the handler threw. The Host log keeps its own copy.
 */
function handleRouteError(ctx: Context, res: ServerResponse, error: unknown): void {
  const stack = error instanceof Error ? error.stack : undefined
  if (error instanceof SideChatError) {
    writeJson(res, error.status, {
      error: error.message,
      ...(stack === undefined ? {} : { stack }),
    })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  ctx.logger.warn(`[dsh-codex] side-chat route error: ${message}`)
  writeJson(res, 500, {
    error: message,
    ...(stack === undefined ? {} : { stack }),
  })
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(text)
}

function readJsonBody(req: IncomingMessage, limit = 16 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new SideChatError(413, 'request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined)
        return
      }
      const text = Buffer.concat(chunks).toString('utf8')
      try {
        resolve(text === '' ? undefined : JSON.parse(text))
      } catch {
        reject(new SideChatError(400, 'request body is not valid JSON'))
      }
    })
    req.on('error', reject)
  })
}
