import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { errorMessage, readJsonBody, sendJson as json } from '@just-genius/dsh-plugin-runtime/host'
import type { AgentPackRuntime } from './runtime.ts'
import {
  AGENT_ACTION_PATH,
  AGENT_AUTH_PATH,
  AGENT_CATALOG_PATH,
  AGENT_CONFIGURE_PATH,
  AGENT_INSTALL_PATH,
  AGENT_INSTALLED_PATH,
  AGENT_OAUTH_CALLBACK_PATH,
  AGENT_OAUTH_START_PATH,
  AGENT_OAUTH_STATUS_PATH,
  type AgentActionRequest,
  type AgentAuthRequest,
  type AgentConfigureRequest,
  type AgentOAuthStartResult,
  type AgentOAuthStatusResult,
  type AgentOpResult,
} from './types.ts'

/** Register agent-pack management routes on the host web server. */
export function registerAgentRoutes(ctx: Context, runtime: AgentPackRuntime): void {
  const routes: Array<{
    path: string
    label: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }> = [
    {
      path: AGENT_CATALOG_PATH,
      label: 'catalog',
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          json(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        try {
          json(res, 200, { ok: true, plugins: await runtime.listCatalog() })
        } catch (error) {
          json(res, 500, { ok: false, error: errorMessage(error) })
        }
      },
    },
    {
      path: AGENT_INSTALLED_PATH,
      label: 'installed',
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          json(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        try {
          json(res, 200, { ok: true, plugins: await runtime.listInstalled() })
        } catch (error) {
          json(res, 500, { ok: false, error: errorMessage(error) })
        }
      },
    },
    {
      path: AGENT_INSTALL_PATH,
      label: 'install',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        try {
          const body = await readJsonBody(req)
          const pluginId = readPluginId(body)
          if (!pluginId) {
            json(res, 400, { ok: false, error: 'pluginId is required' })
            return
          }
          await runtime.install(pluginId)
          json(res, 200, { ok: true, pluginId } satisfies AgentOpResult)
        } catch (error) {
          json(res, 400, { ok: false, error: errorMessage(error) })
        }
      },
    },
    {
      path: AGENT_ACTION_PATH,
      label: 'action',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        try {
          const body = await readJsonBody(req)
          const request = parseAction(body)
          if (!request) {
            json(res, 400, { ok: false, error: 'action and pluginId are required' })
            return
          }
          if (request.action === 'enable') await runtime.enable(request.pluginId)
          else if (request.action === 'disable') await runtime.disable(request.pluginId)
          else {
            const report = await runtime.uninstall(request.pluginId)
            const detail = report.failures.length > 0 ? report.failures.join('; ') : undefined
            json(res, 200, {
              ok: report.failures.length === 0,
              pluginId: request.pluginId,
              detail,
              error: detail,
            } satisfies AgentOpResult)
            return
          }
          json(res, 200, { ok: true, pluginId: request.pluginId } satisfies AgentOpResult)
        } catch (error) {
          json(res, 400, { ok: false, error: errorMessage(error) })
        }
      },
    },
    {
      path: AGENT_CONFIGURE_PATH,
      label: 'configure',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        try {
          const body = await readJsonBody(req)
          const request = parseConfigure(body)
          if (!request) {
            json(res, 400, { ok: false, error: 'pluginId and variables are required' })
            return
          }
          await runtime.configure(request.pluginId, request.variables)
          json(res, 200, { ok: true, pluginId: request.pluginId } satisfies AgentOpResult)
        } catch (error) {
          json(res, 400, { ok: false, error: errorMessage(error) })
        }
      },
    },
    {
      path: AGENT_AUTH_PATH,
      label: 'auth',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        try {
          const body = await readJsonBody(req)
          const request = parseAuth(body)
          if (!request) {
            json(res, 400, { ok: false, error: 'pluginId is required' })
            return
          }
          await runtime.setAuth(request)
          json(res, 200, { ok: true, pluginId: request.pluginId } satisfies AgentOpResult)
        } catch (error) {
          json(res, 400, { ok: false, error: errorMessage(error) })
        }
      },
    },
    {
      path: AGENT_OAUTH_START_PATH,
      label: 'oauth start',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        try {
          const pluginId = readPluginId(await readJsonBody(req))
          if (!pluginId) {
            json(res, 400, { ok: false, error: 'pluginId is required' })
            return
          }
          const started = await runtime.startOAuth(pluginId)
          json(res, 200, { ok: true, authorizeUrl: started.authorizeUrl } satisfies AgentOAuthStartResult)
        } catch (error) {
          json(res, 400, { ok: false, error: errorMessage(error) } satisfies AgentOAuthStartResult)
        }
      },
    },
    {
      path: AGENT_OAUTH_STATUS_PATH,
      label: 'oauth status',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        try {
          const pluginId = readPluginId(await readJsonBody(req))
          if (!pluginId) {
            json(res, 400, { ok: false, error: 'pluginId is required' })
            return
          }
          const status = runtime.oauthStatus(pluginId)
          json(res, 200, { ok: true, ...status } satisfies AgentOAuthStatusResult)
        } catch (error) {
          json(res, 400, {
            ok: false,
            status: 'error',
            error: errorMessage(error),
          } satisfies AgentOAuthStatusResult)
        }
      },
    },
    {
      path: AGENT_OAUTH_CALLBACK_PATH,
      label: 'oauth callback',
      handler: async (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          res.end()
          return
        }
        if (req.method !== 'GET') {
          json(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        const query = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
        const result = await runtime.completeOAuth(query)
        sendHtml(res, result.ok ? 200 : 400, oauthCallbackPage(result.ok, result.error))
      },
    },
  ]

  for (const route of routes) {
    ctx.effect(
      () => ctx.webServer.register({
        kind: 'exact',
        path: route.path,
        handler: route.handler,
      }),
      `dsh-plugin-config: agent ${route.label}`,
    )
  }
}

