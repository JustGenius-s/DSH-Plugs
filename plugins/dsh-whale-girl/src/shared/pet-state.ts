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
export const XP_CAP = 1e12
const XP_SAFE_MAX = 1e15

export function xpForLevel(level: number): number {
  return (50 * level * (level - 1)) / 2
}

export function levelFor(xp: number): number {
  const xpSafe = Math.max(0, Math.min(xp, XP_SAFE_MAX))
  return Math.floor((1 + Math.sqrt(1 + (4 * xpSafe) / 25)) / 2)
}

export const TITLES = [
  { id: 'first-task', name: '初次协作', when: (s: PetStats) => s.tasksDone >= 1 },
  { id: 'helper', name: '勤劳伙伴', when: (s: PetStats) => s.tasksDone >= 20 },
  { id: 'veteran', name: '百炼成钢', when: (s: PetStats) => s.tasksDone >= 100 },
  { id: 'regular', name: '常驻伙伴', when: (s: PetStats) => s.activeMs >= 6 * 3_600_000 },
  { id: 'resilient', name: '越挫越勇', when: (s: PetStats) => s.failures >= 5 },
  { id: 'social', name: '广结善缘', when: (s: PetStats) => s.sessions >= 10 },
] as const

export function titleName(id: string): string {
  return TITLES.find((t) => t.id === id)?.name ?? id
}

function stamp(nowMs: number): string {
  const d = new Date(nowMs)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

function truncate(label: string, max = 14): string {
  return label.length > max ? `${label.slice(0, max)}…` : label
}

function checkTitles(stats: PetStats, titles: string[]): Array<(typeof TITLES)[number]> {
  return TITLES.filter((t) => !titles.includes(t.id) && t.when(stats))
}

function commit(
  state: PetState,
  patch: Partial<PetStats>,
  nowMs: number,
  entry: string | null,
  xpGain = 0,
): CommitResult {
  const stats = { ...state.stats, ...patch }
  const xp = state.xp + xpGain
  const level = levelFor(xp)
  const leveledUp = level > state.level
  const unlocked = checkTitles(stats, state.titles)
  const titles = unlocked.length ? [...state.titles, ...unlocked.map((t) => t.id)] : state.titles
  const memory = [...state.memory]
  if (entry) memory.push(`[${stamp(nowMs)}] ${entry}`)
  if (leveledUp) memory.push(`[${stamp(nowMs)}] 升到 Lv.${level} 🎉`)
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
  return {
    ...INITIAL_STATE,
    xp,
    level: levelFor(xp),
    stats,
    titles,
    memory,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  }
}

export function serializeState(state: PetState): string {
  return JSON.stringify(state)
}
