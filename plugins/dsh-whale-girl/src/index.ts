import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import type { Session } from '@just-genius/dsh-plugin-runtime/host'
import { Schema } from '@just-genius/dsh-plugin-runtime/host'
import { installSettingsSection } from '@just-genius/dsh-plugin-runtime/host'
import { HOST_SERVICES, HttpInputError, readJsonBody, sendJson } from '@just-genius/dsh-plugin-runtime/host'
import {
  BODY_LIMIT,
  DEFAULTS,
  NAMESPACE,
  validateConfig,
  type WhaleGirlConfig,
} from './shared/config.ts'
import {
  recordActive,
  recordFailure,
  recordSession,
  recordSessionResume,
  recordTaskCompleted,
} from './shared/pet-state.ts'
import {
  SNAPSHOT_API_VERSION,
  TURN_COMPLETED_MS,
  companionOnline,
  deriveActivity,
  mergeCelebrate,
  pokePresence,
  turnCompletionSnapshot,
} from './shared/activity.ts'
import { applyAction, isCrossOrigin } from './shared/interact.ts'
import { applySessionView, createSessionView, parseTurnEvent, titleFromLog, type SessionView } from './shared/sessions.ts'
import { contentTypeFor, sanitizeAssetPath } from './shared/assets.ts'
import {
  ASSETS_PATH,
  CONFIG_PATH,
  EVENTS_PATH,
  INTERACT_PATH,
  OVERLAY_PATH,
  PRESENCE_PATH,
  SESSIONS_PATH,
  STATE_PATH,
} from './shared/routes.ts'
import { collectTasks } from './host-services.ts'
import { openPetStore } from './pet-store.ts'

export const name = 'dsh-whale-girl'
export const inject = [
  HOST_SERVICES.webServer,
  HOST_SERVICES.settings,
  HOST_SERVICES.storageDomain,
  HOST_SERVICES.jobs,
  HOST_SERVICES.agents,
  HOST_SERVICES.sessions,
  HOST_SERVICES.sessionTitle,
] as const

const ConfigSchema = Schema.object({
  enabled: Schema.boolean().default(DEFAULTS.enabled),
  size: Schema.number().min(64).max(160).default(DEFAULTS.size),
  opacity: Schema.number().min(0.2).max(1).default(DEFAULTS.opacity),
  walk: Schema.object({
    enabled: Schema.boolean().default(DEFAULTS.walk.enabled),
    minWaitMs: Schema.number().min(0).max(300_000).default(DEFAULTS.walk.minWaitMs),
    maxWaitMs: Schema.number().min(0).max(300_000).default(DEFAULTS.walk.maxWaitMs),
    minMs: Schema.number().min(0).max(60_000).default(DEFAULTS.walk.minMs),
    maxMs: Schema.number().min(0).max(60_000).default(DEFAULTS.walk.maxMs),
    speedPxPerSec: Schema.number().min(10).max(300).default(DEFAULTS.walk.speedPxPerSec),
  }),
  sleepAfterMs: Schema.number().min(5_000).max(600_000).default(DEFAULTS.sleepAfterMs),
  pollMs: Schema.number().min(1_000).max(30_000).default(DEFAULTS.pollMs),
  bubbleMs: Schema.number().min(500).max(10_000).default(DEFAULTS.bubbleMs),
  welcomeMs: Schema.number().min(0).max(30_000).default(DEFAULTS.welcomeMs),
  celebrateMs: Schema.number().min(0).max(30_000).default(DEFAULTS.celebrateMs),
  errorMs: Schema.number().min(0).max(15_000).default(DEFAULTS.errorMs),
  disappointedMs: Schema.number().min(0).max(15_000).default(DEFAULTS.disappointedMs),
  replies: Schema.object({
    feed: Schema.array(Schema.string()).default([...DEFAULTS.replies.feed]),
    play: Schema.array(Schema.string()).default([...DEFAULTS.replies.play]),
  }),
})

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS_DIR = join(HERE, '..', 'assets')
const OVERLAY_HTML = join(HERE, 'overlay.html')
const OVERLAY_JS = join(HERE, 'overlay.js')

function headerMap(headers: IncomingMessage['headers']): Record<string, string | string[] | undefined> {
  return headers as Record<string, string | string[] | undefined>
}

