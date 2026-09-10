import { join } from 'node:path'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { credentialRef, defineTool } from '@just-genius/dsh-plugin-runtime/host'
import {
  McpHttpClient,
  McpHttpError,
  agentCredentialKey,
  applyVariablesToMcp,
  buildAuthorizationUrl,
  createOAuthState,
  createPkcePair,
  defaultVariables,
  disableInState,
  discoverMcpOAuth,
  enableInState,
  exchangeAuthorizationCode,
  hasUnresolvedPlaceholders,
  installPackFromCatalog,
  jsonSchemaToToolParameters,
  listCatalogIds,
  loadCatalogPack,
  loadInstalledPack,
  mcpToolName,
  oauthResourceUrl,
  readAgentState,
  refreshAccessToken,
  registerOAuthClient,
  removeFromState,
  resolveToolArguments,
  setConnectionStatus,
  setVariables,
  summarizeUninstallCleanup,
  uninstallPackFiles,
  writeAgentState,
  type AgentCatalogEntry,
  type AgentInstalledEntry,
  type AgentMcpConfig,
  type AgentPackSnapshot,
  type AgentPluginStateFile,
  type AgentVariableView,
  type OAuthTokenSet,
  type UninstallCleanupReport,
} from '@just-genius/dsh-agent-plugin'
import { builtinCatalogRoot } from './catalog-root.ts'

type Disposer = () => void

interface ActivePack {
  disposers: Disposer[]
  client: McpHttpClient | null
}

interface PendingOAuth {
  pluginId: string
  state: string
  codeVerifier: string
  redirectUri: string
  tokenEndpoint: string
  clientId: string
  clientSecret?: string
  resource: string
  scopes: string[]
  createdAt: number
  status: 'pending' | 'ok' | 'error'
  error?: string
}

const OAUTH_SECRET_KEYS = [
  'ACCESS_TOKEN',
  'REFRESH_TOKEN',
  'CLIENT_ID',
  'CLIENT_SECRET',
] as const

const OAUTH_SESSION_TTL_MS = 10 * 60 * 1000

/**
 * Host activator: install/configure on disk, then mount MCP tools + skill
 * prompt sections into the live agent when a pack is enabled.
 */
export class AgentPackRuntime {
  private readonly active = new Map<string, ActivePack>()
  private readonly oauthByState = new Map<string, PendingOAuth>()
  private readonly oauthByPlugin = new Map<string, PendingOAuth>()
  private readonly catalogRoot = builtinCatalogRoot()

  constructor(private readonly ctx: Context) {}

