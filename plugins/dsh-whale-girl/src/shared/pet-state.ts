import { ASSETS_PATH } from './routes.ts'

export interface PetStats {
  tasksDone: number
  failures: number
  sessions: number
  activeMs: number
  firstSeenAt: number | null
}

export interface PetState {
  level: number
  xp: number
  stats: PetStats
  titles: string[]
  memory: string[]
  updatedAt: number
}

export interface CommitResult {
  state: PetState
  unlocked: string[]
  leveledUp: boolean
}

export const INITIAL_STATE: PetState = Object.freeze({
  level: 1,
  xp: 0,
  stats: { tasksDone: 0, failures: 0, sessions: 0, activeMs: 0, firstSeenAt: null },
  titles: [],
  memory: [],
  updatedAt: 0,
})

export const MEMORY_MAX = 8
export const TASK_XP = 10
export const SESSION_XP = 5
export const RESUME_XP = 2
export const ACTIVE_CAP_MS = 5 * 60_000
export const MAX_LEVEL = 20
/** Soft storage cap; level itself hard-stops at MAX_LEVEL. */
export const XP_CAP = 1e12
const XP_SAFE_MAX = 1e15

/**
 * Cumulative XP required to *reach* `level` (floor of that level).
 * Harder curve than the old linear `50·n` steps: cost to go from n → n+1
 * is `20·n·(n+1)`, so mid/late levels ramp up sharply toward the Lv.20 cap.
 *
 *   Lv.1→2: 40 · Lv.5→6: 600 · Lv.10→11: 2200 · Lv.19→20: 7600
 *   Total to max: 53_200 XP (≈ 5_320 completed tasks at TASK_XP).
 */
export function xpForLevel(level: number): number {
  const L = Math.max(1, Math.floor(level))
  if (L <= 1) return 0
  // (20/3)·L·(L²−1); always integer because L−1,L,L+1 include a multiple of 3.
  return (20 * L * (L * L - 1)) / 3
}

export function levelFor(xp: number): number {
  const xpSafe = Math.max(0, Math.min(xp, XP_SAFE_MAX))
  let level = 1
  while (level < MAX_LEVEL && xpSafe >= xpForLevel(level + 1)) level += 1
  return level
}

/** Progress within the current level: floor XP → next level (full bar at max). */
export function xpProgress(xp: number): {
  level: number
  into: number
  need: number
  ratio: number
  maxed: boolean
} {
  const xpSafe = Math.max(0, Math.min(Math.floor(xp), XP_CAP))
  const level = levelFor(xpSafe)
  if (level >= MAX_LEVEL) {
    return { level: MAX_LEVEL, into: 0, need: 0, ratio: 1, maxed: true }
  }
  const floor = xpForLevel(level)
  const ceil = xpForLevel(level + 1)
  const need = Math.max(1, ceil - floor)
  const into = Math.max(0, Math.min(xpSafe - floor, need))
  return { level, into, need, ratio: into / need, maxed: false }
}

/**
 * Temperature-scale fill strip for the current XP ratio.
 * Cool (blue) → warm (gold) → hot (red) as the bar fills.
 */
export function xpFillAsset(ratio: number): string {
  const r = Math.max(0, Math.min(1, ratio))
  if (r < 0.2) return 'game_hud_bar_mp.png'
  if (r < 0.4) return 'game_hud_bar_hp.png'
  if (r < 0.6) return 'game_hud_bar_exp.png'
  if (r < 0.8) return 'game_hud_bar_hp_oran.png'
  return 'game_hud_bar_hp_red.png'
}

export function hudUrl(name: string): string {
  return `${ASSETS_PATH}/hud/${name}`
}

type TitleWhen = (stats: PetStats, level: number) => boolean

export interface TitleDef {
  id: string
  name: string
  /** One-line unlock condition / flavour for hover tooltip. */
  description: string
  /** Filename under assets/hud/ (E7 badge icons). */
  icon: string
  when: TitleWhen
}

export const TITLES: ReadonlyArray<TitleDef> = [
  {
    id: 'first-task',
    name: '初次协作',
    description: '完成第 1 个后台任务',
    icon: 'guidequest_group_01.png',
    when: (s) => s.tasksDone >= 1,
  },
  {
    id: 'helper',
    name: '勤劳伙伴',
    description: '累计完成 20 个任务',
    icon: 'guidequest_group_02.png',
    when: (s) => s.tasksDone >= 20,
  },
  {
    id: 'veteran',
    name: '百炼成钢',
    description: '累计完成 100 个任务',
    icon: 'guidequest_group_03.png',
    when: (s) => s.tasksDone >= 100,
  },
  {
    id: 'regular',
    name: '常驻伙伴',
    description: '陪伴时长累计 6 小时',
    icon: 'guidequest_group_04.png',
    when: (s) => s.activeMs >= 6 * 3_600_000,
  },
  {
    id: 'resilient',
    name: '越挫越勇',
    description: '经历 5 次任务失败仍继续',
    icon: 'guidequest_group_05.png',
    when: (s) => s.failures >= 5,
  },
  {
    id: 'social',
    name: '广结善缘',
    description: '开启过 10 个会话',
    icon: 'guidequest_group_06.png',
    when: (s) => s.sessions >= 10,
  },
  {
    id: 'maxed',
    name: '满级伙伴',
    description: `升到满级 Lv.${MAX_LEVEL}`,
    icon: 'guidequest_group_07.png',
    when: (_s, level) => level >= MAX_LEVEL,
  },
]

