import type { SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import type {
  DshCodexConfig,
  QuickAction,
  QuickActionStep,
  QuickActionTarget,
} from '../../../shared/config'
import { createSnapshotChannel } from '../../core/observable'

export type { QuickAction, QuickActionStep, QuickActionTarget }

export interface QuickActionsSnapshot {
  actions: readonly QuickAction[]
}

export interface QuickActionsStore {
  getSnapshot(): QuickActionsSnapshot
  subscribe(listener: () => void): () => void
  add(action: QuickAction): Promise<void>
  update(action: QuickAction): Promise<void>
  remove(id: string): Promise<void>
  dispose(): void
}

const EMPTY_ACTIONS: readonly QuickAction[] = []

export function createQuickActionsStore(
  scope: SettingsScope<DshCodexConfig>,
): QuickActionsStore {
  // A stable snapshot is essential: useSyncExternalStore re-renders whenever
  // getSnapshot() returns a different reference, so during settings loading
  // (value undefined) a freshly built `{actions: []}` would loop forever and
  // take the whole side-panel shell down with it.
  const channel = createSnapshotChannel<QuickActionsSnapshot>({
    actions: scope.getSnapshot().value?.quickActions ?? EMPTY_ACTIONS,
  })

  const recompute = (): void => {
    const actions = scope.getSnapshot().value?.quickActions ?? EMPTY_ACTIONS
    if (actions === channel.getSnapshot().actions) return
    channel.publish({ actions })
  }
  const unsubscribeScope = scope.subscribe(recompute)

  const current = (): readonly QuickAction[] => channel.getSnapshot().actions

  return {
    getSnapshot: channel.getSnapshot,
    subscribe: channel.subscribe,
    add(action) {
      const id = action.id.trim() || newId()
      return scope.set('quickActions', [
        ...current(),
        { ...action, id, steps: action.steps.map(step => ({ ...step })) },
      ])
    },
    update(action) {
      const next = current().map(item => item.id === action.id
        ? { ...action, steps: action.steps.map(step => ({ ...step })) }
        : item)
      return scope.set('quickActions', next)
    },
    remove(id) {
      return scope.set('quickActions', current().filter(action => action.id !== id))
    },
    dispose() {
      unsubscribeScope()
      channel.dispose()
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
