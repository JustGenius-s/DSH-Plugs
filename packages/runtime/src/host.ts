import type { IncomingMessage, ServerResponse } from 'node:http'
export { repairProfileScopeIdentity, repairWebProfileScopeIdentity } from './profile-singletons.ts'

// Host service declaration merging is deliberately loaded here. Plugins only
// import this adapter, while their Context type still carries every service
// installed by the official host packages.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-llm'

// DSH 0.1.7 requires producers to declare their own message-source kind.
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-codex': { kind: 'dsh-codex' }
    'dsh-cua-pip': { kind: 'dsh-cua-pip' }
    'dsh-debug-mode': { kind: 'dsh-debug-mode' }
    'dsh-flow': { kind: 'dsh-flow' }
  }
}
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'

// Preserve service declaration merging in the public host declaration file.
export type {} from '@deepseek-ai/cordis-plugin-loader'
export type {} from '@deepseek-ai/dsh-agent'
export type {} from '@deepseek-ai/dsh-agent-default-model'
export type {} from '@deepseek-ai/dsh-agent-preset-registry'
export type {} from '@deepseek-ai/dsh-commands'
export type {} from '@deepseek-ai/dsh-client-connection'
export type {} from '@deepseek-ai/dsh-credentials'
export type {} from '@deepseek-ai/dsh-fs'
export type {} from '@deepseek-ai/dsh-host-webserver'
export type {} from '@deepseek-ai/dsh-jobs'
export type {} from '@deepseek-ai/dsh-llm'
export type {} from '@deepseek-ai/dsh-session'
export type {} from '@deepseek-ai/dsh-session-persistence'
export type {} from '@deepseek-ai/dsh-session-title'
export type {} from '@deepseek-ai/dsh-settings'
export type {} from '@deepseek-ai/dsh-storage-domain'
export type {} from '@deepseek-ai/dsh-subprocess'
export type {} from '@deepseek-ai/dsh-system-prompt'
export type {} from '@deepseek-ai/dsh-tools'
export type {} from '@deepseek-ai/dsh-workspace'

export { symbols } from '@deepseek-ai/cordis'
export type { Context } from '@deepseek-ai/cordis'
export type { Entry } from '@deepseek-ai/cordis-plugin-loader'
export { default as Schema } from '@deepseek-ai/schemastery'
export type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
/**
 * Preset resolution that survives a session with no readable log.
 *
 * Upstream's `resolveSessionPreset` indexes `session.events.length` directly,
 * and a Session whose `events` getter has not resolved yet reads undefined —
 * which threw
 *   TypeError: Cannot read properties of undefined (reading 'length')
 * from inside dsh-agent-presets and failed the whole side-chat open request,
 * with no handler able to describe it. The local re-export keeps the same
 * contract but treats a missing log as "header value only" (see
 * session-preset.ts) instead of crashing.
 */
export { resolveSessionPreset } from './session-preset.ts'
export type { PresetBearingSession } from './session-preset.ts'
export { sessionEventsOf } from './session-events.ts'
export type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
export { credentialRef } from '@deepseek-ai/dsh-credentials'
export { fallbackSessionTitle } from '@deepseek-ai/dsh-session-title'
export { createUserMessage } from '@deepseek-ai/dsh-llm'
export { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
export type { ReasoningEffortId as ReasoningEffortIdType } from '@deepseek-ai/dsh-llm'
export { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
export type { StreamChunk } from '@deepseek-ai/dsh-llm'
export type { JobRegistry } from '@deepseek-ai/dsh-jobs'
export { SessionId } from '@deepseek-ai/dsh-session'
export type { Session, SessionEvent, SessionHeader, UserMessage } from '@deepseek-ai/dsh-session'
/**
 * Context handed to every `systemPrompt` provider at assembly time.
 *
 * Declaration-merged by the agent layer (`agent`), so prompt providers read
 * the running agent's session through it.
 */
export type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
export { installSettingsSection, settingsNamespace } from './settings-section.ts'
export { readVolatileConfig } from './volatile-config.ts'
export type { SettingsProvider } from './settings-section.ts'
export { defineDomain } from '@deepseek-ai/dsh-storage-domain'
export type { Domain } from '@deepseek-ai/dsh-storage-domain'
export type {
  SubprocessTerminalHandle,
  SubprocessTerminalSignal,
} from '@deepseek-ai/dsh-subprocess'
export { defineTool } from '@deepseek-ai/dsh-tools'

/** Canonical host service names used by plugin inject declarations. */
export const HOST_SERVICES = {
  agents: 'agents',
  agentDefaultModel: 'agentDefaultModel',
  agentPresets: 'agentPresets',
  commands: 'commands',
  connection: 'connection',
  credentials: 'credentials',
  fs: 'fs',
  jobs: 'jobs',
  llm: 'llm',
  loader: 'loader',
  pluginProfile: 'pluginProfile',
  sessionTitle: 'sessionTitle',
  sessions: 'sessions',
  sessionPersistence: 'sessionPersistence',
  settings: 'settings',
  storageDomain: 'storageDomain',
  subprocess: 'subprocess',
  systemPrompt: 'systemPrompt',
  tools: 'tools',
  webServer: 'webServer',
  workspaceRegistry: 'workspaceRegistry',
} as const

export class HttpInputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

export function sendJson(
  res: ServerResponse,
  status: number,
  value: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(JSON.stringify(value))
}

/**
 * Read and parse a JSON request body, refusing anything past `limit`.
 *
 * The body is always drained to the end, even after the limit is exceeded.
 * Breaking out of `IncomingMessage`'s async iterator early destroys the
 * socket: the unread remainder stays in the receive buffer, so the next
 * response written on that keep-alive connection is read by the client as a
 * truncated reply. Node's own parser then aborts the connection with
 * `ERR_CONNECTION_RESET`, which surfaces in the browser as a failed fetch for
 * a completely unrelated request that happened to share the socket. Past the
 * limit the accumulated chunks are dropped (`chunks.length = 0`) so the memory
 * admitted by a rejected body stays bounded.
 */
export async function readJsonBody(req: IncomingMessage, limit = 256 * 1024): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size <= limit) chunks.push(bytes)
    else chunks.length = 0
  }
  if (size > limit) throw new HttpInputError('body too large', 413)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpInputError('invalid json')
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
