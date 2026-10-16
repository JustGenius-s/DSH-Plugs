/**
 * Agent-opened terminal tabs.
 *
 * The host tool mints a resource address and waits. The browser terminal
 * feature claims that request and calls `sidebarRight.openResource`. A tab
 * cannot be created from the host process alone.
 */

export const OPEN_TERMINAL_TOOL = 'open_terminal'

export const TERMINAL_OPEN_PATH = '/dsh-codex/terminal/open'
export const TERMINAL_OPEN_ACK_PATH = '/dsh-codex/terminal/open/ack'

/** How long the tool waits for the browser to confirm the tab. */
export const TERMINAL_OPEN_TIMEOUT_MS = 12_000

/**
 * Budget for the browser to mount the tab and, when asked, submit the first
 * command. Shorter than {@link TERMINAL_OPEN_TIMEOUT_MS} so the ack lands
 * before the host gives up.
 */
export const TERMINAL_OPEN_MOUNT_TIMEOUT_MS = 9_000

/** How often an open page asks the host for terminals it should create. */
export const TERMINAL_OPEN_POLL_MS = 400

export const TERMINAL_OPEN_TIMEOUT_MESSAGE =
  '打开终端超时：浏览器没有确认这个标签（终端面板可能已关闭，或当前会话没有打开的页面）。'

export const TERMINAL_RESOURCE_PREFIX = 'dsh-resource://dsh-codex-terminal/'

/** One terminal the browser still has to open. */
export interface TerminalOpenTicket {
  address: string
  sessionId: string
  cwd?: string
  command?: string
}

/** What the browser reports after it has tried to open the tab. */
export interface TerminalOpenAck {
  opened: boolean
  commandStarted: boolean
  commandError?: string
}

/** Canonical tool result once the tab exists. */
export interface OpenTerminalResult {
  address: string
  cwd: string
  commandStarted: boolean
  commandError?: string
}

/** Give every terminal a resource identity so it is not deduplicated as a page. */
export function terminalResourceAddress(instanceId: string): string {
  return `${TERMINAL_RESOURCE_PREFIX}${encodeURIComponent(instanceId)}`
}

/** Mint a fresh terminal resource address. Pass `instanceId` to keep tests stable. */
export function createTerminalResourceAddress(instanceId?: string): string {
  const id = instanceId !== undefined && instanceId !== ''
    ? instanceId
    : newTerminalInstanceId()
  return terminalResourceAddress(id)
}

export function isTerminalResourceAddress(address: string): boolean {
  return address.startsWith(TERMINAL_RESOURCE_PREFIX)
    && address.length > TERMINAL_RESOURCE_PREFIX.length
}

/** Keep a claimed ticket only when it is one this session is allowed to open. */
export function parseTerminalOpenTicket(
  value: unknown,
  sessionId: string,
): TerminalOpenTicket | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as {
    address?: unknown
    sessionId?: unknown
    cwd?: unknown
    command?: unknown
  }
  if (typeof raw.address !== 'string' || !isTerminalResourceAddress(raw.address)) return undefined
  if (raw.sessionId !== sessionId) return undefined
  const ticket: TerminalOpenTicket = { address: raw.address, sessionId }
  if (typeof raw.cwd === 'string' && raw.cwd.trim() !== '') ticket.cwd = raw.cwd
  if (typeof raw.command === 'string' && raw.command.trim() !== '') ticket.command = raw.command
  return ticket
}

/** Parse the browser's confirmation, or undefined when the body is unusable. */
export function parseTerminalOpenAck(
  value: unknown,
): { address: string; ack: TerminalOpenAck } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as {
    address?: unknown
    opened?: unknown
    commandStarted?: unknown
    commandError?: unknown
  }
  if (typeof raw.address !== 'string' || !isTerminalResourceAddress(raw.address)) return undefined
  if (typeof raw.opened !== 'boolean' || typeof raw.commandStarted !== 'boolean') return undefined
  const commandError = typeof raw.commandError === 'string' && raw.commandError.trim() !== ''
    ? raw.commandError
    : undefined
  return {
    address: raw.address,
    ack: {
      opened: raw.opened,
      commandStarted: raw.opened && raw.commandStarted,
      ...(commandError === undefined ? {} : { commandError }),
    },
  }
}

function newTerminalInstanceId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi !== undefined && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
