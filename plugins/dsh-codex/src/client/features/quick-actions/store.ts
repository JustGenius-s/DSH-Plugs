export type QuickActionTarget = 'current' | 'new'

export interface QuickActionStep {
  command: string
  target: QuickActionTarget
}

export interface QuickAction {
  id: string
  name: string
  steps: QuickActionStep[]
}

export interface QuickActionsSnapshot {
  actions: readonly QuickAction[]
}

export interface QuickActionsStore {
  getSnapshot(): QuickActionsSnapshot
  subscribe(listener: () => void): () => void
  add(action: QuickAction): void
  update(action: QuickAction): void
  remove(id: string): void
}

const STORAGE_KEY = 'dsh-codex:quick-actions:v2'
const LEGACY_STORAGE_KEY = 'dsh-codex:quick-actions:v1'

function parseQuickActions(raw: string | null): QuickAction[] {
  if (raw === null) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isQuickAction).map(action => ({
      ...action,
      steps: action.steps.map(step => ({ ...step })),
    }))
  } catch {
    return []
  }
}

function readActions(): QuickAction[] {
  // Prefer the v2 store. When the v2 key is present we honor it even if it is an
  // empty array: it only becomes present once this version has written to it, so
  // an empty v2 means the user cleared their actions rather than "not migrated yet".
  const v2 = localStorage.getItem(STORAGE_KEY)
  if (v2 !== null) return parseQuickActions(v2)

  // No v2 data yet — migrate from the legacy v1 key, preserving action names.
  const migrated = migrateLegacyActions()
  writeActions(migrated)
  return migrated
}

function isQuickAction(value: unknown): value is QuickAction {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<QuickAction>
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && Array.isArray(candidate.steps)
    && candidate.steps.every(isQuickActionStep)
}

function isQuickActionStep(value: unknown): value is QuickActionStep {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<QuickActionStep>
  return typeof candidate.command === 'string'
    && (candidate.target === 'current' || candidate.target === 'new')
}

interface LegacyStep {
  type: 'create-terminal' | 'run-command'
  command?: string
  target?: string
}

function migrateLegacyActions(): QuickAction[] {
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
  if (raw === null) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap(value => {
      const migrated = migrateLegacyAction(value)
      return migrated ? [migrated] : []
    })
  } catch {
    return []
  }
}

function migrateLegacyAction(value: unknown): QuickAction | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as { id?: unknown; name?: unknown; steps?: unknown }
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return null
  if (!Array.isArray(candidate.steps)) return null

  const steps: QuickActionStep[] = []
  for (const step of candidate.steps) {
    if (typeof step !== 'object' || step === null) continue
    const legacy = step as Partial<LegacyStep>
    // 'run-command' -> { command, target: 'new' }; 'create-terminal' -> no step.
    // Empty/invalid commands are dropped.
    if (legacy.type === 'run-command'
      && typeof legacy.command === 'string'
      && legacy.command.trim() !== '') {
      steps.push({ command: legacy.command, target: 'new' })
    }
  }
  return { id: candidate.id, name: candidate.name, steps }
}

function writeActions(actions: readonly QuickAction[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(actions))
  } catch {
    // Keep the in-memory copy when storage is unavailable.
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'qa-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

export function createQuickActionsStore(): QuickActionsStore {
  let actions = readActions()
  let snapshot: QuickActionsSnapshot = { actions }
  const listeners = new Set<() => void>()
  const emit = (): void => {
    snapshot = { actions }
    writeActions(actions)
    for (const listener of [...listeners]) listener()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    add(action) {
      const id = action.id.trim() || newId()
      actions = [...actions, { ...action, id, steps: action.steps.map(step => ({ ...step })) }]
      emit()
    },
    update(action) {
      if (!actions.some(item => item.id === action.id)) return
      actions = actions.map(item => item.id === action.id
        ? { ...action, steps: action.steps.map(step => ({ ...step })) }
        : item)
      emit()
    },
    remove(id) {
      const next = actions.filter(action => action.id !== id)
      if (next.length === actions.length) return
      actions = next
      emit()
    },
  }
}

export function createQuickAction(name = ''): QuickAction {
  return {
    id: newId(),
    name,
    steps: [{ command: '', target: 'current' }],
  }
}