export function titleDef(id: string): TitleDef | undefined {
  return TITLES.find((t) => t.id === id)
}

export function titleName(id: string): string {
  return titleDef(id)?.name ?? id
}

export function titleDescription(id: string): string {
  return titleDef(id)?.description ?? ''
}

export function titleIcon(id: string): string {
  return titleDef(id)?.icon ?? 'guidequest_group_01.png'
}

function stamp(nowMs: number): string {
  const d = new Date(nowMs)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

function truncate(label: string, max = 14): string {
  return label.length > max ? `${label.slice(0, max)}…` : label
}

function checkTitles(stats: PetStats, titles: string[], level: number): Array<(typeof TITLES)[number]> {
  return TITLES.filter((t) => !titles.includes(t.id) && t.when(stats, level))
}

function commit(
  state: PetState,
  patch: Partial<PetStats>,
  nowMs: number,
  entry: string | null,
  xpGain = 0,
): CommitResult {
  const stats = { ...state.stats, ...patch }
  // Cap stored XP at the max-level floor so the bar stays full once capped.
  const xp = Math.min(state.xp + xpGain, xpForLevel(MAX_LEVEL))
  const level = levelFor(xp)
  const leveledUp = level > state.level
  const unlocked = checkTitles(stats, state.titles, level)
  const titles = unlocked.length ? [...state.titles, ...unlocked.map((t) => t.id)] : state.titles
  const memory = [...state.memory]
  if (entry) memory.push(`[${stamp(nowMs)}] ${entry}`)
  if (leveledUp) {
    memory.push(
      level >= MAX_LEVEL
        ? `[${stamp(nowMs)}] 升到 Lv.${MAX_LEVEL}（满级）🎉`
        : `[${stamp(nowMs)}] 升到 Lv.${level} 🎉`,
    )
  }
  return {
    state: { ...state, stats, xp, level, titles, memory: memory.slice(-MEMORY_MAX), updatedAt: nowMs },
    unlocked: unlocked.map((t) => t.name),
    leveledUp,
  }
}

export function recordTaskCompleted(state: PetState, taskLabel: string, nowMs: number): CommitResult {
  const n = state.stats.tasksDone + 1
  return commit(state, { tasksDone: n }, nowMs, `完成任务「${truncate(taskLabel)}」（第 ${n} 个）`, TASK_XP)
}

export function recordFailure(state: PetState, nowMs: number): CommitResult {
  const n = state.stats.failures + 1
  return commit(state, { failures: n }, nowMs, `任务失败（第 ${n} 次）——没关系，再来`)
}

export function recordSession(state: PetState, nowMs: number): CommitResult {
  const n = state.stats.sessions + 1
  return commit(
    state,
    { sessions: n, firstSeenAt: state.stats.firstSeenAt ?? nowMs },
    nowMs,
    `新会话开启（第 ${n} 个）`,
    SESSION_XP,
  )
}

export function recordSessionResume(state: PetState, nowMs: number): CommitResult {
  return commit(state, {}, nowMs, '回到旧会话，继续陪伴', RESUME_XP)
}

export function recordActive(state: PetState, elapsedMs: number, nowMs: number): CommitResult {
  const capped = Math.min(Math.max(0, elapsedMs), ACTIVE_CAP_MS)
  return commit(state, { activeMs: state.stats.activeMs + capped }, nowMs, null)
}

const KNOWN_TITLES: Set<string> = new Set(TITLES.map((t) => t.id))

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : NaN
}

function int(v: unknown, lo = 0): number {
  const n = num(v)
  return Number.isFinite(n) ? Math.max(lo, Math.floor(n)) : lo
}

export function normalizeState(saved: unknown): PetState | null {
  if (typeof saved !== 'object' || saved === null) return null
  const obj = saved as Record<string, unknown>
  const xpRaw = num(obj.xp)
  if (!Number.isFinite(xpRaw)) return null
  const xp = Math.max(0, Math.floor(Math.min(xpRaw, XP_CAP)))
  const statsRaw = (obj.stats ?? {}) as Record<string, unknown>
  const stats: PetStats = {
    ...INITIAL_STATE.stats,
    tasksDone: int(statsRaw.tasksDone),
    failures: int(statsRaw.failures),
    sessions: int(statsRaw.sessions),
    activeMs: num(statsRaw.activeMs) > 0 ? (statsRaw.activeMs as number) : 0,
    firstSeenAt: num(statsRaw.firstSeenAt) || null,
  }
  const titles = [...new Set(Array.isArray(obj.titles)
    ? obj.titles.filter((t): t is string => typeof t === 'string' && KNOWN_TITLES.has(t))
    : [])]
  const memory = Array.isArray(obj.memory)
    ? obj.memory.filter((m): m is string => typeof m === 'string').slice(-MEMORY_MAX)
    : []
  const updatedAt = num(obj.updatedAt)
  const xpClamped = Math.min(xp, xpForLevel(MAX_LEVEL))
  const level = levelFor(xpClamped)
  for (const t of checkTitles(stats, titles, level)) {
    if (!titles.includes(t.id)) titles.push(t.id)
  }
  return {
    ...INITIAL_STATE,
    xp: xpClamped,
    level,
    stats,
    titles,
    memory,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  }
}

export function serializeState(state: PetState): string {
  return JSON.stringify(state)
}
