/**
 * Host reads/writes the Models cards perform. 0.1.2 dropped `connection.api`
 * (envelope RPC) in favour of Typert remotes (`ctx.remote.llm` / `.credentials`
 * / `.settings`). The outcomes name what a card renders so failure codes stay
 * out of React.
 */
import type { ClientContext, SettingsNamespaceView, SettingsPathOpView } from '@just-genius/dsh-plugin-runtime/client'

/** Credential state used by the Models page (configured + writable). */
export interface CredentialInfo {
  configured: boolean
  writable: boolean
}

/** One model a provider disclosed. */
export interface DiscoveredModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
}

/** Facts sent with a model-catalog interrogation. */
export interface ModelDiscoveryRequest {
  provider?: string
  baseURL?: string
  api?: string
  apiKey?: string
}

/** What one namespace write answered. */
export type SettingsWriteOutcome =
  | { readonly kind: 'written'; readonly view: SettingsNamespaceView }
  | { readonly kind: 'conflict'; readonly message: string }
  | { readonly kind: 'refused'; readonly message: string }

/** What one endpoint interrogation answered. */
export type ModelDiscoveryOutcome =
  | { readonly kind: 'found'; readonly models: readonly DiscoveredModel[] }
  | { readonly kind: 'refused'; readonly message: string }

/** The Host operations the Models page and its cards invoke. */
export interface ModelsOperations {
  describeCredential(ref: string): Promise<CredentialInfo | undefined>
  storeCredential(ref: string, value: string): Promise<string | undefined>
  removeCredential(ref: string): Promise<string | undefined>
  writeSettings(
    ns: string,
    ops: SettingsPathOpView[],
    expectedRevision: number | undefined,
  ): Promise<SettingsWriteOutcome>
  discoverModels(settingsNs: string, request: ModelDiscoveryRequest): Promise<ModelDiscoveryOutcome>
}

type RemoteResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }

interface ModelsRemote {
  llm: {
    listProviders(): Promise<RemoteResult<readonly { id: string; name: string }[]>>
    listConfigurableProviders(): Promise<RemoteResult<readonly ConfigurableProvider[]>>
    discoverModels(
      settingsNs: string,
      request: ModelDiscoveryRequest,
    ): Promise<RemoteResult<readonly DiscoveredModel[]>>
  }
  credentials: {
    describe(refs: readonly string[]): Promise<RemoteResult<Record<string, CredentialInfo>>>
    set(ref: string, value: string): Promise<RemoteResult<unknown>>
    unset(ref: string): Promise<RemoteResult<unknown>>
  }
  settings: {
    mutate(
      ns: string,
      ops: SettingsPathOpView[],
      expectedRevision?: number,
    ): Promise<RemoteResult<SettingsNamespaceView>>
  }
}

/** Declared configurable-provider directory row. */
export interface ConfigurableProvider {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: readonly string[]
  declared?: boolean
}

function remoteOf(ctx: ClientContext): ModelsRemote {
  return (ctx as unknown as { remote: ModelsRemote }).remote
}

/**
 * Bind the page's Host operations to the plugin's own Remote namespaces.
 * @param ctx - apply context that injects `remote.credentials` / `.llm` / `.settings`.
 */
export function createModelsOperations(ctx: ClientContext): ModelsOperations {
  const remote = remoteOf(ctx)
  return {
    describeCredential: async (ref) => {
      const response = await remote.credentials.describe([ref])
      return response.ok ? response.value[ref] : undefined
    },
    storeCredential: async (ref, value) => {
      const response = await remote.credentials.set(ref, value)
      return response.ok ? undefined : response.error.message
    },
    removeCredential: async (ref) => {
      const response = await remote.credentials.unset(ref)
      return response.ok ? undefined : response.error.message
    },
    writeSettings: async (ns, ops, expectedRevision) => {
      const response = await remote.settings.mutate(ns, ops, expectedRevision)
      if (response.ok) return { kind: 'written', view: response.value }
      const { code, message } = response.error
      return code === 'settings/conflict' || code === 'settings-conflict'
        ? { kind: 'conflict', message }
        : { kind: 'refused', message }
    },
    discoverModels: async (settingsNs, request) => {
      const response = await remote.llm.discoverModels(settingsNs, request)
      return response.ok
        ? { kind: 'found', models: response.value }
        : { kind: 'refused', message: response.error.message }
    },
  }
}

export { remoteOf }
