import { isAbsolute, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import {
  defineTool,
  errorMessage,
  readJsonBody,
  sendJson,
} from '@just-genius/dsh-plugin-runtime/host'
import {
  OPEN_TERMINAL_TOOL,
  TERMINAL_OPEN_ACK_PATH,
  TERMINAL_OPEN_PATH,
  TERMINAL_OPEN_TIMEOUT_MS,
  createTerminalResourceAddress,
  parseTerminalOpenAck,
  type OpenTerminalResult,
  type TerminalOpenAck,
  type TerminalOpenTicket,
} from '../../shared/terminal-open'
import {
  createTerminalOpenQueue,
  type TerminalOpenQueue,
} from './open-queue'

const CANCELLED_MESSAGE = 'open_terminal 已取消'

export interface OpenTerminalToolDeps {
  cwdFor(sessionId: string): string | undefined
  queue: TerminalOpenQueue
  createAddress?: () => string
}

/**
 * Resolve the directory a new terminal should start in.
 *
 * An absolute `requested` path wins. A relative one joins the session
 * directory. With neither, the tab falls back to the session directory the
 * sidebar already knows.
 */
export function resolveTerminalCwd(
  requested: string | undefined,
  sessionCwd: string | undefined,
): string | undefined {
  const trimmed = requested?.trim() ?? ''
  const fallback = sessionCwd?.trim() ?? ''
  if (trimmed === '') return fallback === '' ? undefined : fallback
  if (isAbsolute(trimmed)) return trimmed
  if (fallback === '') {
    throw new Error('open_terminal 的 cwd 在会话没有工作目录时必须是绝对路径')
  }
  return resolve(fallback, trimmed)
}

/** The agent tool. It records an open and waits; it does not create the tab. */
export function createOpenTerminalTool(deps: OpenTerminalToolDeps) {
  const createAddress = deps.createAddress ?? (() => createTerminalResourceAddress())
  return defineTool({
    name: OPEN_TERMINAL_TOOL,
    description: '在右侧栏为当前会话打开一个新的交互式终端标签。cwd 可选，缺省用会话工作目录。command 可选，提交后输出留在该标签里，不会回到这个工具结果。页面没开或终端面板关闭时，等待确认超时并失败。要拿命令输出请用 bash。',
    parameters: {
      cwd: {
        type: 'string',
        description: '终端起始目录。绝对路径，或相对于会话工作目录的路径。缺省用会话工作目录。',
      },
      command: {
        type: 'string',
        description: '标签出现后提交的第一条命令。输出留在终端里。',
      },
    },
    timeoutMs: TERMINAL_OPEN_TIMEOUT_MS + 3_000,
    isConcurrencySafe: () => false,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          address: { type: 'string', required: true },
          cwd: { type: 'string', required: true },
          commandStarted: { type: 'boolean', required: true },
          commandError: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderOpenTerminal(value),
      }],
    },
    presentCall: args => {
      const command = typeof args.command === 'string' ? args.command.trim() : ''
      const cwd = typeof args.cwd === 'string' ? args.cwd.trim() : ''
      return {
        card: 'terminal',
        title: command === '' ? '打开终端' : command,
        description: '输出在右侧终端标签里',
        ...(cwd === '' ? {} : { cwd }),
      }
    },
    execute: async (args, exec) => {
      const sessionId = exec.agent?.session.id
      if (sessionId === undefined || String(sessionId) === '') {
        throw new Error('open_terminal requires a calling agent')
      }
      const id = String(sessionId)
      const cwd = resolveTerminalCwd(args.cwd, deps.cwdFor(id))
      const command = args.command?.trim() ?? ''
      const address = createAddress()
      const ticket: TerminalOpenTicket = {
        address,
        sessionId: id,
        ...(cwd === undefined ? {} : { cwd }),
        ...(command === '' ? {} : { command }),
      }
      const ack = await waitForOpen(deps.queue, ticket, exec.signal)
      const result: OpenTerminalResult = {
        address,
        cwd: cwd ?? '',
        commandStarted: ack.commandStarted,
      }
      if (ack.commandError !== undefined) result.commandError = ack.commandError
      return result
    },
  })
}

export interface TerminalOpenBridge {
  dispose(): void
}

/** Register `open_terminal` and the browser claim/ack routes. */
export function createTerminalOpenBridge(ctx: Context): TerminalOpenBridge {
  const queue = createTerminalOpenQueue()
  const disposeTool = ctx.tools.register(createOpenTerminalTool({
    queue,
    cwdFor: sessionId => sessionCwd(ctx, sessionId),
  }))
  const disposeList = ctx.webServer.register({
    kind: 'exact',
    path: TERMINAL_OPEN_PATH,
    handler: (req, res) => handleTerminalOpenList(req, res, queue),
  })
  const disposeAck = ctx.webServer.register({
    kind: 'exact',
    path: TERMINAL_OPEN_ACK_PATH,
    handler: (req, res) => handleTerminalOpenAck(req, res, queue),
  })
  return {
    dispose() {
      disposeTool()
      disposeList()
      disposeAck()
      queue.dispose()
    },
  }
}

export function handleTerminalOpenList(
  req: IncomingMessage,
  res: ServerResponse,
  queue: TerminalOpenQueue,
): void {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }
  const sessionId = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('sessionId')
  if (sessionId === null || sessionId.trim() === '') {
    sendJson(res, 400, { error: 'missing query param: sessionId' })
    return
  }
  sendJson(res, 200, { opens: queue.claim(sessionId) })
}

export async function handleTerminalOpenAck(
  req: IncomingMessage,
  res: ServerResponse,
  queue: TerminalOpenQueue,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    sendJson(res, 400, { error: errorMessage(error) })
    return
  }
  const parsed = parseTerminalOpenAck(body)
  if (parsed === undefined) {
    sendJson(res, 400, { error: 'invalid terminal open ack' })
    return
  }
  if (!queue.ack(parsed.address, parsed.ack)) {
    sendJson(res, 404, { error: 'terminal open not pending' })
    return
  }
  sendJson(res, 200, { ok: true })
}

function waitForOpen(
  queue: TerminalOpenQueue,
  ticket: TerminalOpenTicket,
  signal: AbortSignal,
): Promise<TerminalOpenAck> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, ack?: TerminalOpenAck): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      if (error !== undefined) reject(error)
      else resolve(ack as TerminalOpenAck)
    }
    const onAbort = (): void => {
      queue.cancel(ticket.address, new Error(CANCELLED_MESSAGE))
      finish(new Error(CANCELLED_MESSAGE))
    }
    if (signal.aborted) {
      finish(new Error(CANCELLED_MESSAGE))
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    queue.enqueue(ticket).then(
      ack => finish(undefined, ack),
      (error: unknown) => finish(error instanceof Error ? error : new Error(String(error))),
    )
  })
}

function sessionCwd(ctx: Context, sessionId: string): string | undefined {
  const session = ctx.sessions.get(sessionId as never) as { header?: { cwd?: string } } | undefined
  const cwd = session?.header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : undefined
}

function renderOpenTerminal(value: OpenTerminalResult): string {
  const where = value.cwd === '' ? '' : `（${value.cwd}）`
  const command = value.commandStarted
    ? '首条命令已提交。'
    : value.commandError
      ? `标签已打开，但命令未提交：${value.commandError}`
      : '标签已打开。'
  return `已打开终端${where} ${value.address}。${command}输出在终端标签里，不在这个结果里。`
}
