/**
 * Host half of the dsh-codex side-chat feature.
 *
 * A side chat shares the parent's world but not its history: it inherits the
 * parent's cwd (so it shares the parent's sandbox), the parent's agent preset
 * composition, and the parent's last logged model selection, but it never
 * loads the parent's conversation log — the side chat's transcript starts empty
 * and only contains what is asked inside it.
 *
 * What it DOES inherit is the parent's CONTEXT: at creation the host builds a
 * short recall digest of the parent's recent turns and injects it as a
 * model-facing `plugin` context message, so the side agent answers with the
 * main task in mind. That digest is context, not history — the side chat's own
 * log stays a fresh session and nothing is written back to the parent.
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

import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { SessionId, type Session, type SessionEvent } from '@just-genius/dsh-plugin-runtime/host'
import type { CommandInvocation } from '@just-genius/dsh-plugin-runtime/host'
import { resolveSessionPreset } from '@just-genius/dsh-plugin-runtime/host'
import {
  SIDE_CHAT_CLOSE_PATH,
  SIDE_CHAT_LIST_PATH,
  SIDE_CHAT_OPEN_PATH,
  SIDE_COMMAND,
  type SideChatContextState,
  type SideChatSummary,
} from '../../shared/side-chat'
import { buildParentContextMessage } from './context'

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

/** The child's agent options inherited from the parent's last logged model selection. */
function inheritedAgentOptions(
  parent: Session,
): { provider: string; model: string } | undefined {
  const config = parent.requestHeader()?.config
  if (config === undefined) return undefined
  return { provider: config.provider, model: config.model }
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
  const first = session.events.find(
    (event): event is SessionEvent<'user/message'> =>
      event.type === 'user/message'
      && event.data.source.kind === 'user',
  )
  if (first === undefined) return undefined
  const text = (first.data.content ?? [])
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
 * Hand the parent's recent conversation to a freshly created side chat.
 *
 * Injects the digest as NON-WAKING model-facing context (`agent.inject`, which
 * targets the next step boundary without waking the driver), so the side chat's
 * transcript stays blank and no turn opens until the user asks something inside
 * it. It is claimed at the side agent's first pre-step — the same boundary the
 * system prompt is assembled at — so the context is present for the very first
 * request the side agent makes.
 *
 * Best-effort by design: a digest failure must never block opening a side chat,
 * since the parent's context is an enhancement the side chat can work without.
 *
 * @param ctx - host context (agent registry lookup).
 * @param sideSessionId - the side chat that should receive the context.
 * @param parent - the live parent session to summarize.
 * @returns whether the context actually reached the side agent.
 */
function inheritParentContext(
  ctx: Context,
  sideSessionId: SessionId,
  parent: Session,
): SideChatContextState {
  try {
    const title = ctx.get('sessionTitle')?.get(parent)?.title
    const message = buildParentContextMessage(parent, title)
    if (message === undefined) return 'none'
    const agent = ctx.agents.get(sideSessionId)
    if (agent === undefined) return 'none'
    agent.inject(message)
    return 'inherited'
  } catch (error: unknown) {
    ctx.logger.warn(
      `[dsh-codex] side chat "${sideSessionId}" could not inherit parent context: ${String(error)}`,
    )
    return 'none'
  }
}

export function createDshCodexSideChatServer(
  ctx: Context,
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

  /**
   * Create a side chat for a parent session.
   *
   * Reports the context outcome alongside the new id: the injected context only
   * reaches the durable log once the first turn claims it, so the client cannot
   * discover it from the transcript and would otherwise show an empty chat with
   * no sign of what came along.
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
      resolveSessionPreset({ header: parent.header, events: parent.events }),
    )
    const childId = `session-${randomUUID()}` as SessionId
    const handle = await ctx.agents.create({
      sessionId: childId,
      meta: {
        ...(parent.header.cwd === undefined ? {} : { cwd: parent.header.cwd }),
        parentSession: parentSessionId,
        ...(composition.agentPreset === undefined
          ? {}
          : { agentPreset: composition.agentPreset }),
      },
      ...(inheritedAgentOptions(parent) === undefined
        ? {}
        : { agentOptions: inheritedAgentOptions(parent) }),
      setup: composition.setup,
    })

    // Hand the parent's context to the side agent. Built BEFORE the inject and
    // from the parent's own log, then queued as non-waking model-facing
    // context: the side chat's transcript stays blank and no turn opens until
    // the user asks something inside it.
    const context = inheritParentContext(ctx, childId, parent)
    registry.set(childId, {
      parentSessionId,
      createdAt: Date.now(),
      handle,
      context,
    })
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

  // ── /side human command ────────────────────────────────────────────────
  const disposeCommand = ctx.commands.register({
    name: SIDE_COMMAND,
    description: '打开一个继承当前对话上下文的临时侧边对话（不打断主任务）',
    recordInput: false,
    handler: async (invocation: CommandInvocation): Promise<{ kind: 'success'; text: string }> => {
      const parentSessionId = invocation.agent.session.id
      const opened = await openSideChat(parentSessionId)
      return {
        kind: 'success',
        text: opened.context === 'inherited'
          ? `已打开侧边对话（${opened.sideSessionId}），已带上当前对话上下文，可在侧边面板中继续提问。`
          : `已打开侧边对话（${opened.sideSessionId}），当前对话暂无可继承的上下文，可在侧边面板中继续提问。`,
      }
    },
  })

  return {
    dispose() {
      disposeOpen()
      disposeList()
      disposeClose()
      disposeCommand()
      disposeOrphanCleanup()
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
