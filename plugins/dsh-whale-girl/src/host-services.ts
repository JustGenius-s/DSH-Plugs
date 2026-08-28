import type { AgentRegistry } from '@just-genius/dsh-plugin-runtime/host'
import type { JobRegistry } from '@just-genius/dsh-plugin-runtime/host'

export interface TaskView {
  id: string
  status: string
  label?: string
}

export function collectTasks(jobs: JobRegistry, agents: AgentRegistry): TaskView[] {
  const seen = new Set<string>()
  const tasks: TaskView[] = []
  for (const agent of agents.list()) append(jobs.list(agent), seen, tasks)
  append(jobs.list(), seen, tasks)
  return tasks
}

function append(
  snapshots: ReturnType<JobRegistry['list']>,
  seen: Set<string>,
  tasks: TaskView[],
): void {
  for (const snapshot of snapshots) {
    if (seen.has(snapshot.id)) continue
    seen.add(snapshot.id)
    tasks.push({ id: snapshot.id, status: snapshot.status, label: snapshot.label })
  }
}
