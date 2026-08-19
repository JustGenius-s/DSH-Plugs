import { DEFAULTS, HEARTBEAT_MS, OVERLAY_ID, type WhaleGirlConfig } from '../shared/config.ts'
import {
  ASSETS_PATH,
  CONFIG_PATH,
  EVENTS_PATH,
  INTERACT_PATH,
  PRESENCE_PATH,
  STATE_PATH,
} from '../shared/routes.ts'
import { JOY_MS, TRANSIENT_MS, WAKE_MS, getCharacter, nextBlinkAt, nextFacingAt, nextWorkingRhythm, pickState, stateOf, wakeFromInteraction, type Character, type StateAnim } from '../shared/logic.ts'
import { bridge } from './bridge.ts'

interface Snapshot {
  pet?: { level?: number; stats?: { tasksDone?: number }; titles?: string[] }
  activity?: { name: string; until: number; sessionThink?: boolean; sessionWait?: boolean; turnCompletedUntil?: number }
  configRevision?: number
}

const OVERLAY = OVERLAY_ID
const overlays = () => bridge()?.overlays

async function postJson(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} ${res.status}`)
  return res.json()
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: 'no-store' })
  if (!res.ok) throw new Error(`${path} ${res.status}`)
  return res.json() as Promise<T>
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

const canvas = document.getElementById('pet') as HTMLCanvasElement
const bubble = document.getElementById('bubble') as HTMLElement
const badge = document.getElementById('badge') as HTMLElement
const maybeCtx = canvas.getContext('2d')
if (maybeCtx === null) throw new Error('no canvas')
const ctx: CanvasRenderingContext2D = maybeCtx

let manifest: unknown = null
let character: Character | null = null
let characterId = 'whale-girl'
const sheetCache = new Map<string, { img: HTMLImageElement; w: number; h: number; rendered?: boolean } | null>()
let animState = 'idle'
let frame = 0
let frameDir = 1
let lastFrameAt = 0
let blinkActive = false
let blinkAt = 0
let flip = 1
let facingAt = 0
let snapshot: Snapshot | null = null
let bubbleTimer: ReturnType<typeof setTimeout> | null = null
let config: WhaleGirlConfig = { ...DEFAULTS, walk: { ...DEFAULTS.walk }, replies: { feed: [...DEFAULTS.replies.feed], play: [...DEFAULTS.replies.play] } }
let lastConfigRevision = -1

const sched = {
  sleepAfterMs: config.sleepAfterMs,
  idleSince: 0,
  sleeping: false,
  joyUntil: 0,
  transient: null as string | null,
  transientUntil: 0,
  walking: false,
  nextWalkAt: 0,
  working: { active: false, until: 0 },
}

function applySize(size = config.size): void {
  canvas.width = size
  canvas.height = size
  canvas.style.width = `${size}px`
  canvas.style.height = `${size}px`
}

function sheetKey(sheet: string): string {
  return `${characterId}/${sheet}`
}

function framesOf(cfg: StateAnim): number {
  return typeof cfg.frames === 'number' && cfg.frames > 0 ? Math.floor(cfg.frames) : 1
}

async function ensureSheet(cfg: StateAnim): Promise<{ img: HTMLImageElement; w: number; h: number } | null> {
  const key = sheetKey(cfg.sheet)
  if (sheetCache.has(key)) return sheetCache.get(key) ?? null
  const res = await fetch(`${ASSETS_PATH}/characters/${characterId}/${cfg.sheet}`)
  if (!res.ok) {
    sheetCache.set(key, null)
    return null
  }
  const blob = await res.blob()
  const img = new Image()
  const url = URL.createObjectURL(blob)
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('sheet load failed'))
    img.src = url
  })
  const entry = { img, w: img.naturalWidth, h: img.naturalHeight }
  sheetCache.set(key, entry)
  return entry
}

function drawPlaceholder(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.font = `${Math.floor(canvas.width * 0.4)}px system-ui`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('🐳', 0, 0)
  ctx.restore()
}

function drawFrame(): void {
  const cfg = stateOf(character, animState)
  if (!cfg) return drawPlaceholder()
  const entry = sheetCache.get(sheetKey(cfg.sheet))
  if (!entry) return drawPlaceholder()
  const frameW = Math.floor(entry.w / framesOf(cfg))
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.scale(flip, 1)
  ctx.drawImage(entry.img, frame * frameW, 0, frameW, entry.h, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height)
  ctx.restore()
  entry.rendered = true
}

async function switchAnim(name: string): Promise<void> {
  if (name === animState) {
    const cfg = stateOf(character, name)
    if (cfg && !sheetCache.has(sheetKey(cfg.sheet))) {
      await ensureSheet(cfg)
      drawFrame()
      void reportHitarea()
    }
    return
  }
  animState = name
  frame = 0
  frameDir = 1
  blinkActive = false
  blinkAt = 0
  lastFrameAt = 0
  if (name === 'walk') {
    walkDir = Math.random() < 0.5 ? 1 : -1
    flip = -walkDir
  }
  applySize()
  const cfg = stateOf(character, name)
  if (!cfg) { drawPlaceholder(); return }
  await ensureSheet(cfg)
  drawFrame()
  void reportHitarea()
}

async function reportHitarea(): Promise<void> {
  const api = overlays()
  const cfg = stateOf(character, animState)
  const entry = cfg ? sheetCache.get(sheetKey(cfg.sheet)) : null
  if (!cfg || !entry || api === undefined) {
    await api?.setIgnoreMouseEvents(OVERLAY, true, { forward: true })
    return
  }
  const frameW = Math.floor(entry.w / framesOf(cfg))
  const off = document.createElement('canvas')
  off.width = frameW
  off.height = entry.h
  const octx = off.getContext('2d')
  if (octx === null) return
  octx.drawImage(entry.img, frame * frameW, 0, frameW, entry.h, 0, 0, frameW, entry.h)
  const data = octx.getImageData(0, 0, frameW, entry.h).data
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1
  for (let y = 0; y < entry.h; y++) {
    for (let x = 0; x < frameW; x++) {
      if (data[(y * frameW + x) * 4 + 3] > 24) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  // Empty sheet → click-through; otherwise the canvas itself is the hit target.
  await api.setIgnoreMouseEvents(OVERLAY, maxX < 0, { forward: true })
}

function tickFrame(now: number): void {
  const cfg = stateOf(character, animState)
  if (!cfg || !cfg.sheet || !(cfg.frames > 1)) return
  const step = () => {
    const entry = sheetCache.get(sheetKey(cfg.sheet))
    if (!entry) return
    const frames = framesOf(cfg)
    const frameW = Math.floor(entry.w / frames)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.scale(flip, 1)
    ctx.drawImage(entry.img, frame * frameW, 0, frameW, entry.h, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height)
    ctx.restore()
  }
  if (cfg.playback === 'blink') {
    if (blinkActive) {
      if (now - lastFrameAt >= 1000 / cfg.fps) {
        lastFrameAt = now
        frame += 1
        if (frame >= cfg.frames) { frame = 0; blinkActive = false; blinkAt = nextBlinkAt({ now }) }
        step()
      }
    } else {
      if (frame !== 0) { frame = 0; step() }
      if (blinkAt === 0) blinkAt = nextBlinkAt({ now })
      if (now >= blinkAt) blinkActive = true
    }
    return
  }
  if (now - lastFrameAt >= 1000 / (cfg.fps || 2)) {
    lastFrameAt = now
    frame += frameDir
    if (cfg.playback === 'pingpong') {
      if (frame >= cfg.frames - 1 || frame <= 0) frameDir *= -1
      frame = Math.max(0, Math.min(cfg.frames - 1, frame))
    } else if (frame >= cfg.frames) {
      if (cfg.playback === 'loop') frame = 0
      else frame = cfg.frames - 1
    }
    step()
  } else if (!sheetCache.get(sheetKey(cfg.sheet))?.rendered) {
    step()
  }
}

function tickFacing(now: number, cfg: StateAnim): void {
  if (animState === 'idle' || animState === 'think' || animState === 'wait') {
    if (facingAt === 0) facingAt = nextFacingAt({ now })
    if (now >= facingAt) {
      flip = -flip
      facingAt = nextFacingAt({ now })
      drawFrame()
    }
  } else if (facingAt !== 0) {
    facingAt = 0
  }
  void cfg
}

let walkDir = 0
let lastWalkStepAt = 0
function loop(now: number): void {
  const cfg = stateOf(character, animState)
  if (cfg) {
    tickFrame(now)
    tickFacing(now, cfg)
  }
  if (animState === 'walk' && walkDir !== 0 && now - lastWalkStepAt >= 50) {
    lastWalkStepAt = now
    const dx = Math.round(config.walk.speedPxPerSec * 0.05 * walkDir)
    void overlays()?.move(OVERLAY, { dx, dy: 0 }).then((hit) => {
      if (hit.hitEdge) { walkDir = -walkDir; flip = -flip; drawFrame() }
    })
  }
  requestAnimationFrame(loop)
}

function showBubble(text: string): void {
  bubble.textContent = text
  bubble.classList.add('show')
  if (bubbleTimer !== null) clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(() => bubble.classList.remove('show'), config.bubbleMs)
}

function renderBadge(): void {
  if (!snapshot) { badge.classList.remove('show'); return }
  const p = snapshot.pet
  const titles = p?.titles?.length ?? 0
  badge.textContent = `Lv.${p?.level ?? 1} · ${p?.stats?.tasksDone ?? 0} 任务` + (titles ? ` · ${titles} 称号` : '')
  if (snapshot.activity?.sessionThink) badge.textContent += ' · 思考中'
  badge.classList.add('show')
}

function stepScheduler(now: number): void {
  const act = snapshot?.activity ?? { name: 'idle', until: 0, sessionThink: false, sessionWait: false }
  if (sched.transient !== null && now >= sched.transientUntil) {
    const wasFun = sched.transient === 'eat' || sched.transient === 'play'
    sched.transient = null
    if (wasFun) sched.joyUntil = now + JOY_MS
  }
  const isActive = act.name !== 'idle' || act.until > now
  if (isActive) sched.idleSince = 0
  else if (sched.idleSince === 0) sched.idleSince = now
  sched.sleeping = act.name === 'idle' && sched.idleSince !== 0 && now - sched.idleSince > sched.sleepAfterMs
  if (act.sessionThink !== true) {
    if (sched.working.active || sched.working.until !== 0) sched.working = { active: false, until: 0 }
  } else if (sched.working.until === 0 || now >= sched.working.until) {
    sched.working = nextWorkingRhythm({ now, sessionThink: true, working: sched.working })
  }
  if (sched.walking) {
    if (now >= sched.nextWalkAt) {
      sched.walking = false
      sched.nextWalkAt = now + rand(config.walk.minWaitMs, config.walk.maxWaitMs)
    }
  } else if (!sched.sleeping && act.name === 'idle' && config.walk.enabled) {
    if (sched.nextWalkAt === 0) sched.nextWalkAt = now + rand(config.walk.minWaitMs, config.walk.maxWaitMs)
    if (now >= sched.nextWalkAt) {
      sched.walking = true
      sched.nextWalkAt = now + rand(config.walk.minMs, config.walk.maxMs)
    }
  } else {
    sched.nextWalkAt = 0
  }
}

function currentAnim(now = Date.now()): string {
  const act = snapshot?.activity ?? { name: 'idle', until: 0 }
  return pickState({
    activity: { name: act.name, until: act.until },
    dragging,
    walking: sched.walking,
    transient: sched.transient,
    sleeping: sched.sleeping,
    joyUntil: sched.joyUntil,
    now,
    sessionThink: act.sessionThink === true,
    sessionWait: act.sessionWait === true,
    workingActive: sched.working.active,
    celebrateUntil: act.turnCompletedUntil ?? 0,
  })
}

async function refresh(): Promise<void> {
  try {
    snapshot = await getJson<Snapshot>(STATE_PATH)
    if (typeof snapshot.configRevision === 'number' && snapshot.configRevision !== lastConfigRevision) {
      lastConfigRevision = snapshot.configRevision
      const body = await getJson<{ config?: WhaleGirlConfig }>(CONFIG_PATH)
      if (body.config) {
        config = body.config
        if (config.enabled === false) {
          void heartbeat(false)
          void overlays()?.close(OVERLAY)
          return
        }
        sched.sleepAfterMs = config.sleepAfterMs
        applySize(config.size)
      }
    }
    renderBadge()
  } catch {
    // keep last snapshot
  }
}

async function interact(action: 'feed' | 'play'): Promise<void> {
  const now = Date.now()
  const woke = wakeFromInteraction({ sleeping: sched.sleeping })
  sched.sleeping = woke.sleeping
  sched.idleSince = now
  sched.transient = action === 'play' ? 'play' : 'eat'
  sched.transientUntil = now + TRANSIENT_MS
  if (woke.wake) {
    sched.transient = 'wake'
    sched.transientUntil = now + WAKE_MS
  }
  try {
    const body = await postJson(INTERACT_PATH, { action }) as { reply?: string }
    if (typeof body.reply === 'string') showBubble(body.reply)
  } catch {
    // local animation still runs
  }
  void switchAnim(currentAnim(now))
}

async function heartbeat(online: boolean): Promise<void> {
  try { await postJson(PRESENCE_PATH, { online }) } catch { /* ignore */ }
}

let dragging = false
let lastEngineAnim = 'idle'
let dragStart: { x: number; y: number; moved: boolean; px: number; py: number } | null = null

canvas.addEventListener('pointerdown', (e) => {
  dragStart = { x: e.screenX, y: e.screenY, moved: false, px: e.screenX, py: e.screenY }
  canvas.setPointerCapture(e.pointerId)
})
canvas.addEventListener('pointermove', (e) => {
  if (!dragStart) return
  const dx = e.screenX - dragStart.x
  const dy = e.screenY - dragStart.y
  if (!dragStart.moved && Math.hypot(dx, dy) > 6) {
    dragStart.moved = true
    dragStart.px = e.screenX
    dragStart.py = e.screenY
    dragging = true
    lastEngineAnim = animState
    void switchAnim('drag')
  }
  if (dragStart.moved) {
    const ddx = e.screenX - dragStart.px
    const ddy = e.screenY - dragStart.py
    if (ddx !== 0 || ddy !== 0) {
      const nextFlip = ddx < 0 ? 1 : -1
      if (nextFlip !== flip) {
        flip = nextFlip
        drawFrame()
        void reportHitarea()
      }
      void overlays()?.move(OVERLAY, { dx: ddx, dy: ddy })
      dragStart.px = e.screenX
      dragStart.py = e.screenY
    }
  }
})
canvas.addEventListener('pointerup', () => {
  if (dragStart && !dragStart.moved) {
    const action = sessionStorage.getItem('wg:lastAction') === 'feed' ? 'play' : 'feed'
    sessionStorage.setItem('wg:lastAction', action)
    void interact(action)
  }
  if (dragging) {
    dragging = false
    const woke = wakeFromInteraction({ sleeping: sched.sleeping })
    sched.sleeping = woke.sleeping
    sched.idleSince = Date.now()
    void switchAnim(lastEngineAnim)
  }
  dragStart = null
})

setInterval(() => {
  const now = Date.now()
  stepScheduler(now)
  if (!dragging) void switchAnim(currentAnim(now))
}, 250)

void (async () => {
  applySize()
  manifest = await getJson(`${ASSETS_PATH}/manifest.json`)
  const parsed = getCharacter(manifest, (manifest as { default?: string })?.default ?? characterId)
  if (parsed) {
    character = parsed
    characterId = parsed.id
  }
  await refresh()
  await heartbeat(true)
  await switchAnim(currentAnim())
  requestAnimationFrame(loop)
  setInterval(() => { void refresh() }, config.pollMs)
  setInterval(() => { void heartbeat(true) }, HEARTBEAT_MS)
  try {
    const sse = new EventSource(EVENTS_PATH)
    sse.onmessage = () => { void refresh() }
  } catch { /* poll fallback */ }
  window.addEventListener('pagehide', () => { void heartbeat(false) })
})()
