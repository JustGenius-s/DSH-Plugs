import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import type {} from '@just-genius/dsh-plugin-runtime'
import { HOST_SERVICES } from '@just-genius/dsh-plugin-runtime/host'
import {
  AUTH_LOGOUT_PATH,
  AUTH_POLL_PATH,
  AUTH_START_PATH,
  CONFIG_PATH,
  PULL_PATH,
  PUSH_PATH,
  STATUS_PATH,
} from './shared.ts'
import { SyncRuntime } from './sync-runtime.ts'

export const name = 'dsh-sync'
export const inject = [
  HOST_SERVICES.webServer,
  HOST_SERVICES.settings,
  HOST_SERVICES.pluginProfile,
  HOST_SERVICES.credentials,
  HOST_SERVICES.storageDomain,
] as const

export function apply(ctx: Context): void {
  const runtime = new SyncRuntime(ctx)
  ctx.effect(() => () => { void runtime.close() }, 'dsh-sync: close domain')
  const routes = [
    [STATUS_PATH, runtime.status, 'status'],
    [CONFIG_PATH, runtime.config, 'config'],
    [AUTH_START_PATH, runtime.authStart, 'auth start'],
    [AUTH_POLL_PATH, runtime.authPoll, 'auth poll'],
    [AUTH_LOGOUT_PATH, runtime.authLogout, 'auth logout'],
    [PUSH_PATH, runtime.push, 'push'],
    [PULL_PATH, runtime.pull, 'pull'],
  ] as const

  for (const [path, handler, label] of routes) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }), `dsh-sync: ${label}`)
  }
}
