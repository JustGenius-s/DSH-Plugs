import type { AgentMcpServerConfig } from './types.ts'
import { hasUnresolvedPlaceholders } from './substitute.ts'

export interface McpToolDescriptor {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface McpHttpClientOptions {
  server: AgentMcpServerConfig
  headers?: Record<string, string>
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export class McpHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
    readonly wwwAuthenticate?: string | null,
  ) {
    super(message)
    this.name = 'McpHttpError'
  }
}

/**
 * Minimal streamable-HTTP MCP client: initialize → tools/list → tools/call.
 * Enough for hosted HTTP MCP servers (Supabase / CloudBase).
 */
export class McpHttpClient {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly headers: Record<string, string>
  private readonly url: string
  private sessionId: string | null = null
  private nextId = 1
  private initialized = false

  constructor(options: McpHttpClientOptions) {
    if (hasUnresolvedPlaceholders(options.server.url)) {
      throw new McpHttpError(`MCP url still has unresolved placeholders: ${options.server.url}`)
    }
    this.url = options.server.url
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 60_000
    this.headers = {
      ...(options.server.headers ?? {}),
      ...(options.headers ?? {}),
    }
  }

  async connect(): Promise<void> {
    await this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'dsh-agent-plugin', version: '0.1.0' },
    })
    await this.notify('notifications/initialized', {})
    this.initialized = true
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    this.requireInitialized()
    const result = await this.rpc<{ tools?: McpToolDescriptor[] }>('tools/list', {})
    return Array.isArray(result.tools) ? result.tools : []
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.requireInitialized()
    return await this.rpc('tools/call', { name, arguments: args })
  }

  async close(): Promise<void> {
    this.sessionId = null
    this.initialized = false
  }

  private requireInitialized(): void {
    if (!this.initialized) throw new McpHttpError('MCP client is not connected')
  }

  private async notify(method: string, params: Record<string, unknown>): Promise<void> {
    try {
      await this.post({ jsonrpc: '2.0', method, params })
    } catch {
      // Notifications are best-effort on some servers.
    }
  }

  private async rpc<T = unknown>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    const id = this.nextId++
    const body = await this.post({ jsonrpc: '2.0', id, method, params })
    if (body === null || typeof body !== 'object') {
      throw new McpHttpError(`MCP ${method} returned a non-object body`)
    }
    const row = body as { result?: T; error?: { message?: string } }
    if (row.error) {
      throw new McpHttpError(row.error.message ?? `MCP ${method} failed`)
    }
    return row.result as T
  }

  private async post(payload: unknown): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...this.headers,
      }
      if (this.sessionId) headers['mcp-session-id'] = this.sessionId

      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      const sessionHeader = response.headers.get('mcp-session-id')
      if (sessionHeader) this.sessionId = sessionHeader

      const text = await response.text()
      if (!response.ok) {
        throw new McpHttpError(
          `MCP HTTP ${response.status}: ${text.slice(0, 400)}`,
          response.status,
          text,
          response.headers.get('www-authenticate'),
        )
      }
      if (text.trim() === '') return {}
      return parseMcpResponseBody(text)
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Parse JSON or SSE-wrapped JSON-RPC MCP responses. */
export function parseMcpResponseBody(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as unknown
  }
  let last: unknown = {}
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (data === '' || data === '[DONE]') continue
    last = JSON.parse(data) as unknown
  }
  return last
}
