import { PRESENCE_TTL_MS } from './config.ts'

export const BURST_MS = 6_000
export const SNAPSHOT_API_VERSION = 1
export const TURN_COMPLETED_MS = 4_000

export type BurstName = 'celebrate' | 'error'
export interface Burst {
  name: BurstName
  until: number
}

export interface TaskSnapshot {
  id: string
  status: string
  label?: string
}

export function turnCompletionSnapshot(until: number, nowMs: number): { turnCompleted: boolean; turnCompletedUntil: number } {
  const safeUntil = Number.isFinite(until) && until > 0 ? until : 0
  return { turnCompleted: safeUntil > nowMs, turnCompletedUntil: safeUntil }
}

function betterBurst(a: Burst | null, b: Burst): Burst {
  if (a === null) return b
  return b.until > a.until ? b : a
}

export function mergeCelebrate(burst: Burst | null, celebrateUntil: number, nowMs: number): Burst | null {
  if (celebrateUntil <= nowMs) return burst
  if (burst !== null && burst.name === 'error') return burst
  if (burst === null || celebrateUntil > burst.until) return { name: 'celebrate', until: celebrateUntil }
  return burst
}

export function deriveActivity(input: {
  tasks: TaskSnapshot[]
  nowMs: number
  known?: Map<string, string>
  wasWorking?: boolean
  errorMs?: number
}): {
  working: boolean
  burst: Burst | null
  completed: string[]
  failed: string[]
  known: Map<string, string>
  wasWorking: boolean
} {
  const { tasks, nowMs, known = new Map(), wasWorking = false, errorMs = BURST_MS } = input
  if (tasks.length === 0) known.clear()
  const running = tasks.filter((t) => t.status === 'running' || t.status === 'stopping')
  const working = running.length > 0
  let burst: Burst | null = null
  const completed: string[] = []
  const failed: string[] = []
  let sawKill = false
  for (const t of tasks) {
    const prev = known.get(t.id)
    if (prev === 'running' && t.status === 'completed') {
      completed.push(t.id)
      burst = betterBurst(burst, { name: 'celebrate', until: nowMs + BURST_MS })
    } else if (prev === 'running' && t.status === 'failed') {
      failed.push(t.id)
      burst = betterBurst(burst, { name: 'error', until: nowMs + errorMs })
    } else if (prev === 'running' && t.status === 'killed') {
      sawKill = true
    }
    known.set(t.id, t.status)
  }
  if (wasWorking && !working && !sawKill) {
    burst = betterBurst(burst, { name: 'celebrate', until: nowMs + BURST_MS })
  }
  if (tasks.length > 0) {
    const ids = new Set(tasks.map((t) => t.id))
    for (const key of known.keys()) if (!ids.has(key)) known.delete(key)
  }
  return { working, burst, completed, failed, known, wasWorking: working }
}

export function pokePresence(companionUntil: number, nowMs: number, online = true): number {
  return online ? nowMs + PRESENCE_TTL_MS : 0
}

export function companionOnline(companionUntil: number, nowMs: number): boolean {
  return companionUntil > nowMs
}
