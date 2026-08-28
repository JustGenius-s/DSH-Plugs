// The browser adapter is the only client-side package boundary that knows the
// concrete DSH module layout. Plugin code consumes this module instead, so a
// future platform package split is handled here once.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

// Keep declaration-merging-only platform modules in the generated .d.ts.
// Plain empty imports are erased by the declaration bundler.
export type {} from '@deepseek-ai/dsh-api-remotes/client'
export type {} from '@deepseek-ai/dsh-client-connection/client'
export type {} from '@deepseek-ai/dsh-client-locale/client'
export type {} from '@deepseek-ai/dsh-client-runtime/client'
export type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
export type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
export type {} from '@deepseek-ai/dsh-client-ui-layout/client'
export type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
export type {} from '@deepseek-ai/dsh-client-ui-settings/client'
export type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
export type {} from '@deepseek-ai/dsh-client-ui-slots'

import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {
  ClientContext,
  ISessions,
  IWorkspaces,
  SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  SessionEvent as CoreSessionEvent,
  SurfaceEvent,
  SurfaceOp,
} from '@deepseek-ai/dsh-session/types'
import type {
  SettingsSchemaService,
  SettingsScopeBinder,
} from '@deepseek-ai/dsh-client-ui-settings/client'

/** Plugin-owned client services bridged into the official Cordis Context. */
export interface PluginClientContext {}

/** Plugin-owned locale namespaces bridged into the official slot registry. */
export interface PluginLocaleNamespaceMap {}

/** Plugin-owned slots bridged into the official slot registry. */
export interface PluginSlotMap {}

/** Plugin-owned conversation node payloads bridged into the chat renderer. */
export interface PluginChatNodeDataMap {}

declare module '@deepseek-ai/cordis' {
  interface Context extends PluginClientContext {}
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap extends PluginLocaleNamespaceMap {}
  interface SlotMap extends PluginSlotMap {}
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap extends PluginChatNodeDataMap {}
}

export type {
  AssistantBlock,
  ClientContext,
  ConversationEventRegistry,
  ConversationNodeDefinition,
  ConversationNode,
  ConversationSnapshot,
  ISessions,
  IWorkspaces,
  PendingInteraction,
  RunningToolCall,
  SessionBinding,
  SessionFace,
  SessionId,
  SessionListState,
  SessionSummary,
  SettingsScope,
  SnapshotStore,
  UseConversationSession,
  WorkspaceId,
} from '@deepseek-ai/dsh-client-runtime/client'

export type {
  ConfigurableProviderView,
  ConnectionHandle,
  CredentialView,
  DiscoveredModelView,
  HistoryEntry,
  IApiClient,
  SessionEvent,
  SettingsNamespaceView,
  SettingsPathOpView,
} from '@deepseek-ai/dsh-client-connection/client'

