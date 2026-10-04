import { formatLogs } from './ingest.ts'
import type { DebugLogEntry } from './shared.ts'

export const MAX_ARCHIVED_RUNS = 4

export interface DebugRun {
  id: string
  startedAt: number
  endedAt: number
  logs: DebugLogEntry[]
}

export interface RunState {
  runId: string | null
  logs: DebugLogEntry[]
  runs: DebugRun[]
}

export function nextRunId(runs: readonly DebugRun[], currentRunId?: string | null): string {
  const used = new Set(runs.map(run => run.id))
  if (currentRunId !== undefined && currentRunId !== null && currentRunId !== '') {
    used.add(currentRunId)
  }
  if (!used.has('pre-fix')) return 'pre-fix'
  if (!used.has('post-fix')) return 'post-fix'
  return `run-${runs.length + 1}`
}

export function archiveCurrentRun(state: RunState, endedAt = Date.now()): DebugRun | null {
  if (state.runId === null) return null
  const run: DebugRun = {
    id: state.runId,
    startedAt: state.logs[0]?.at ?? endedAt,
    endedAt,
    logs: state.logs.slice(),
  }
  state.runs = capRuns(upsertRun(state.runs, run))
  state.logs = []
  state.runId = null
  return run
}

export function startRun(state: RunState, runId?: string, startedAt = Date.now()): string {
  if (state.runId !== null) archiveCurrentRun(state, startedAt)
  const requested = runId?.trim() ?? ''
  const id = requested === '' ? nextRunId(state.runs) : requested
  state.runId = id
  return id
}

export function lastArchivedRun(state: Pick<RunState, 'runs'>): DebugRun | null {
  return state.runs[state.runs.length - 1] ?? null
}

export function formatCompareLogs(
  current: readonly DebugLogEntry[],
  previous: DebugRun | null,
): { logs: string; previousLogs: string; previousRunId: string } {
  return {
    logs: formatLogs(current),
    previousLogs: previous === null ? '' : formatLogs(previous.logs),
    previousRunId: previous?.id ?? '',
  }
}

function upsertRun(runs: readonly DebugRun[], run: DebugRun): DebugRun[] {
  return [...runs.filter(item => item.id !== run.id), run]
}

function capRuns(runs: readonly DebugRun[]): DebugRun[] {
  if (runs.length <= MAX_ARCHIVED_RUNS) return runs.slice()
  return runs.slice(runs.length - MAX_ARCHIVED_RUNS)
}
