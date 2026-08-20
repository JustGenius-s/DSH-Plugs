// Host half of @just-genius/dsh-desktop-update.
//
// Owns the `desktop-update` settings namespace: two booleans gating the
// desktop bridge's background checks (App 本体 / DSH 运行时). Registration
// puts the values under standard schema validation in <DSH_HOME>/settings.yaml.
// Since DSH rc.7 the api-proxy serves every registered namespace, so the
// settings card edits these gates through the generic settings RPC;
// DSH-Desktop's main process watches the same settings.yaml section, and
// both write paths converge on the one document.
//
// Update detection itself lives in the main process (it already has the
// fetchers and, crucially, knows the App's own version); this half carries
// no checker. The card reads version state over the preload bridge.

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
  /** DSH 运行时更新渠道：npm dist-tag（latest/next）或按精确版本（custom）。 */
  dshChannel: Schema.union([
    Schema.const('latest' as const),
    Schema.const('next' as const),
    Schema.const('custom' as const),
  ]).default('latest' as const),
  /** dshChannel === 'custom' 时匹配的精确版本。 */
  dshVersion: Schema.string().default(''),
})
export type Config = Schemastery.TypeT<typeof Config>

export function apply(ctx: Context) {
  installSettingsSection(ctx, SETTINGS_NS as never, Config, {
    checkApp: true,
    checkDsh: true,
    dshChannel: 'latest',
    dshVersion: '',
  }, {
    setSource: () => {},
    onChange: () => {},
  })
}
