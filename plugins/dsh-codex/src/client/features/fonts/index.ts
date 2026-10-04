import type { SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import type { DshCodexConfig } from '../../../shared/config'
import type { CodexFeature } from '../../core/feature-manager'
import { bindFontPreferences } from './controller'

export function createFontsFeature(scope: SettingsScope<DshCodexConfig>): CodexFeature {
  return {
    id: 'fonts',
    activate() {
      const root = document.documentElement
      return bindFontPreferences(scope, root.style, property => getComputedStyle(root).getPropertyValue(property))
    },
  }
}