  async bootstrap(): Promise<void> {
    const state = await readAgentState()
    for (const [pluginId, record] of Object.entries(state.plugins)) {
      if (!record.enabled) continue
      try {
        await this.mount(pluginId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const needsAuth = /401|unauthor/i.test(message)
        await this.persistConnection(pluginId, {
          status: needsAuth ? 'needs_auth' : 'error',
          error: message,
        })
      }
    }
  }

  async disposeAll(): Promise<void> {
    for (const pluginId of [...this.active.keys()]) {
      await this.unmount(pluginId)
    }
  }

  async listCatalog(): Promise<AgentCatalogEntry[]> {
    const state = await readAgentState()
    const ids = await listCatalogIds(this.catalogRoot)
    const entries: AgentCatalogEntry[] = []
    for (const id of ids) {
      const pack = await loadCatalogPack(join(this.catalogRoot, id))
      const installed = state.plugins[id]
      entries.push({
        name: pack.manifest.name,
        version: pack.manifest.version,
        description: pack.manifest.description,
        displayName: {
          en: pack.manifest.displayName?.en ?? pack.manifest.name,
          zh: pack.manifest.displayName?.zh
            ?? pack.manifest.displayName?.en
            ?? pack.manifest.name,
        },
        auth: pack.manifest.auth,
        comingSoon: pack.manifest.comingSoon === true,
        keywords: pack.manifest.keywords ?? [],
        installed: installed !== undefined,
        enabled: installed?.enabled === true,
        connectionStatus: installed?.connection.status ?? null,
        hasAuth: await this.hasAuth(id, pack),
      })
    }
    return entries
  }

  async listInstalled(): Promise<AgentInstalledEntry[]> {
    const state = await readAgentState()
    const entries: AgentInstalledEntry[] = []
    for (const [pluginId, record] of Object.entries(state.plugins)) {
      let pack: AgentPackSnapshot
      try {
        pack = await loadInstalledPack(pluginId)
      } catch {
        continue
      }
      entries.push({
        name: pack.manifest.name,
        version: pack.manifest.version,
        description: pack.manifest.description,
        displayName: {
          en: pack.manifest.displayName?.en ?? pack.manifest.name,
          zh: pack.manifest.displayName?.zh
            ?? pack.manifest.displayName?.en
            ?? pack.manifest.name,
        },
        auth: pack.manifest.auth,
        comingSoon: false,
        keywords: pack.manifest.keywords ?? [],
        installed: true,
        enabled: record.enabled,
        connectionStatus: record.connection.status,
        hasAuth: await this.hasAuth(pluginId, pack),
        variables: record.variables,
        variableSpecs: variableViews(pack),
        headerSecrets: pack.manifest.headerSecrets ?? [],
        installedAt: record.installedAt,
        connectionError: record.connection.error,
        toolCount: record.connection.toolCount,
      })
    }
    return entries
  }

  async install(pluginId: string): Promise<void> {
    const catalogDir = join(this.catalogRoot, pluginId)
    const pack = await loadCatalogPack(catalogDir)
    if (pack.manifest.comingSoon) {
      throw new Error(`"${pluginId}" is marked comingSoon and cannot be installed yet`)
    }
    await installPackFromCatalog({ pluginId, catalogDir })
  }

  async configure(
    pluginId: string,
    variables: Record<string, string | boolean | number>,
  ): Promise<void> {
    let state = await readAgentState()
    if (state.plugins[pluginId] === undefined) {
      throw new Error(`agent plugin "${pluginId}" is not installed`)
    }
    state = setVariables(state, pluginId, variables)
    await writeAgentState(state)
    if (state.plugins[pluginId]?.enabled) {
      await this.unmount(pluginId)
      await this.mount(pluginId)
    }
  }

  async setAuth(options: {
    pluginId: string
    token?: string
    secrets?: Record<string, string>
    logout?: boolean
  }): Promise<void> {
    const pack = await loadInstalledPack(options.pluginId)
    if (options.logout) {
      await this.clearCredentials(options.pluginId, pack)
      if (this.active.has(options.pluginId)) {
        await this.unmount(options.pluginId)
        await this.persistConnection(options.pluginId, { status: 'needs_auth' })
      }
      return
    }

    if (pack.manifest.auth === 'oauth') {
      const token = options.token?.trim()
      if (!token) throw new Error('oauth token is required')
      await this.ctx.credentials.set(
        credentialRef(agentCredentialKey(options.pluginId, 'ACCESS_TOKEN')),
        token,
      )
    } else if (pack.manifest.auth === 'headers') {
      const secrets = options.secrets ?? {}
      for (const name of pack.manifest.headerSecrets ?? []) {
        const value = secrets[name]?.trim()
        if (!value) throw new Error(`secret "${name}" is required`)
        await this.ctx.credentials.set(
          credentialRef(agentCredentialKey(options.pluginId, name)),
          value,
        )
      }
    }

    const state = await readAgentState()
    if (state.plugins[options.pluginId]?.enabled) {
      await this.unmount(options.pluginId)
      await this.mount(options.pluginId)
    }
  }

  async startOAuth(pluginId: string): Promise<{ authorizeUrl: string }> {
    const pack = await loadInstalledPack(pluginId)
    if (pack.manifest.auth !== 'oauth') {
      throw new Error(`"${pluginId}" does not use OAuth`)
    }
    const mcpUrl = await this.firstMcpUrl(pluginId, pack)
    const discovery = await discoverMcpOAuth(mcpUrl)
    const redirectUri = this.oauthCallbackUri()
    let clientId = await this.readSecret(pluginId, 'CLIENT_ID')
    let clientSecret = await this.readSecret(pluginId, 'CLIENT_SECRET')
    if (!clientId) {
      const registrationEndpoint = discovery.authorizationServer.registrationEndpoint
      if (!registrationEndpoint) {
        throw new Error('authorization server does not advertise dynamic client registration')
      }
      const registered = await registerOAuthClient({
        registrationEndpoint,
        redirectUri,
        clientName: `DSH ${pack.manifest.displayName?.en ?? pluginId}`,
      })
      clientId = registered.clientId
      clientSecret = registered.clientSecret
      await this.writeSecret(pluginId, 'CLIENT_ID', clientId)
      if (clientSecret) await this.writeSecret(pluginId, 'CLIENT_SECRET', clientSecret)
    }
    const pkce = createPkcePair()
    const state = createOAuthState()
    const pending: PendingOAuth = {
      pluginId,
      state,
      codeVerifier: pkce.verifier,
      redirectUri,
      tokenEndpoint: discovery.authorizationServer.tokenEndpoint,
      clientId,
      clientSecret,
      resource: discovery.resource || oauthResourceUrl(mcpUrl),
      scopes: discovery.scopes,
      createdAt: Date.now(),
      status: 'pending',
    }
    const previous = this.oauthByPlugin.get(pluginId)
    if (previous) this.oauthByState.delete(previous.state)
    this.oauthByState.set(state, pending)
    this.oauthByPlugin.set(pluginId, pending)
    return {
      authorizeUrl: buildAuthorizationUrl({
        authorizationEndpoint: discovery.authorizationServer.authorizationEndpoint,
        clientId,
        redirectUri,
        state,
        pkce,
        resource: pending.resource,
        scopes: pending.scopes,
      }),
    }
  }

  oauthStatus(pluginId: string): { status: 'idle' | 'pending' | 'ok' | 'error'; error?: string } {
    const pending = this.oauthByPlugin.get(pluginId)
    if (!pending) return { status: 'idle' }
    if (Date.now() - pending.createdAt > OAUTH_SESSION_TTL_MS && pending.status === 'pending') {
      pending.status = 'error'
      pending.error = 'OAuth session expired'
    }
    return { status: pending.status, error: pending.error }
  }

  async completeOAuth(query: URLSearchParams): Promise<{ pluginId: string; ok: boolean; error?: string }> {
    const error = query.get('error')
    const description = query.get('error_description')
    const state = query.get('state') ?? ''
    const pending = this.oauthByState.get(state)
    if (!pending || Date.now() - pending.createdAt > OAUTH_SESSION_TTL_MS) {
      return { pluginId: pending?.pluginId ?? '', ok: false, error: 'OAuth session is missing or expired' }
    }
    if (error) {
      pending.status = 'error'
      pending.error = description ? `${error}: ${description}` : error
      return { pluginId: pending.pluginId, ok: false, error: pending.error }
    }
    const code = query.get('code')?.trim() ?? ''
    if (code === '') {
      pending.status = 'error'
      pending.error = 'authorization code missing'
      return { pluginId: pending.pluginId, ok: false, error: pending.error }
    }
    try {
      const tokens = await exchangeAuthorizationCode({
        tokenEndpoint: pending.tokenEndpoint,
        code,
        redirectUri: pending.redirectUri,
        clientId: pending.clientId,
        clientSecret: pending.clientSecret,
        codeVerifier: pending.codeVerifier,
        resource: pending.resource,
      })
      await this.storeTokenSet(pending.pluginId, tokens)
      pending.status = 'ok'
      const stateFile = await readAgentState()
      if (stateFile.plugins[pending.pluginId]?.enabled) {
        await this.unmount(pending.pluginId)
        await this.mount(pending.pluginId)
      }
      return { pluginId: pending.pluginId, ok: true }
    } catch (caught) {
      pending.status = 'error'
      pending.error = caught instanceof Error ? caught.message : String(caught)
      return { pluginId: pending.pluginId, ok: false, error: pending.error }
    }
  }

  async enable(pluginId: string): Promise<void> {
    let state = await readAgentState()
    state = enableInState(state, pluginId)
    await writeAgentState(state)
    await this.mount(pluginId)
  }

  async disable(pluginId: string): Promise<void> {
    await this.unmount(pluginId)
    let state = await readAgentState()
    state = disableInState(state, pluginId)
    await writeAgentState(state)
  }

  async uninstall(pluginId: string): Promise<UninstallCleanupReport> {
    const failures: string[] = []
    let runtimeDetached = true
    try {
      await this.unmount(pluginId)
    } catch (error) {
      runtimeDetached = false
      failures.push(`runtime: ${error instanceof Error ? error.message : String(error)}`)
    }

    let pack: AgentPackSnapshot | null = null
    try {
      pack = await loadInstalledPack(pluginId)
    } catch {
      pack = null
    }

    let directoryRemoved = true
    let stateRemoved = true
    try {
      await uninstallPackFiles({ pluginId })
    } catch (error) {
      directoryRemoved = false
      stateRemoved = false
      failures.push(`files: ${error instanceof Error ? error.message : String(error)}`)
      try {
        const state = removeFromState(await readAgentState(), pluginId)
        await writeAgentState(state)
        stateRemoved = true
      } catch (stateError) {
        failures.push(
          `state: ${stateError instanceof Error ? stateError.message : String(stateError)}`,
        )
      }
    }

    let credentialsCleared = true
    try {
      if (pack) await this.clearCredentials(pluginId, pack)
    } catch (error) {
      credentialsCleared = false
      failures.push(`credentials: ${error instanceof Error ? error.message : String(error)}`)
    }

    return summarizeUninstallCleanup({
      runtimeDetached,
      directoryRemoved,
      stateRemoved,
      credentialsCleared,
      failures,
    })
  }

  private async mount(pluginId: string): Promise<void> {
    await this.unmount(pluginId)
    const state = await readAgentState()
    const record = state.plugins[pluginId]
    if (record === undefined || !record.enabled) return

    const pack = await loadInstalledPack(pluginId)
    const secretVars = await this.resolveSecrets(pluginId, pack)
    const variables = {
      ...defaultVariables(pack.manifest),
      ...record.variables,
      ...secretVars,
    }
    const mcp = applyVariablesToMcp(pack.mcp, variables)
    assertResolvedMcp(mcp)

    const serverIds = Object.keys(mcp)
    const firstId = serverIds[0]
    if (firstId === undefined) throw new Error('mcp.json has no servers')
    const firstServer = mcp[firstId]!
    const skillDisposers = this.registerSkills(pluginId, pack)

    let headers: Record<string, string>
    try {
      headers = await this.authHeaders(pack, secretVars)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.active.set(pluginId, { disposers: skillDisposers, client: null })
      await this.persistConnection(pluginId, { status: 'needs_auth', error: message })
      return
    }
    const client = new McpHttpClient({ server: firstServer, headers })
    try {
      await client.connect()
    } catch (error) {
      if (isUnauthorized(error) && pack.manifest.auth === 'oauth') {
        const refreshed = await this.tryRefresh(pluginId, pack)
        if (refreshed) {
          const retry = new McpHttpClient({
            server: firstServer,
            headers: { Authorization: `Bearer ${refreshed}` },
          })
          await retry.connect()
          await this.finishMount(pluginId, pack, retry, firstId, skillDisposers)
          return
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      const needsAuth = isUnauthorized(error)
      this.active.set(pluginId, { disposers: skillDisposers, client: null })
      await this.persistConnection(pluginId, {
        status: needsAuth ? 'needs_auth' : 'error',
        error: message,
      })
      return
    }

    await this.finishMount(pluginId, pack, client, firstId, skillDisposers)
  }

  private registerSkills(pluginId: string, pack: AgentPackSnapshot): Disposer[] {
    const disposers: Disposer[] = []
    const names = pack.skills.map((skill) => skill.name).join(', ')
    disposers.push(this.ctx.systemPrompt.section({
      name: `agent-pack:${pluginId}:index`,
      order: 155,
      text: () => [
        `## Enabled agent pack: ${pack.manifest.displayName?.en ?? pluginId}`,
        '',
        `This session has the "${pluginId}" agent pack enabled.`,
        names === '' ? '' : `Bundled skills: ${names}.`,
        `When the user asks about ${pluginId}, use this pack's MCP tools (names start with mcp__${pluginId}__).`,
        'If tools are missing, ask them to reconnect in Settings → Plugins → Agent packs.',
      ].filter((line) => line !== '').join('\n'),
    }))
    for (const skill of pack.skills) {
      const text = [
        `## Agent pack skill: ${skill.name}`,
        '',
        skill.description,
        '',
        skill.body,
      ].join('\n')
      disposers.push(this.ctx.systemPrompt.section({
        name: `agent-pack:${pluginId}:skill:${skill.name}`,
        order: 160,
        text: () => text,
      }))
    }
    return disposers
  }

  private async finishMount(
    pluginId: string,
    _pack: AgentPackSnapshot,
    client: McpHttpClient,
    firstId: string,
    skillDisposers: Disposer[],
  ): Promise<void> {
    const disposers: Disposer[] = [...skillDisposers]
    const tools = await client.listTools()

    for (const tool of tools) {
      const name = mcpToolName(firstId, tool.name)
      const parameters = jsonSchemaToToolParameters(
        tool.inputSchema ?? { type: 'object', properties: {} },
      )
      const dispose = this.ctx.tools.register(defineTool({
        name,
        description: tool.description ?? `MCP tool ${tool.name} from ${pluginId}`,
        // MCP JSON Schema → DSH parameter DSL; cast through the shared converter boundary.
        parameters: parameters as never,
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: String(value) }],
        },
        execute: async (args) => {
          const result = await client.callTool(
            tool.name,
            resolveToolArguments(args as Record<string, unknown>),
          )
          return typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        },
      }))
      disposers.push(dispose)
    }

    this.active.set(pluginId, { disposers, client })
    await this.persistConnection(pluginId, {
      status: 'connected',
      toolCount: tools.length,
    })
  }

