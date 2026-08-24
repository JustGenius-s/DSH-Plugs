import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  DshCodexConfig,
  QuickAction,
  QuickActionStep,
  QuickActionTarget,
} from '../../../shared/config'

export type { QuickAction, QuickActionStep, QuickActionTarget }

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

const EMPTY_ACTIONS: readonly QuickAction[] = []

export function createQuickActionsStore(
  scope: SettingsScope<DshCodexConfig>,
): QuickActionsStore {
  const listeners = new Set<() => void>()
  // A stable snapshot is essential: useSyncExternalStore re-renders whenever
  // getSnapshot() returns a different reference, so during settings loading
  // (value undefined) a freshly built `{actions: []}` would loop forever and
  // take the whole side-panel shell down with it.
  let snapshot: QuickActionsSnapshot = {
    actions: scope.getSnapshot().value?.quickActions ?? EMPTY_ACTIONS,
  }

  const recompute = (): void => {
    const actions = scope.getSnapshot().value?.quickActions ?? EMPTY_ACTIONS
    if (actions === snapshot.actions) return
    snapshot = { actions }
    for (const listener of [...listeners]) listener()
  }
  const unsubscribeScope = scope.subscribe(recompute)

  const current = (): readonly QuickAction[] => snapshot.actions

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    add(action) {
      const id = action.id.trim() || newId()
      void scope.set('quickActions', [
        ...current(),
        { ...action, id, steps: action.steps.map(step => ({ ...step })) },
      ])
    },
    update(action) {
      const next = current().map(item => item.id === action.id
        ? { ...action, steps: action.steps.map(step => ({ ...step })) }
        : item)
      void scope.set('quickActions', next)
    },
    remove(id) {
      void scope.set('quickActions', current().filter(action => action.id !== id))
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

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'qa-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}
