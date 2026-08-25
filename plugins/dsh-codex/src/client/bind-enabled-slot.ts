import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../shared/config'

/** Register a settings-gated slot only when the enabled bit actually flips. */
export function bindEnabledSlot(
  scope: SettingsScope<DshCodexConfig>,
  isEnabled: (config: DshCodexConfig) => boolean,
  register: () => () => void,
): () => void {
  let disposeEntry: (() => void) | undefined
  let registered: boolean | undefined

  const sync = (): void => {
    const enabled = isEnabled({ ...DEFAULT_CONFIG, ...scope.getSnapshot().value })
    if (enabled === registered) return
    disposeEntry?.()
    disposeEntry = undefined
    registered = enabled
    if (!enabled) return
    disposeEntry = register()
  }

  sync()
  const unsubscribe = scope.subscribe(sync)
  return () => {
    unsubscribe()
    disposeEntry?.()
    disposeEntry = undefined
    registered = undefined
  }
}