  private async unmount(pluginId: string): Promise<void> {
    const active = this.active.get(pluginId)
    if (active === undefined) return
    for (const dispose of active.disposers) {
      try {
        dispose()
      } catch {
        // continue
      }
    }
    try {
      await active.client?.close()
    } catch {
      // ignore
    }
    this.active.delete(pluginId)
  }

  private async persistConnection(
    pluginId: string,
    connection: AgentPluginStateFile['plugins'][string]['connection'],
  ): Promise<void> {
    const state = setConnectionStatus(await readAgentState(), pluginId, connection)
    await writeAgentState(state)
  }

  private async hasAuth(pluginId: string, pack: AgentPackSnapshot): Promise<boolean> {
    if (pack.manifest.auth === 'none') return true
    if (pack.manifest.auth === 'oauth') {
      const resolved = await this.ctx.credentials.resolve(
        credentialRef(agentCredentialKey(pluginId, 'ACCESS_TOKEN')),
      )
      return Boolean(resolved?.value)
    }
    for (const name of pack.manifest.headerSecrets ?? []) {
      const resolved = await this.ctx.credentials.resolve(
        credentialRef(agentCredentialKey(pluginId, name)),
      )
      if (!resolved?.value) return false
    }
    return (pack.manifest.headerSecrets?.length ?? 0) > 0
  }

