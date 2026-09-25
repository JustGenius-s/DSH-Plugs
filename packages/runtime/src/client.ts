// The browser adapter is the only client-side package boundary that knows the
// concrete DSH module layout. Plugin code consumes this module instead, so a
// future platform package split is handled here once.


import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
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
export type {} from '@deepseek-ai/dsh-api-session-controller/client'
export type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
export type {} from '@deepseek-ai/dsh-client-connection/client'
export type {} from '@deepseek-ai/dsh-client-locale/client'
export type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
export type {} from '@deepseek-ai/dsh-client-ui-session/client'
export type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
export type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
export type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
export type {} from '@deepseek-ai/dsh-client-ui-layout/client'
export type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
export type {} from '@deepseek-ai/dsh-client-ui-settings/client'
export type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
export type {} from '@deepseek-ai/dsh-client-ui-slots'

import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm as SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {
  SessionEvent as CoreSessionEvent,
  SurfaceEvent,
  SurfaceOp,
} from '@deepseek-ai/dsh-session/types'
import type { SettingsDescribeFace, SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Compatibility face over 0.1.7's ConfigForms for existing plugin cards. */
export interface SettingsScopeBinder {
  describe(): SettingsDescribeFace
  bind<T>(spec: { namespace: string; decode?: (section: unknown) => T | undefined }): SettingsScope<T>
}

/** Values accepted by the DSH right-Sidebar navigation contract. */
export type SidebarRightNavigationParams = Readonly<Record<string, unknown>> | undefined

/** Where a new right-Sidebar tab should land. */
export interface SidebarRightPlacement {
  paneId?: string
  replaceTab?: string
  revealIfOpened?: boolean
}

/** Options for opening a resource address in the right Sidebar. */
export interface SidebarRightOpenResourceOptions extends SidebarRightPlacement {
  kind?: string
  params?: SidebarRightNavigationParams
}

/** Options for opening a page tab in the right Sidebar. */
export interface SidebarRightOpenTabOptions extends SidebarRightPlacement {
  params?: SidebarRightNavigationParams
}

/** One tab record exposed by the right-Sidebar controller. */
export interface SidebarRightTabRecord {
  id: string
  kind: string
  contentId: string
  title: string
}

/** Public navigation and presentation face provided by DSH 0.1.5+. */
export interface SidebarRightService {
  openResource(address: string, options?: SidebarRightOpenResourceOptions): void
  openTab(kind: string, options?: SidebarRightOpenTabOptions): void
  close(tabId: string): void
  active(): SidebarRightTabRecord | undefined
  isExpanded(): boolean
  toggleExpanded(): void
  focus(tabId: string): void
  split(paneId?: string): string | undefined
  float(tabId: string, rect?: { x: number; y: number; width: number; height: number }): void
  dock(paneId: string): void
}

/** A guide-page capsule contributed by a right-Sidebar tab type. */
export interface SidebarRightGuideEntry {
  order: number
  title: () => string
  /** Kept structural so plugins need not import the official primitives package. */
  icon?: unknown
}

/** Static definition registered before a right-Sidebar tab body. */
export interface SidebarRightTabDefinition {
  id: string
  kind: string
  patterns?: readonly string[]
  priority?: 'extension' | 'builtin' | 'fallback'
  canOpen?: (address: string) => boolean
  title: (address: string) => string
  guide?: readonly SidebarRightGuideEntry[]
}

/** Tab-type registry provided by DSH's official right Sidebar. */
export interface SidebarRightTabsService {
  register(definition: SidebarRightTabDefinition): () => void
}

/** Navigation methods bound to the Session and pane containing one tab. */
export interface SidebarRightTabActions {
  openResource(
    address: string,
    options?: Omit<SidebarRightOpenResourceOptions, 'kind' | 'replaceTab'> & { replaceTab?: boolean },
  ): void
  openTab(
    kind: string,
    options?: Omit<SidebarRightOpenTabOptions, 'replaceTab'> & { replaceTab?: boolean },
  ): void
  close(): void
}

/** Live record read through the official slot-provided `useTabInfo` Hook. */
export interface SidebarRightTabInfo {
  sidebar: {
    expanded: boolean
    fullscreen: boolean
  }
  panel: { id: string }
  tab: SidebarRightTabRecord & {
    visible: boolean
    navigation: {
      address: string
      params: SidebarRightNavigationParams
      revision: number
    }
    signal: AbortSignal
    actions: SidebarRightTabActions
  }
}

export type UseSidebarRightTabInfo = () => SidebarRightTabInfo

/** Plugin-owned client services bridged into the official Cordis Context. */
export interface PluginClientContext {
  /** DSH 0.1.5+ official right-Sidebar navigation face. */
  sidebarRight: SidebarRightService
  /** DSH 0.1.5+ official right-Sidebar tab registry. */
  sidebarRightTabs: SidebarRightTabsService
}

/** Plugin-owned locale namespaces bridged into the official slot registry. */
export interface PluginLocaleNamespaceMap {}

/**
 * The view the sidebar Plugins page asks a configuration entry for (DSH
 * 0.1.6+): `summary` for the one-liner under the title, `page` for the form
 * with its own save control. Mirrors the official
 * `dsh-client-ui-plugin-manager` slot contract; drop these declarations when
 * the workspace's official type deps move to a version that ships them.
 */
export interface PluginConfigViewProps {
  readonly view: 'summary' | 'page'
}

/**
 * Plugin-owned slots bridged into the official slot registry, plus the
 * official Plugins-page configuration slots our bundles register into:
 * `plugins.bundle.config` is keyed by the bundle's package name and rendered
 * on the bundle's own page (`view: 'page'` only); `plugins.row.config` is
 * keyed by `<package name>#<row id>`; `plugins.item` is the Official-group
 * card list the host-plane configuration pages occupy.
 */
export interface PluginSlotMap {
  'plugins.item': { kind: 'list'; scope: 'root'; owner: PluginConfigViewProps }
  'plugins.bundle.config': { kind: 'keyed'; scope: 'root'; owner: PluginConfigViewProps }
  'plugins.row.config': { kind: 'keyed'; scope: 'root'; owner: PluginConfigViewProps }
}

/** Plugin-owned conversation node payloads bridged into the chat renderer. */
export interface PluginChatNodeDataMap {}

/** DSH 0.1.2 split directory/navigation commands out of `workspaces`. */
export interface UiWorkspaceFace {
  openWorkspace?: (workspaceId: WorkspaceId) => Promise<void>
  openSession?: (sessionId: SessionId) => void
  forkSession?: (sessionId: SessionId) => Promise<void>
  startSession?: (workspaceId?: WorkspaceId) => void
  /**
   * Archive a Session.
   *
   * `stopActivity` asks the Host to stop the Session's running work (its turn,
   * subagent descendants, background jobs, schedules) instead of REFUSING the
   * archive with `workspace/session-active`. Without it the call rejects while
   * work is running, which is what lets a caller ask before killing that work.
   */
  archiveSession?: (sessionId: SessionId, options?: { readonly stopActivity?: boolean }) => Promise<void>
  pickDirectory: () => Promise<string | null>
}

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
  ConversationEventRegistry,
  ConversationNodeDefinition,
  ConversationNode,
  ConversationSnapshot,
  RunningToolCall,
  ConversationViewNode as ChatConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

export type {
  SessionBinding,
  SessionFace,
  SessionListState,
  SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
export type { SessionId } from '@deepseek-ai/dsh-session/types'
export type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
export type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
export type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'

export type { ClientContext, SettingsScope, SnapshotStore }
export type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
export type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'

export type {
  ConnectionHandle,
  SessionEvent,
} from '@deepseek-ai/dsh-client-connection/client'

export type {
  LlmConfigurableProvider as ConfigurableProviderView,
  CredentialInfo as CredentialView,
  LlmDiscoveredModel as DiscoveredModelView,
  SettingsNamespaceView,
  SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'

/** Legacy page transport retained for the side-chat history adapter. */
export interface HistoryEntry { event: unknown; seq: number }
export interface IApiClient {
  sessions: { history(request: unknown): Promise<{ result: { ok: boolean; value: { events: HistoryEntry[]; hasMore: boolean } } }> }
  subagents: { history(request: unknown): Promise<{ result: { ok: boolean; value: { events: HistoryEntry[]; hasMore: boolean } } }> }
}

export type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
export type {
  InputTriggerSource,
  ReferenceInsert,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
/**
 * Chat-target selector hook, surfaced to slot components as `useChat`.
 *
 * This is the only hook that carries chat rows (`order` / `nodes`):
 * `useSession` exposes Session LIFECYCLE facts and `useConversation` exposes
 * the target-keyed `views` store, so reading rows off either of those yields
 * `undefined`. That is the 0.1.2 shape change that silently emptied features
 * written against the old flat `snapshot.chat`.
 *
 * Declared structurally rather than re-exported from dsh-client-ui-chat: that
 * package resolves a second cordis instance here, which breaks dts bundling.
 * Types only — no runtime dependency is added.
 */
export type UseChat = <S>(
  selector: (snapshot: {
    readonly order: readonly string[]
    readonly nodes: {
      get(key: string): { kind?: string; data?: unknown } | undefined
    }
  }) => S,
  isEqual?: (a: S, b: S) => boolean,
) => S
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
  /** Scope-aware conversation controller, including draft attachments. */
  conversation: 'conversation',
  /** @deprecated DSH 0.1.2+ moved the registry to `uiConversation.events`. */
  conversationEvents: 'conversationEvents',
  /** Conversation registries (`events` / `views`) since DSH 0.1.2. */
  uiConversation: 'uiConversation',
  /** Session-scoped UI state, including the 0.1.5 pending-interaction store. */
  uiSession: 'uiSession',
  inputTriggers: 'inputTriggers',
  locale: 'locale',
  modelDirectories: 'modelDirectories',
  remote: 'remote',
  /** Session Typert namespace exposed below `ctx.remote`. */
  remoteSession: 'remote.session',
  remoteCommands: 'remote.commands',
  remoteCredentials: 'remote.credentials',
  remoteLlm: 'remote.llm',
  remotePluginInventory: 'remote.pluginInventory',
  remoteSettings: 'remote.settings',
  sessions: 'sessions',
  /** Official DSH 0.1.5+ right-Sidebar navigation service. */
  sidebarRight: 'sidebarRight',
  /** Official DSH 0.1.5+ right-Sidebar tab-type registry. */
  sidebarRightTabs: 'sidebarRightTabs',
  slots: 'slots',
  settingsScope: 'configForms',
  settingsSchema: 'settingsSchema',
  uiWorkspace: 'uiWorkspace',
  workspaces: 'workspaces',
} as const

/** Event-to-node registry shared by old `conversationEvents` and new `uiConversation.events`. */
export interface ConversationEventRegistryFace {
  register(definition: ConversationNodeDefinition): () => void
}

/**
 * Resolve the conversation event registry without injecting either service
 * name. 0.1.2-alpha removed the top-level `conversationEvents` service;
 * injecting that name leaves the plugin pending forever.
 */
export function getConversationEventRegistry(
  ctx: ClientContext,
): ConversationEventRegistryFace | undefined {
  const next = ctx.get(CLIENT_SERVICES.uiConversation) as
    | { events?: ConversationEventRegistryFace }
    | undefined
  if (next?.events !== undefined) return next.events
  return ctx.get(CLIENT_SERVICES.conversationEvents) as ConversationEventRegistryFace | undefined
}

export function getConnection(ctx: ClientContext): ConnectionHandle {
  return ctx.get('connection') as unknown as ConnectionHandle
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

/** Resolve the Workspace UI service introduced by the 0.1.2 service split. */
export function getUiWorkspace(ctx: ClientContext): UiWorkspaceFace {
  const service = ctx.get(CLIENT_SERVICES.uiWorkspace) as UiWorkspaceFace | undefined
  if (service === undefined) throw new Error('uiWorkspace service is unavailable')
  return service
}

export function getSettingsScope(ctx: ClientContext): SettingsScopeBinder {
  // DSH 0.1.7 replaced settingsScope.bind with configForms.get. Keep the
  // plugin-facing scope contract while their settings cards move together.
  const forms = (ctx as unknown as { configForms: {
    describe(): ReturnType<SettingsScopeBinder['describe']>
    get<T>(entryId: string): unknown
  } }).configForms
  const entryIds: Record<string, string> = {
    'quick-notes': 'dsh-quick-notes',
    'whale-girl': 'dsh-whale-girl',
    'ui-onboarding': 'ui-settings-general',
  }
  return {
    describe: () => forms.describe(),
    bind: <T>(spec: { namespace: string }) => forms.get<T>(entryIds[spec.namespace] ?? spec.namespace),
  } as unknown as SettingsScopeBinder
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

export interface SessionModelCatalogModel {
  id: string
  name: string
}

export interface SessionModelCatalogGroup {
  id: string
  name: string
  models: readonly SessionModelCatalogModel[]
}

export interface SessionModelCatalogFailure {
  id: string
  name: string
  message: string
}

export interface SessionModelCatalog {
  current?: { provider: string; model: string }
  groups: readonly SessionModelCatalogGroup[]
  failures: readonly SessionModelCatalogFailure[]
}

interface SessionModelRemote {
  modelCatalog?: () => Promise<{ ok?: boolean; value?: unknown }>
}

function modelRemoteOf(ctx: { get(name: string): unknown }): SessionModelRemote | undefined {
  try {
    const remote = ctx.get(CLIENT_SERVICES.remoteSession)
    return remote == null || typeof remote !== 'object' ? undefined : remote as SessionModelRemote
  } catch {
    return undefined
  }
}

function normalizeSessionModelCatalog(raw: unknown): SessionModelCatalog | undefined {
  if (raw == null || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const groups = (Array.isArray(record.groups) ? record.groups : [])
    .filter((group): group is SessionModelCatalogGroup => (
      group != null
      && typeof group === 'object'
      && Array.isArray((group as SessionModelCatalogGroup).models)
      && (group as SessionModelCatalogGroup).models.length > 0
    ))
  const failures = Array.isArray(record.failures) ? record.failures as SessionModelCatalogFailure[] : []
  const selected = record.default
  const current = selected != null && typeof selected === 'object'
    ? selected as { provider: string; model: string }
    : undefined
  return { current, groups, failures }
}

/** One-shot read of the session model directory. Missing remotes degrade to undefined. */
export async function readSessionModelCatalog(
  ctx: { get(name: string): unknown },
): Promise<SessionModelCatalog | undefined> {
  try {
    const remote = modelRemoteOf(ctx)
    if (remote === undefined || typeof remote.modelCatalog !== 'function') return undefined
    const result = await remote.modelCatalog()
    if (result == null || result.ok === false) return undefined
    return normalizeSessionModelCatalog(result.value)
  } catch {
    return undefined
  }
}

export interface SessionModelCatalogWaitOptions {
  timeoutMs?: number
  intervalMs?: number
}

/**
 * Wait until `remote.session` is mounted, then read the model directory.
 *
 * `dsh-api-remotes` attaches namespaces asynchronously. A single read on
 * mount can miss the catalog and leave a picker disabled for the session.
 */
export async function readSessionModelCatalogWhenReady(
  ctx: { get(name: string): unknown },
  options: SessionModelCatalogWaitOptions = {},
): Promise<SessionModelCatalog | undefined> {
  const timeoutMs = options.timeoutMs ?? 8_000
  const intervalMs = options.intervalMs ?? 50
  const started = Date.now()
  while (true) {
    const catalog = await readSessionModelCatalog(ctx)
    if (catalog !== undefined) return catalog
    if (Date.now() - started >= timeoutMs) return undefined
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}

/**
 * The canonical DSH session reference, for clipboard and composer use.
 *
 * ## Why the encoder is reproduced here
 *
 * `dsh-session-reference` defines the format — a session id serialized as
 * `dsh-session:<base64url(JSON id)>`, rendered as a Markdown mention
 * `@[label](uri)` — and `packages/runtime/src/host.ts` re-exports its
 * `formatSessionReferenceMention` for the HOST side. This is the CLIENT twin of
 * that export: same name, same output, resolved from `./client` instead of
 * `./host`, exactly as `readSessionModelCatalog` is paired.
 *
 * That implementation cannot run in the browser: it goes through `Buffer`, which
 * the client does not have (verified at runtime — `typeof Buffer === 'undefined'`
 * in the DSH client). No official client bundle carries it either.
 *
 * The encoding is small and fully specified, so it lives here rather than being
 * plumbed through a host round-trip for one clipboard write. Its parity with the
 * official implementation is checked by `test/session-reference.test.js` in this
 * package, which may import the official module directly — a plugin may not
 * (`scripts/check-dependency-contracts.mjs` enforces that official code enters
 * plugins only through this boundary).
 *
 * JSON-quoting the id before base64 is deliberate on the official side: the id
 * is an opaque string, and quoting keeps the encoding lossless for an id that
 * contains characters base64url alone could not carry.
 */

/** The URI scheme reserved for DSH session snapshots. */
export const SESSION_REFERENCE_SCHEME = 'dsh-session:'

/**
 * Encode a session id as a canonical `dsh-session:` URI.
 *
 * Base64url comes out of `btoa` fed a BINARY string, because `btoa` cannot take
 * arbitrary Unicode and an id is not guaranteed ASCII.
 */
export function encodeSessionReferenceUri(sessionId: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify(sessionId))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const base64 = btoa(binary)
  return `${SESSION_REFERENCE_SCHEME}${base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

/**
 * Escape a Markdown link label as the official formatter does.
 *
 * Backslash and the CLOSING bracket only. Escaping an opening `[` would still
 * round-trip (the official parser unescapes any `\x`) but would not match what
 * the host writes, and the two must stay interchangeable.
 */
function escapeSessionReferenceLabel(label: string): string {
  return label.replace(/[\\\]]/gu, (match) => `\\${match}`)
}

/** The structured id and optional display label a mention is built from. */
export interface SessionReferenceInput {
  /** Opaque source session identity. */
  sessionId: string
  /** Optional user-facing mention label. */
  label?: string
}

/**
 * The mention a composer accepts: `@[label](dsh-session:...)`.
 *
 * The label is display-only — the host resolves the id from the URI — so it can
 * be a session's title, which is what makes the pasted reference readable.
 *
 * Takes the SAME object shape as the host-side `formatSessionReferenceMention`
 * that `./host` re-exports, deliberately: an import that resolved to the other
 * entry point would otherwise compile and then misbehave at runtime, reading
 * `sessionId.sessionId` off a string. Identical call signatures make the two
 * interchangeable rather than merely similar.
 */
export function formatSessionReferenceMention(reference: SessionReferenceInput): string {
  return `@[${escapeSessionReferenceLabel(reference.label ?? reference.sessionId)}](${encodeSessionReferenceUri(reference.sessionId)})`
}
