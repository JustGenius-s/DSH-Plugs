// Host half of @just-genius/dsh-desktop-update.
//
// Owns the `desktop-update` settings namespace: two booleans gating the
// desktop bridge's background checks (App 本体 / DSH 运行时). Registration
// puts the values under standard schema validation in <DSH_HOME>/settings.yaml
// — DSH-Desktop's main process reads/writes that same section directly (the
// apiproxy settings.* whitelist is a hardcoded upstream constant, so this
// namespace never rides the generic settings RPC; the badge toggles go
// through the preload bridge instead).
//
// Update detection itself also lives in the main process (it already has the
// fetchers and, crucially, knows the App's own version); this half carries no
// checker. The badge subscribes to state over the preload bridge.

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'

export const name = 'desktop-update'

/** Settings namespace owned by this plugin. */
export const SETTINGS_NS = 'desktop-update'

/** User-togglable gates for the two background checks. */
export const Config = Schema.object({
  /** 自动检查 DSH-Desktop 本体更新（GitHub Releases）。 */
  checkApp: Schema.boolean().default(true),
  /** 自动检查 DSH 运行时更新（npm registry）。 */
  checkDsh: Schema.boolean().default(true),
})
export type Config = Schemastery.TypeT<typeof Config>

export function apply(ctx: Context) {
  installSettingsSection(ctx, SETTINGS_NS as never, Config, { checkApp: true, checkDsh: true }, {
    setSource: () => {},
    onChange: () => {},
  })
}
