// Standalone theme bootstrap for apps that are not the DSH cordis client.
// Injects the official --dsw-* token sheets and resolves light/dark/system
// the same way ui-theme's boot script does (body[data-ds-dark-theme]).

import { THEME_SHEETS } from './theme/sheets'

export type ThemePreference = 'light' | 'dark' | 'system'

const STYLE_ATTR = 'data-dsh-plugin-ui-theme'
const PLUGIN_ID = '@just-genius/dsh-plugin-ui'

let media: MediaQueryList | null = null
let preference: ThemePreference = 'system'
let installed = false

function resolveDark(pref: ThemePreference): boolean {
  if (pref === 'dark') return true
  if (pref === 'light') return false
  if (typeof matchMedia === 'undefined') return false
  return matchMedia('(prefers-color-scheme: dark)').matches
}

function applyResolved(dark: boolean): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.body.toggleAttribute('data-ds-dark-theme', dark)
}

function onSystemChange(): void {
  if (preference !== 'system') return
  applyResolved(resolveDark('system'))
}

/**
 * Inject the DSH token stylesheets once and apply the initial preference.
 * Safe to call on every boot; subsequent calls only update preference.
 */
export function installTheme(initial: ThemePreference = 'system'): void {
  if (typeof document === 'undefined') return

  if (!installed) {
    for (const [name, css] of THEME_SHEETS) {
      const tagId = `${PLUGIN_ID}/${name}`
      if (document.head.querySelector(`style[${STYLE_ATTR}=${JSON.stringify(tagId)}]`) !== null) {
        continue
      }
      const tag = document.createElement('style')
      tag.setAttribute(STYLE_ATTR, tagId)
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = tagId
      tag.textContent = css
      document.head.appendChild(tag)
    }
    installed = true
  }

  setThemePreference(initial)
}

/** Update the live light/dark/system preference (persists only in memory). */
export function setThemePreference(next: ThemePreference): void {
  preference = next
  applyResolved(resolveDark(next))

  if (typeof matchMedia === 'undefined') return
  if (media === null) {
    media = matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', onSystemChange)
  }
}

/** Current preference (`system` is not yet resolved). */
export function getThemePreference(): ThemePreference {
  return preference
}

/** Whether the resolved palette is currently dark. */
export function isDarkTheme(): boolean {
  return resolveDark(preference)
}