  private async resolveSecrets(
    pluginId: string,
    pack: AgentPackSnapshot,
  ): Promise<Record<string, string>> {
    const secrets: Record<string, string> = {}
    if (pack.manifest.auth === 'oauth') {
      const resolved = await this.ctx.credentials.resolve(
        credentialRef(agentCredentialKey(pluginId, 'ACCESS_TOKEN')),
      )
      if (resolved?.value) secrets.ACCESS_TOKEN = resolved.value
      return secrets
    }
    for (const name of pack.manifest.headerSecrets ?? []) {
      const resolved = await this.ctx.credentials.resolve(
        credentialRef(agentCredentialKey(pluginId, name)),
      )
      if (resolved?.value) secrets[name] = resolved.value
    }
    return secrets
  }

  private async authHeaders(
    pack: AgentPackSnapshot,
    secrets: Record<string, string>,
  ): Promise<Record<string, string>> {
    if (pack.manifest.auth === 'oauth') {
      const token = secrets.ACCESS_TOKEN
      if (!token) throw new Error('OAuth token missing — connect in Plugin Manager')
      return { Authorization: `Bearer ${token}` }
    }
    if (pack.manifest.auth === 'headers') {
      for (const name of pack.manifest.headerSecrets ?? []) {
        if (!secrets[name]) {
          throw new Error(`Missing secret "${name}" — configure it in Plugin Manager`)
        }
      }
    }
    return {}
  }

