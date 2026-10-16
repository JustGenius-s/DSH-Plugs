import {
  TERMINAL_OPEN_TIMEOUT_MESSAGE,
  TERMINAL_OPEN_TIMEOUT_MS,
  type TerminalOpenAck,
  type TerminalOpenTicket,
} from '../../shared/terminal-open'

interface QueueEntry {
  ticket: TerminalOpenTicket
  claimed: boolean
  resolve: (ack: TerminalOpenAck) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * In-memory opens waiting for a browser.
 *
 * `claim` hands each ticket out once, so a second poll cannot open another
 * tab for the same address. The tool's promise stays pending until `ack`,
 * `cancel`, or the timeout.
 */
export interface TerminalOpenQueue {
  enqueue(ticket: TerminalOpenTicket): Promise<TerminalOpenAck>
  claim(sessionId: string): TerminalOpenTicket[]
  ack(address: string, result: TerminalOpenAck): boolean
  cancel(address: string, error: Error): void
  dispose(): void
}

export function createTerminalOpenQueue(options?: {
  timeoutMs?: number
}): TerminalOpenQueue {
  const timeoutMs = options?.timeoutMs ?? TERMINAL_OPEN_TIMEOUT_MS
  const entries = new Map<string, QueueEntry>()

  const take = (address: string): QueueEntry | undefined => {
    const entry = entries.get(address)
    if (entry === undefined) return undefined
    clearTimeout(entry.timer)
    entries.delete(address)
    return entry
  }

  return {
    enqueue(input) {
      const ticket = copyTicket(input)
      if (ticket === undefined) {
        return Promise.reject(new Error('terminal open requires an address and a session'))
      }
      if (entries.has(ticket.address)) {
        return Promise.reject(new Error(`terminal ${ticket.address} is already waiting to open`))
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const entry = take(ticket.address)
          entry?.reject(new Error(TERMINAL_OPEN_TIMEOUT_MESSAGE))
        }, timeoutMs)
        entries.set(ticket.address, {
          ticket,
          claimed: false,
          resolve,
          reject,
          timer,
        })
      })
    },

    claim(sessionId) {
      const tickets: TerminalOpenTicket[] = []
      for (const entry of entries.values()) {
        if (entry.claimed || entry.ticket.sessionId !== sessionId) continue
        entry.claimed = true
        tickets.push(entry.ticket)
      }
      return tickets
    },

    ack(address, result) {
      const entry = take(address)
      if (entry === undefined) return false
      if (!result.opened) {
        entry.reject(new Error(result.commandError ?? '浏览器没有打开终端标签'))
        return true
      }
      entry.resolve(result)
      return true
    },

    cancel(address, error) {
      take(address)?.reject(error)
    },

    dispose() {
      for (const address of [...entries.keys()]) {
        take(address)?.reject(new Error('terminal open bridge disposed'))
      }
    },
  }
}

function copyTicket(input: TerminalOpenTicket): TerminalOpenTicket | undefined {
  const address = input.address.trim()
  const sessionId = input.sessionId.trim()
  if (address === '' || sessionId === '') return undefined
  const cwd = input.cwd?.trim()
  const command = input.command?.trim()
  return {
    address,
    sessionId,
    ...(cwd === undefined || cwd === '' ? {} : { cwd }),
    ...(command === undefined || command === '' ? {} : { command }),
  }
}
