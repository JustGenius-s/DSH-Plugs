import type { IncomingMessage, ServerResponse } from 'node:http'

// Host service declaration merging is deliberately loaded here. Plugins only
// import this adapter, while their Context type still carries every service
// installed by the official host packages.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-llm'
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
export type {} from '@deepseek-ai/dsh-commands'
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
export { credentialRef } from '@deepseek-ai/dsh-credentials'
export { createUserMessage } from '@deepseek-ai/dsh-llm'
export type { StreamChunk } from '@deepseek-ai/dsh-llm'
export type { JobRegistry } from '@deepseek-ai/dsh-jobs'
// `SessionId` is both a branded type and its runtime constructor — `export {
// SessionId }` carries both meanings, so it must not be re-listed under a type
// alias here.
export { SessionId } from '@deepseek-ai/dsh-session'
export type {
  Session,
  SessionEvent,
  SessionHeader,
} from '@deepseek-ai/dsh-session'
export { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
export type { SettingsProvider } from '@deepseek-ai/dsh-settings'
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
  commands: 'commands',
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

export async function readJsonBody(req: IncomingMessage, limit = 256 * 1024): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > limit) throw new HttpInputError('body too large', 413)
    chunks.push(bytes)
  }
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