  private async clearCredentials(pluginId: string, pack: AgentPackSnapshot): Promise<void> {
    if (pack.manifest.auth === 'oauth') {
      for (const name of OAUTH_SECRET_KEYS) {
        await this.ctx.credentials.unset(credentialRef(agentCredentialKey(pluginId, name)))
      }
      return
    }
    for (const name of pack.manifest.headerSecrets ?? []) {
      await this.ctx.credentials.unset(credentialRef(agentCredentialKey(pluginId, name)))
    }
  }

  private async firstMcpUrl(pluginId: string, pack: AgentPackSnapshot): Promise<string> {
    const record = (await readAgentState()).plugins[pluginId]
    return this.resolveMcpUrl(pack, record?.variables ?? {})
  }

  private resolveMcpUrl(
    pack: AgentPackSnapshot,
    extra: Record<string, string | boolean | number> = {},
  ): string {
    const mcp = applyVariablesToMcp(pack.mcp, { ...defaultVariables(pack.manifest), ...extra })
    const first = Object.values(mcp)[0]
    if (!first) throw new Error('mcp.json has no servers')
    return oauthResourceUrl(first.url)
  }

  private oauthCallbackUri(): string {
    return `http://127.0.0.1:${this.ctx.webServer.port}/dsh-plugin-config/agent/oauth/callback`
  }