async function readObjectBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | null> {
  try {
    const body = await readJsonBody(req, BODY_LIMIT)
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(res, 400, { error: 'body must be a JSON object' })
      return null
    }
    return body as Record<string, unknown>
  } catch (error) {
    sendJson(res, error instanceof HttpInputError ? error.status : 400, {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function sendFile(res: ServerResponse, file: string, type: string): void {
  if (!existsSync(file)) {
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(readFileSync(file))
}

export async function apply(ctx: Context): Promise<void> {
  const store = await openPetStore(ctx)
  ctx.effect(() => () => store.close(), 'dsh-whale-girl: pet store')
  let state = store.load()
  let configRef: WhaleGirlConfig = { ...DEFAULTS, walk: { ...DEFAULTS.walk }, replies: { feed: [...DEFAULTS.replies.feed], play: [...DEFAULTS.replies.play] } }
  let configRevision = 0
  const applyConfig = (next: WhaleGirlConfig) => {
    configRef = next
    configRevision += 1
  }

  let source = (): WhaleGirlConfig => configRef
  installSettingsSection(ctx, NAMESPACE as never, ConfigSchema, configRef, {
    setSource: (nextSource) => { source = nextSource as () => WhaleGirlConfig },
    onChange: () => {
      try {
        const next = source()
        validateConfig(next)
        applyConfig(next)
      } catch {
        // keep previous config
      }
    },
  })

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleSave = () => {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void store.save(state).catch(() => undefined), 1000)
  }

  const sseClients = new Set<ServerResponse>()
  const broadcastEvent = () => {
    const line = 'data: {"type":"event"}\n\n'
    for (const res of sseClients) {
      try { res.write(line) } catch { sseClients.delete(res) }
    }
  }

  const known = new Map<string, string>()
  let wasWorking = false
  let lastActiveCheck = Date.now()
  let errorUntil = 0
  let disappointedUntil = 0
  let welcomeUntil = 0
  let celebrateUntil = 0
  let companionUntil = 0
  let sessionThink = false
  let sessionWait = false
  let turnCompletedUntil = 0
  const activeTurns = new Map<string, number>()
  const sessionViews = new Map<string, SessionView>()

  const resolveSessionTitle = (s: Session): string | null => {
    const fromLog = titleFromLog(Array.isArray(s.events) ? s.events : [])
    if (fromLog !== null) return fromLog
    try {
      const snapshot = ctx.sessionTitle.get(s)
      return typeof snapshot?.title === 'string' && snapshot.title !== '' ? snapshot.title : null
    } catch {
      return null
    }
  }

  const sessionUpdate = () => {
    try {
      let thinking = false
      for (const session of ctx.sessions.list()) {
        if ((activeTurns.get(session.id) ?? 0) > 0) thinking = true
      }
      sessionThink = thinking
    } catch {
      // keep last
    }
  }

  const sessionsSnapshot = (): SessionView[] => {
    try {
        const live = new Set<string>()
        for (const session of ctx.sessions.list()) {
          const id = session.id
          live.add(id)
          const since = session.header.createdAt
          const title = resolveSessionTitle(session)
          const knownView = sessionViews.get(id)
          if (knownView === undefined) sessionViews.set(id, { id, title, activity: 'done', since })
          else if (knownView.title === null && title !== null) sessionViews.set(id, { ...knownView, title })
        }
        for (const id of sessionViews.keys()) if (!live.has(id)) sessionViews.delete(id)
    } catch {
      // keep event views
    }
    return [...sessionViews.values()]
  }

  const activity = () => {
    const now = Date.now()
    const tasks = collectTasks(ctx.jobs, ctx.agents)
    const derived = deriveActivity({ tasks, nowMs: now, known, wasWorking, errorMs: configRef.errorMs })
    wasWorking = derived.wasWorking
    if (derived.working) {
      state = recordActive(state, now - lastActiveCheck, now).state
      scheduleSave()
    }
    lastActiveCheck = now
    if (derived.burst?.name === 'error') {
      errorUntil = Math.max(errorUntil, derived.burst.until)
      disappointedUntil = Math.max(disappointedUntil, derived.burst.until + configRef.disappointedMs)
    }
    let name = derived.working ? 'working' : 'idle'
    let until = 0
    const burst = mergeCelebrate(derived.burst, celebrateUntil, now)
    if (burst !== null && burst.until > now) {
      name = burst.name
      until = burst.until
    }
    if (disappointedUntil > now) {
      name = 'disappointed'
      until = disappointedUntil
    }
    if (errorUntil > now) {
      name = 'error'
      until = errorUntil
    }
    if (welcomeUntil > now && errorUntil <= now && disappointedUntil <= now) {
      name = 'welcome'
      until = welcomeUntil
    }
    return {
      name,
      until,
      sessionThink,
      sessionWait,
      ...turnCompletionSnapshot(turnCompletedUntil, now),
    }
  }

  ctx.effect(() => ctx.jobs.onJobDone((snapshot) => {
      const now = Date.now()
      if (snapshot.status === 'completed') {
        const result = recordTaskCompleted(state, snapshot.label ?? '未命名任务', now)
        state = result.state
        celebrateUntil = Math.max(celebrateUntil, now + configRef.celebrateMs)
        scheduleSave()
      } else if (snapshot.status === 'failed') {
        state = recordFailure(state, now).state
        scheduleSave()
      }
      broadcastEvent()
    }), 'dsh-whale-girl: job done')

  ctx.on('agent/request-error', (_payload, next) => {
    const now = Date.now()
    errorUntil = Math.max(errorUntil, now + configRef.errorMs)
    disappointedUntil = Math.max(disappointedUntil, now + configRef.errorMs + configRef.disappointedMs)
    broadcastEvent()
    return next()
  })

  ctx.on('agent/session-start', (payload) => {
    const now = Date.now()
    const sourceKind = payload !== null && typeof payload === 'object' && typeof (payload as { source?: unknown }).source === 'string'
      ? (payload as { source: string }).source
      : undefined
    if (sourceKind === 'startup') {
      state = recordSession(state, now).state
      welcomeUntil = now + configRef.welcomeMs
    } else {
      state = recordSessionResume(state, now).state
    }
    scheduleSave()
    broadcastEvent()
  })

  ctx.on('session/event', (session, event) => {
    const id = session.id
    const knownView = sessionViews.get(id)
    const since = knownView?.since ?? session.header.createdAt
    const base = knownView ?? { ...createSessionView(id, since), title: null }
    const view = applySessionView(base, event)
    if (knownView === undefined || view !== knownView) sessionViews.set(id, view)
    const parsed = parseTurnEvent(event)
    if (parsed === null) return
    if (parsed.kind === 'start') {
      activeTurns.set(id, (activeTurns.get(id) ?? 0) + 1)
      sessionWait = false
      sessionUpdate()
    } else {
      const n = (activeTurns.get(id) ?? 0) - 1
      if (n <= 0) activeTurns.delete(id)
      else activeTurns.set(id, n)
      turnCompletedUntil = Math.max(turnCompletedUntil, Date.now() + TURN_COMPLETED_MS)
      sessionWait = parsed.blocked
      sessionUpdate()
    }
    broadcastEvent()
  })

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({
        kind: 'exact',
        path: STATE_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            sendJson(res, 405, { error: 'method not allowed; use GET' }, { allow: 'GET' })
            return
          }
          const act = activity()
          sendJson(res, 200, {
            apiVersion: SNAPSHOT_API_VERSION,
            pet: state,
            activity: act,
            configRevision,
            companionOnline: companionOnline(companionUntil, Date.now()),
          }, { 'cache-control': 'no-store' })
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: CONFIG_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            sendJson(res, 405, { error: 'method not allowed; use GET' }, { allow: 'GET' })
            return
          }
          sendJson(res, 200, { config: configRef, revision: configRevision }, { 'cache-control': 'no-store' })
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: INTERACT_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'method not allowed; use POST' }, { allow: 'POST' })
            return
          }
          if (isCrossOrigin(headerMap(req.headers), req.headers.host)) {
            sendJson(res, 403, { error: 'cross-origin request rejected' })
            return
          }
          const body = await readObjectBody(req, res)
          if (body === null) return
          const result = applyAction(state, body.action, configRef.replies)
          sendJson(res, result.status, result.body, { 'cache-control': 'no-store' })
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: PRESENCE_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'method not allowed; use POST' }, { allow: 'POST' })
            return
          }
          if (isCrossOrigin(headerMap(req.headers), req.headers.host)) {
            sendJson(res, 403, { error: 'cross-origin request rejected' })
            return
          }
          const body = await readObjectBody(req, res)
          if (body === null) return
          const online = body.online !== false
          companionUntil = pokePresence(companionUntil, Date.now(), online)
          sendJson(res, 200, { online: companionOnline(companionUntil, Date.now()) }, { 'cache-control': 'no-store' })
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: SESSIONS_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            sendJson(res, 405, { error: 'method not allowed; use GET' }, { allow: 'GET' })
            return
          }
          sendJson(res, 200, sessionsSnapshot(), { 'cache-control': 'no-store' })
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: OVERLAY_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405)
            res.end()
            return
          }
          sendFile(res, OVERLAY_HTML, 'text/html; charset=utf-8')
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: `${OVERLAY_PATH}.js`,
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405)
            res.end()
            return
          }
          sendFile(res, OVERLAY_JS, 'text/javascript; charset=utf-8')
        },
      }),
      ctx.webServer.register({
        kind: 'prefix',
        path: ASSETS_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405)
            res.end()
            return
          }
          let pathname: string
          try {
            pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://dsh.internal').pathname)
          } catch {
            res.writeHead(400)
            res.end()
            return
          }
          const rel = sanitizeAssetPath(pathname)
          if (rel === null) {
            res.writeHead(403)
            res.end()
            return
          }
          try {
            const data = readFileSync(join(ASSETS_DIR, rel))
            res.writeHead(200, {
              'content-type': contentTypeFor(rel),
              'cache-control': 'public, max-age=31536000, immutable',
            })
            res.end(data)
          } catch {
            res.writeHead(404)
            res.end()
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: EVENTS_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405)
            res.end()
            return
          }
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          })
          if (typeof res.flushHeaders === 'function') res.flushHeaders()
          res.write('retry: 3000\n\n')
          sseClients.add(res)
          let heartbeat: ReturnType<typeof setInterval> | null = null
          res.on('close', () => {
            if (heartbeat !== null) clearInterval(heartbeat)
            sseClients.delete(res)
          })
          heartbeat = setInterval(() => {
            try { res.write(': ping\n\n') } catch { /* closed */ }
          }, 25_000)
        },
      }),
    ]
    return () => {
      if (saveTimer !== null) clearTimeout(saveTimer)
      void store.save(state).catch(() => undefined)
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-whale-girl: routes')
}
