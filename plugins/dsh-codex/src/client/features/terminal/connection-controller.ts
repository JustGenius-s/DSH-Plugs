import type { TerminalShell } from '../../../shared/config'
import type { ClientMessage, ServerMessage } from '../../../shared/terminal-protocol'

export type TerminalConnectionState = 'connecting' | 'ready' | 'reconnecting' | 'disconnected'

export interface TerminalConnectionCallbacks {
  onMessage(message: ServerMessage): void
  onState(state: TerminalConnectionState): void
  onMalformedMessage(error: unknown): void
}

interface ConnectionConfig {
  sessionId: string
  cwd: string | undefined
  shell: TerminalShell
}

interface Gate {
  promise: Promise<void>
  resolve(): void
  reject(reason: unknown): void
}

/** Owns the socket, reconnect policy and controller-run readiness gates. */
export class TerminalConnectionController {
  private socket: WebSocket | null = null
  private config: ConnectionConfig | null = null
  private sessionToken = newSessionToken()
  private retryCount = 0
  private retryTimer = 0
  private exited = false
  private stopped = true
  private readyGate = createGate()
  private contextGate = createGate()

  constructor(private readonly callbacks: TerminalConnectionCallbacks) {}

  connect(config: ConnectionConfig): void {
    this.stopSocket()
    this.config = config
    this.sessionToken = newSessionToken()
    this.retryCount = 0
    this.exited = false
    this.stopped = false
    this.open('connecting')
  }

  updateShell(shell: TerminalShell): void {
    if (this.config !== null) this.config = { ...this.config, shell }
  }

  send(message: ClientMessage): boolean {
    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(message))
    return true
  }

  isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  async waitUntilOperational(): Promise<void> {
    const socket = this.socket
    if (socket === null || socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
      throw new Error('warp-terminal socket is not open')
    }
    await Promise.all([this.readyGate.promise, this.contextGate.promise])
    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('warp-terminal socket is not open')
    }
  }

  /** Retry a detached PTY immediately, preserving its reconnect token. */
  retryNow(): void {
    if (this.config === null) return
    window.clearTimeout(this.retryTimer)
    this.retryCount = 0
    this.exited = false
    this.stopped = false
    this.stopSocket()
    this.open('connecting')
  }

  /** Start a fresh PTY after the previous shell exited. */
  restart(): void {
    this.sessionToken = newSessionToken()
    this.retryNow()
  }

  dispose(): void {
    this.stopped = true
    window.clearTimeout(this.retryTimer)
    this.rejectGates(new Error('warp-terminal view connection closed'))
    this.stopSocket()
    this.config = null
  }

  private open(state: TerminalConnectionState): void {
    const config = this.config
    if (config === null || this.stopped) return
    this.resetGates()
    this.callbacks.onState(state)
    const socket = new WebSocket(buildWsUrl(config.cwd, config.shell, this.sessionToken))
    this.socket = socket
    socket.onmessage = event => {
      if (this.socket !== socket || this.stopped) return
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage
        if (message.type === 'ready') {
          this.retryCount = 0
          this.readyGate.resolve()
          this.callbacks.onState('ready')
        } else if (message.type === 'context') {
          this.contextGate.resolve()
        } else if (message.type === 'exit') {
          this.exited = true
          this.callbacks.onState('disconnected')
        }
        this.callbacks.onMessage(message)
      } catch (error) {
        this.callbacks.onMalformedMessage(error)
      }
    }
    socket.onclose = () => {
      if (this.socket !== socket || this.stopped) return
      this.socket = null
      this.rejectGates(new Error('warp-terminal connection closed'))
      if (this.exited) {
        this.callbacks.onState('disconnected')
        return
      }
      this.callbacks.onState('reconnecting')
      const delay = Math.min(500 * Math.pow(2, this.retryCount), 8000)
      this.retryCount += 1
      this.retryTimer = window.setTimeout(() => this.open('reconnecting'), delay)
    }
    socket.onerror = () => socket.close()
  }

  private stopSocket(): void {
    const socket = this.socket
    this.socket = null
    if (socket === null) return
    socket.onmessage = null
    socket.onclose = null
    socket.onerror = null
    socket.close()
  }

  private resetGates(): void {
    this.rejectGates(new Error('warp-terminal connection replaced'))
    this.readyGate = createGate()
    this.contextGate = createGate()
  }

  private rejectGates(reason: Error): void {
    this.readyGate.reject(reason)
    this.contextGate.reject(reason)
  }
}

function buildWsUrl(cwd: string | undefined, shell: TerminalShell, sessionToken: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const query = new URLSearchParams()
  if (cwd) query.set('cwd', cwd)
  if (shell !== 'auto') query.set('shell', shell)
  query.set('session', sessionToken)
  query.set('rows', '30')
  query.set('cols', '100')
  return `${protocol}//${window.location.host}/dsh-codex/terminal/ws?${query.toString()}`
}

function newSessionToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

function createGate(): Gate {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  void promise.catch(() => {})
  return { promise, resolve, reject }
}
