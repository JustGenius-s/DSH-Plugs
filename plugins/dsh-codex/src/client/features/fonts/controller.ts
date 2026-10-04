import type { SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import type { DshCodexConfig } from '../../../shared/config'
import { CODE_FONT_FALLBACK, UI_FONT_FALLBACK, fontFamilyStack, type FontPreferenceKey } from '../../../shared/fonts'

export type FontStyleTarget = Pick<CSSStyleDeclaration, 'getPropertyValue' | 'getPropertyPriority' | 'setProperty' | 'removeProperty'>

const PROPERTIES = [
  { field: 'uiFontFamily', property: '--dsw-font-family', fallback: UI_FONT_FALLBACK },
  { field: 'codeFontFamily', property: '--ds-font-family-code', fallback: CODE_FONT_FALLBACK },
] as const

/** Keep accepted preferences live and restore only the overrides this owner still holds. */
export function bindFontPreferences(
  scope: Pick<SettingsScope<DshCodexConfig>, 'getSnapshot' | 'subscribe'>,
  style: FontStyleTarget,
  readDefault: (property: string) => string,
): () => void {
  const overrides = new Map<string, { previous: string; priority: string; fallback: string; applied: string }>()
  const release = (property: string): void => {
    const owned = overrides.get(property)
    if (owned === undefined) return
    if (style.getPropertyValue(property) === owned.applied && style.getPropertyPriority(property) === '') {
      if (owned.previous === '') style.removeProperty(property)
      else style.setProperty(property, owned.previous, owned.priority)
    }
    overrides.delete(property)
  }
  const sync = (): void => {
    const snapshot = scope.getSnapshot()
    for (const { field, property, fallback } of PROPERTIES) {
      const preference = snapshot.status === 'unavailable' ? '' : snapshot.value?.[field]?.trim() ?? ''
      if (preference === '') {
        release(property)
        continue
      }
      let owned = overrides.get(property)
      if (owned === undefined) {
        owned = {
          previous: style.getPropertyValue(property),
          priority: style.getPropertyPriority(property),
          fallback: readDefault(property).trim() || fallback,
          applied: '',
        }
        overrides.set(property, owned)
      }
      let next = fontFamilyStack(preference, owned.fallback)
      if (next === owned.applied) continue
      if (owned.applied !== '' && (style.getPropertyValue(property) !== owned.applied || style.getPropertyPriority(property) !== '')) {
        owned.previous = style.getPropertyValue(property)
        owned.priority = style.getPropertyPriority(property)
        owned.fallback = readDefault(property).trim() || fallback
        next = fontFamilyStack(preference, owned.fallback)
      }
      style.setProperty(property, next)
      owned.applied = style.getPropertyValue(property)
    }
  }
  const unsubscribe = scope.subscribe(sync)
  sync()
  return () => {
    unsubscribe()
    for (const property of overrides.keys()) release(property)
  }
}

/** The compatibility scope's void result must not turn a rejected write into success. */
export async function saveFontPreference(
  scope: SettingsScope<DshCodexConfig>,
  field: FontPreferenceKey,
  input: string,
): Promise<void> {
  const snapshot = scope.getSnapshot()
  if (snapshot.status !== 'ready' || !snapshot.writable) throw new Error('Font settings are not writable')
  const value = input.trim()
  if ((snapshot.value?.[field] ?? '') === value) return
  await scope.set(field, value)
  if ((scope.getSnapshot().value?.[field] ?? '') !== value) throw new Error('Font preference was not saved')
}

/** A late font load may change cell widths; disposed terminals must not reflow. */
export function whenFontReady(
  fonts: Pick<FontFaceSet, 'load'> | undefined,
  font: string,
  remeasure: () => void,
): () => void {
  let active = true
  if (fonts !== undefined) void fonts.load(font).then(() => { if (active) remeasure() }, () => {})
  return () => { active = false }
}
