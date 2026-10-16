import type {
  SidebarRightOpenResourceOptions,
  SidebarRightService,
} from '@just-genius/dsh-plugin-runtime/client'
import {
  TERMINAL_OPEN_ACK_PATH,
  TERMINAL_OPEN_MOUNT_TIMEOUT_MS,
  TERMINAL_OPEN_PATH,
  TERMINAL_OPEN_POLL_MS,
  parseTerminalOpenTicket,
  type TerminalOpenAck,
  type TerminalOpenTicket,
} from '../../../shared/terminal-open'
import type { TerminalControllerStore } from './controller'
import {
  TERMINAL_TAB_KIND,
  terminalResourceControllerId,
} from './contract'

export interface TerminalOpenPoller {
  sessionId(): string | undefined
  open(ticket: TerminalOpenTicket): Promise<TerminalOpenAck>
  fetchImpl?: typeof fetch
  intervalMs?: number
}

/** Sidebar face that can open a terminal in one session. */
export interface TerminalSidebarOpen extends Pick<SidebarRightService, 'openResource'> {
  /** Present on the 0.2 sidebar. Opens in that session instead of whichever is mounted later. */
  openResourceIn?(sessionId: string, address: string, options?: SidebarRightOpenResourceOptions): void
}

/** Place the resource in the ticket's session when the sidebar can address one. */
function placeTerminalResource(sidebar: TerminalSidebarOpen, request: TerminalOpenTicket): void {
  const options: SidebarRightOpenResourceOptions = {
    kind: TERMINAL_TAB_KIND,
    revealIfOpened: true,
    ...(request.cwd === undefined ? {} : { params: { cwd: request.cwd } }),
  }
  if (sidebar.openResourceIn !== undefined) {
    sidebar.openResourceIn(request.sessionId, request.address, options)
    return
  }
  sidebar.openResource(request.address, options)
}

/**
 * Open one agent-requested terminal in the sidebar that is already on screen.
 *
 * The controller key is the resource address minted by the host. `openResource`
 * applies navigation asynchronously, so the new tab id is not readable yet.
 * Waiting for that controller is what proves the tab body mounted.
 */
export async function openAgentTerminal(
  sidebar: TerminalSidebarOpen,
  controllers: Pick<TerminalControllerStore, 'waitFor'>,
  request: TerminalOpenTicket,
  mountTimeoutMs = TERMINAL_OPEN_MOUNT_TIMEOUT_MS,
): Promise<TerminalOpenAck> {
  try {
    placeTerminalResource(sidebar, request)
  } catch (error) {
    return {
      opened: false,
      commandStarted: false,
      commandError: errorText(error),
    }
  }

  const deadline = Date.now() + mountTimeoutMs
  const controllerId = terminalResourceControllerId(request.sessionId, request.address)
  let controller: Awaited<ReturnType<TerminalControllerStore['waitFor']>>
  try {
    controller = await withTimeout(
      controllers.waitFor(controllerId),
      remaining(deadline),
      '终端标签没有出现',
    )
  } catch (error) {
    return {
      opened: false,
      commandStarted: false,
      commandError: errorText(error),
    }
  }

  const command = request.command?.trim() ?? ''
  if (command === '') return { opened: true, commandStarted: false }
  try {
    await withTimeout(
      controller.run(command),
      remaining(deadline),
      '命令没有提交到终端',
    )
    return { opened: true, commandStarted: true }
  } catch (error) {
    return {
      opened: true,
      commandStarted: false,
      commandError: errorText(error),
    }
  }
}

/**
 * Claim this session's pending terminals once and open each new address.
 *
 * Addresses already handed to `open` are skipped, so a replayed claim cannot
 * create a second tab.
 */
export async function consumeTerminalOpens(
  sessionId: string,
  seen: Set<string>,
  open: (ticket: TerminalOpenTicket) => Promise<TerminalOpenAck>,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(
    `${TERMINAL_OPEN_PATH}?sessionId=${encodeURIComponent(sessionId)}`,
    { cache: 'no-store' },
  )
  if (!response.ok) return
  const payload = await response.json() as { opens?: unknown }
  const opens = Array.isArray(payload.opens) ? payload.opens : []
  for (const raw of opens) {
    const ticket = parseTerminalOpenTicket(raw, sessionId)
    if (ticket === undefined || seen.has(ticket.address)) continue
    seen.add(ticket.address)
    const ack = await open(ticket).catch((error: unknown) => ({
      opened: false,
      commandStarted: false,
      commandError: errorText(error),
    }))
    await fetchImpl(TERMINAL_OPEN_ACK_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: ticket.address, ...ack }),
      cache: 'no-store',
    }).catch(() => undefined)
  }
}

/**
 * Poll while the terminal panel is enabled.
 *
 * Stopping this loop is how a closed panel fails the tool: nothing claims the
 * request, so the host wait times out.
 */
export function startTerminalOpenPoller(deps: TerminalOpenPoller): () => void {
  const seen = new Set<string>()
  const fetchImpl = deps.fetchImpl ?? fetch
  const intervalMs = deps.intervalMs ?? TERMINAL_OPEN_POLL_MS
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = async (): Promise<void> => {
    if (stopped) return
    const sessionId = deps.sessionId()
    if (sessionId !== undefined && sessionId !== '') {
      try {
        await consumeTerminalOpens(sessionId, seen, deps.open, fetchImpl)
      } catch {
        // The next tick retries. A failed poll must not stop the loop.
      }
    }
    if (stopped) return
    timer = setTimeout(() => {
      void tick()
    }, intervalMs)
  }

  void tick()
  return () => {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
  }
}

function remaining(deadline: number): number {
  return Math.max(0, deadline - Date.now())
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (timeoutMs <= 0) return Promise.reject(new Error(message))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    task.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(message))
      },
    )
  })
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
