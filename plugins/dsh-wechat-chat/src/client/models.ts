export interface ModelPick {
  provider: string
  model: string
  name: string
  group: string
  reasoningEffort?: string
}

export interface ModelSnapshot {
  current: { provider: string; model: string; reasoningEffort?: string } | null
  groups: readonly {
    id: string
    name: string
    models: readonly {
      id: string
      name: string
      reasoning?: { defaultEffort?: string }
    }[]
  }[]
  status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
  error: string | null
}

export interface ModelDirectoryFace {
  load(): Promise<unknown>
  select(selection: { provider: string; model: string; reasoningEffort?: string }): Promise<void>
  readonly store: {
    getSnapshot(): ModelSnapshot
    subscribe(fn: () => void): () => void
  }
}

export const EMPTY_MODELS: ModelSnapshot = {
  current: null,
  groups: [],
  status: 'idle',
  error: null,
}

export function picksOf(state: ModelSnapshot): ModelPick[] {
  const picks: ModelPick[] = []
  for (const group of state.groups) {
    for (const model of group.models) {
      picks.push({
        provider: group.id,
        model: model.id,
        name: model.name || model.id,
        group: group.name || group.id,
        ...model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort },
      })
    }
  }
  return picks
}

export function labelOf(state: ModelSnapshot, fallback: string): string {
  const current = state.current
  if (!current) return fallback
  for (const group of state.groups) {
    if (group.id !== current.provider) continue
    const model = group.models.find((item) => item.id === current.model)
    if (model) return model.name || model.id
  }
  return current.model
}

export function samePick(pick: ModelPick, current: ModelSnapshot['current']): boolean {
  return current !== null && pick.provider === current.provider && pick.model === current.model
}