export type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
export type {
  InputTriggerSource,
  ReferenceInsert,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
export type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
export type {
  InjectFace,
  PropsLocale,
  PropsRuntime,
  SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
export type {
  SchemaNode,
  SettingsDescribeFace,
  SettingsSchemaService,
  SettingsScopeBinder,
} from '@deepseek-ai/dsh-client-ui-settings/client'

const SURFACE_EVENT_TYPES = new Set(['user/message', 'assistant/message', 'tool/result'])

function isSurfaceEvent(event: CoreSessionEvent): event is SurfaceEvent {
  return SURFACE_EVENT_TYPES.has(event.type)
    && 'surfaceOp' in event
    && event.surfaceOp !== undefined
}

/** Latest DSH surface guard, hosted locally because the official client entry is a module-loader bundle. */
export function isAppendSurfaceEvent(
  event: CoreSessionEvent,
): event is SurfaceEvent & { surfaceOp: 'append' } {
  return isSurfaceEvent(event) && event.surfaceOp === 'append'
}

/** Latest DSH replacement guard, hosted locally because the official client entry is not ordinary ESM. */
export function isReplacementSurfaceEvent(
  event: CoreSessionEvent,
): event is SurfaceEvent & { surfaceOp: Extract<SurfaceOp, { op: 'replace' }> } {
  return isSurfaceEvent(event) && event.surfaceOp !== 'append'
}

function cloneDraft<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== 'object') return value
  const cached = seen.get(value)
  if (cached !== undefined) return cached as T
  if (value instanceof Date) return new Date(value.getTime()) as T
  if (value instanceof Map) {
    const next = new Map()
    seen.set(value, next)
    for (const [key, item] of value) next.set(cloneDraft(key, seen), cloneDraft(item, seen))
    return next as T
  }
  if (value instanceof Set) {
    const next = new Set()
    seen.set(value, next)
    for (const item of value) next.add(cloneDraft(item, seen))
    return next as T
  }
  if (Array.isArray(value)) {
    const next: unknown[] = []
    seen.set(value, next)
    for (const item of value) next.push(cloneDraft(item, seen))
    return next as T
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return value
  const next: Record<PropertyKey, unknown> = Object.create(prototype)
  seen.set(value, next)
  for (const key of Reflect.ownKeys(value)) {
    next[key] = cloneDraft((value as Record<PropertyKey, unknown>)[key], seen)
  }
  return next as T
}

/**
 * Create a DSH-compatible observable snapshot store without importing the
 * official module-loader-wrapped client bundle into plugin builds.
 */
export function createSnapshotStore<T>(
  initial: T,
  options?: { flush?: 'raf' | 'sync'; persist?: { name: string } },
): SnapshotStore<T> {
  let state = initial
  const listeners = new Set<() => void>()
  const storageName = options?.persist?.name

  if (storageName !== undefined && typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(storageName)
      if (stored !== null) state = JSON.parse(stored) as T
    } catch (error) {
      console.error(`snapshot store '${storageName}' rehydration failed:`, error)
    }
  }

  let scheduled = false
  const notify = () => {
    if (options?.flush !== 'raf') {
      for (const listener of [...listeners]) listener()
      return
    }
    if (scheduled) return
    scheduled = true
    const schedule = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (callback: FrameRequestCallback) => {
          queueMicrotask(() => callback(performance.now()))
          return 0
        }
    schedule(() => {
      scheduled = false
      for (const listener of [...listeners]) listener()
    })
  }

  const commit = (next: T) => {
    if (Object.is(state, next)) return
    state = next
    if (storageName !== undefined && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(storageName, JSON.stringify(state))
      } catch (error) {
        console.error(`snapshot store '${storageName}' persistence failed:`, error)
      }
    }
    notify()
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(mutator) {
      const draft = cloneDraft(state)
      mutator(draft)
      commit(draft)
    },
    set: commit,
  }
}

/** Canonical browser service names used by plugin inject declarations. */
export const CLIENT_SERVICES = {
  connection: 'connection',
  conversationEvents: 'conversationEvents',
  inputTriggers: 'inputTriggers',
  locale: 'locale',
  modelDirectories: 'modelDirectories',
  remote: 'remote',
  remoteCommands: 'remote.commands',
  remotePluginInventory: 'remote.pluginInventory',
  sessions: 'sessions',
  slots: 'slots',
  settingsScope: 'settingsScope',
  settingsSchema: 'settingsSchema',
  workspaces: 'workspaces',
} as const

export function getConnection(ctx: ClientContext): ConnectionHandle {
  return ctx.get('connection') as ConnectionHandle
}

export function getRemote(ctx: ClientContext): ClientRemote {
  return ctx.remote
}

export function getSessions(ctx: ClientContext): ISessions {
  return ctx.sessions
}

export function getWorkspaces(ctx: ClientContext): IWorkspaces {
  return ctx.workspaces
}

export function getSettingsScope(ctx: ClientContext): SettingsScopeBinder {
  return ctx.settingsScope
}

export function getSettingsSchema(ctx: ClientContext): SettingsSchemaService {
  return ctx.settingsSchema
}

export interface JsonResult<T> {
  ok: boolean
  value?: T
  message?: string
  error?: string
  detail?: string
}

export async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    headers: { accept: 'application/json', ...init.headers },
    ...init,
  })
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error(`request failed (${response.status})`)
  }
  if (!response.ok) {
    const record = body !== null && typeof body === 'object' ? body as JsonResult<unknown> : undefined
    throw new Error(record?.message ?? record?.error ?? record?.detail ?? `request failed (${response.status})`)
  }
  return body as T
}

export function getJson<T>(path: string): Promise<T> {
  return requestJson<T>(path)
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Read the repository's conventional `{ ok, value | message }` envelope. */
export async function requestResult<T>(path: string, init: RequestInit = {}): Promise<T> {
  const result = await requestJson<JsonResult<T>>(path, init)
  if (!result.ok || result.value === undefined) {
    throw new Error(result.message ?? result.error ?? result.detail ?? 'request failed')
  }
  return result.value
}

export function getResult<T>(path: string): Promise<T> {
  return requestResult<T>(path)
}

export function postResult<T>(path: string, body: unknown): Promise<T> {
  return requestResult<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