  private async readSecret(pluginId: string, name: string): Promise<string | undefined> {
    const resolved = await this.ctx.credentials.resolve(credentialRef(agentCredentialKey(pluginId, name)))
    return resolved?.value || undefined
  }

  private async writeSecret(pluginId: string, name: string, value: string): Promise<void> {
    await this.ctx.credentials.set(credentialRef(agentCredentialKey(pluginId, name)), value)
  }

  private async storeTokenSet(pluginId: string, tokens: OAuthTokenSet): Promise<void> {
    await this.writeSecret(pluginId, 'ACCESS_TOKEN', tokens.accessToken)
    if (tokens.refreshToken) await this.writeSecret(pluginId, 'REFRESH_TOKEN', tokens.refreshToken)
  }

  private async tryRefresh(pluginId: string, pack: AgentPackSnapshot): Promise<string | null> {
    const refreshToken = await this.readSecret(pluginId, 'REFRESH_TOKEN')
    const clientId = await this.readSecret(pluginId, 'CLIENT_ID')
    if (!refreshToken || !clientId) return null
    try {
      const mcpUrl = await this.firstMcpUrl(pluginId, pack)
      const discovery = await discoverMcpOAuth(mcpUrl)
      const tokens = await refreshAccessToken({
        tokenEndpoint: discovery.authorizationServer.tokenEndpoint,
        refreshToken,
        clientId,
        clientSecret: await this.readSecret(pluginId, 'CLIENT_SECRET'),
        resource: discovery.resource || mcpUrl,
      })
      await this.storeTokenSet(pluginId, tokens)
      return tokens.accessToken
    } catch {
      return null
    }
  }
}

function variableViews(pack: AgentPackSnapshot): Record<string, AgentVariableView> {
  const views: Record<string, AgentVariableView> = {}
  for (const [key, spec] of Object.entries(pack.manifest.variables ?? {})) {
    views[key] = {
      type: spec.type,
      required: spec.required === true,
      label: {
        en: spec.label?.en ?? spec.label?.zh ?? key,
        zh: spec.label?.zh ?? spec.label?.en ?? key,
      },
    }
  }
  return views
}

function isUnauthorized(error: unknown): boolean {
  if (error instanceof McpHttpError && error.status === 401) return true
  const message = error instanceof Error ? error.message : String(error)
  return /401|unauthor/i.test(message)
}

function assertResolvedMcp(mcp: AgentMcpConfig): void {
  for (const [id, server] of Object.entries(mcp)) {
    if (hasUnresolvedPlaceholders(server.url)) {
      throw new Error(`mcp.${id}.url still has unresolved placeholders`)
    }
    for (const [header, value] of Object.entries(server.headers ?? {})) {
      if (hasUnresolvedPlaceholders(value)) {
        throw new Error(`mcp.${id}.headers.${header} still has unresolved placeholders`)
      }
    }
  }
}