function readPluginId(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null
  const value = (body as { pluginId?: unknown }).pluginId
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function parseAction(body: unknown): AgentActionRequest | null {
  if (body === null || typeof body !== 'object') return null
  const value = body as { action?: unknown; pluginId?: unknown }
  if (value.action !== 'enable' && value.action !== 'disable' && value.action !== 'uninstall') {
    return null
  }
  if (typeof value.pluginId !== 'string' || value.pluginId.trim() === '') return null
  return { action: value.action, pluginId: value.pluginId.trim() }
}

function parseConfigure(body: unknown): AgentConfigureRequest | null {
  if (body === null || typeof body !== 'object') return null
  const value = body as { pluginId?: unknown; variables?: unknown }
  if (typeof value.pluginId !== 'string' || value.pluginId.trim() === '') return null
  if (value.variables === null || typeof value.variables !== 'object' || Array.isArray(value.variables)) {
    return null
  }
  const variables: Record<string, string | boolean | number> = {}
  for (const [key, item] of Object.entries(value.variables as Record<string, unknown>)) {
    if (typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number') {
      variables[key] = item
    }
  }
  return { pluginId: value.pluginId.trim(), variables }
}

function parseAuth(body: unknown): AgentAuthRequest | null {
  if (body === null || typeof body !== 'object') return null
  const value = body as {
    pluginId?: unknown
    token?: unknown
    secrets?: unknown
    logout?: unknown
  }
  if (typeof value.pluginId !== 'string' || value.pluginId.trim() === '') return null
  const request: AgentAuthRequest = { pluginId: value.pluginId.trim() }
  if (typeof value.token === 'string') request.token = value.token
  if (value.logout === true) request.logout = true
  if (value.secrets !== null && typeof value.secrets === 'object' && !Array.isArray(value.secrets)) {
    const secrets: Record<string, string> = {}
    for (const [key, item] of Object.entries(value.secrets as Record<string, unknown>)) {
      if (typeof item === 'string') secrets[key] = item
    }
    request.secrets = secrets
  }
  return request
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(html)
}

function oauthCallbackPage(ok: boolean, error?: string): string {
  const title = ok ? '登录成功' : '登录失败'
  const detail = ok
    ? '凭证已保存。可以关闭此窗口，回到 DSH 插件管理继续操作。'
    : escapeHtml(error ?? 'authorization failed')
  return `<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 48px auto; max-width: 40rem; line-height: 1.5; }
    p { color: ${ok ? '#0f766e' : '#b42318'}; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>${detail}</p>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
