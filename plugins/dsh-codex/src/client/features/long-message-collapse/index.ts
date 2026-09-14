import type { ClientContext, SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import type { DshCodexConfig } from '../../../shared/config'
import { bindEnabledSlot } from '../../bind-enabled-slot'
import type { CodexFeature } from '../../core/feature-manager'
import type { CodexKey } from '../../locales'
import { startLongMessageCollapse } from './controller'

export function createLongMessageCollapseFeature(
  _ctx: ClientContext,
  scope: SettingsScope<DshCodexConfig>,
  t: (key: CodexKey) => string,
): CodexFeature {
  return {
    id: 'long-message-collapse',
    activate() {
      return bindEnabledSlot(
        scope,
        config => config.longMessageCollapseEnabled,
        () => startLongMessageCollapse(t),
      )
    },
  }
}
