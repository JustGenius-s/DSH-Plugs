/**
 * Syntax-highlight theme catalog for the files panel.
 *
 * The panel highlights with Shiki's dual-theme mode: one light theme and one
 * dark theme render through a single tokenization, and the panel stylesheet
 * flips between them on `body[data-ds-dark-theme]`. Settings exposes the two
 * picks as independent dropdowns; this module owns the catalog of what can be
 * picked (curated from `@shikijs/themes`) plus the Codex defaults that ship as
 * local JSON. Registrations are static imports so they stay in the one client
 * bundle (the plugin loader has no async chunks).
 */
import type { ThemeRegistration } from 'shiki/core'
import themeCodexDark from './themes/codex-dark.json'
import themeCodexLight from './themes/codex-light.json'
import themeGithubLight from '@shikijs/themes/github-light'
import themeGithubDark from '@shikijs/themes/github-dark'
import themeOneLight from '@shikijs/themes/one-light'
import themeOneDarkPro from '@shikijs/themes/one-dark-pro'
import themeMinLight from '@shikijs/themes/min-light'
import themeMonokai from '@shikijs/themes/monokai'
import themeNord from '@shikijs/themes/nord'
import themeDracula from '@shikijs/themes/dracula'
import themeSolarizedLight from '@shikijs/themes/solarized-light'
import themeSolarizedDark from '@shikijs/themes/solarized-dark'
import themeTokyoNight from '@shikijs/themes/tokyo-night'
import themeCatppuccinLatte from '@shikijs/themes/catppuccin-latte'
import themeCatppuccinMocha from '@shikijs/themes/catppuccin-mocha'
import themeEverforestLight from '@shikijs/themes/everforest-light'
import themeEverforestDark from '@shikijs/themes/everforest-dark'
import themeGruvboxLightSoft from '@shikijs/themes/gruvbox-light-soft'
import themeGruvboxDarkSoft from '@shikijs/themes/gruvbox-dark-soft'
import themeKanagawaLotus from '@shikijs/themes/kanagawa-lotus'
import themeKanagawaDragon from '@shikijs/themes/kanagawa-dragon'
import themeRosePine from '@shikijs/themes/rose-pine'
import themeRosePineDawn from '@shikijs/themes/rose-pine-dawn'
import themeVitesseLight from '@shikijs/themes/vitesse-light'
import themeVitesseDark from '@shikijs/themes/vitesse-dark'
import themeAyuLight from '@shikijs/themes/ayu-light'
import themeAyuDark from '@shikijs/themes/ayu-dark'
import themeNightOwl from '@shikijs/themes/night-owl'

export type HighlightThemeKind = 'light' | 'dark'

/** One pickable theme: its setting id, display label, and which dropdown it belongs to. */
export interface HighlightThemeOption {
  id: string
  label: string
  kind: HighlightThemeKind
}

export const DEFAULT_HIGHLIGHT_THEME_LIGHT = 'codex-light'
export const DEFAULT_HIGHLIGHT_THEME_DARK = 'codex-dark'

/** Curated, ordered catalog. Codex defaults first in each dropdown. */
export const HIGHLIGHT_THEME_OPTIONS: readonly HighlightThemeOption[] = [
  { id: 'codex-light', label: 'Codex Light', kind: 'light' },
  { id: 'github-light', label: 'GitHub Light', kind: 'light' },
  { id: 'one-light', label: 'One Light', kind: 'light' },
  { id: 'min-light', label: 'Min Light', kind: 'light' },
  { id: 'solarized-light', label: 'Solarized Light', kind: 'light' },
  { id: 'everforest-light', label: 'Everforest Light', kind: 'light' },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte', kind: 'light' },
  { id: 'gruvbox-light-soft', label: 'Gruvbox Light Soft', kind: 'light' },
  { id: 'kanagawa-lotus', label: 'Kanagawa Lotus', kind: 'light' },
  { id: 'rose-pine-dawn', label: 'Rosé Pine Dawn', kind: 'light' },
  { id: 'vitesse-light', label: 'Vitesse Light', kind: 'light' },
  { id: 'ayu-light', label: 'Ayu Light', kind: 'light' },

  { id: 'codex-dark', label: 'Codex Dark', kind: 'dark' },
  { id: 'github-dark', label: 'GitHub Dark', kind: 'dark' },
  { id: 'one-dark-pro', label: 'One Dark Pro', kind: 'dark' },
  { id: 'monokai', label: 'Monokai', kind: 'dark' },
  { id: 'nord', label: 'Nord', kind: 'dark' },
  { id: 'dracula', label: 'Dracula', kind: 'dark' },
  { id: 'solarized-dark', label: 'Solarized Dark', kind: 'dark' },
  { id: 'tokyo-night', label: 'Tokyo Night', kind: 'dark' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', kind: 'dark' },
  { id: 'everforest-dark', label: 'Everforest Dark', kind: 'dark' },
  { id: 'gruvbox-dark-soft', label: 'Gruvbox Dark Soft', kind: 'dark' },
  { id: 'kanagawa-dragon', label: 'Kanagawa Dragon', kind: 'dark' },
  { id: 'rose-pine', label: 'Rosé Pine', kind: 'dark' },
  { id: 'vitesse-dark', label: 'Vitesse Dark', kind: 'dark' },
  { id: 'ayu-dark', label: 'Ayu Dark', kind: 'dark' },
  { id: 'night-owl', label: 'Night Owl', kind: 'dark' },
]

const REGISTRATIONS = new Map<string, ThemeRegistration>([
  ['codex-light', themeCodexLight as ThemeRegistration],
  ['codex-dark', themeCodexDark as ThemeRegistration],
  ['github-light', themeGithubLight],
  ['github-dark', themeGithubDark],
  ['one-light', themeOneLight],
  ['one-dark-pro', themeOneDarkPro],
  ['min-light', themeMinLight],
  ['monokai', themeMonokai],
  ['nord', themeNord],
  ['dracula', themeDracula],
  ['solarized-light', themeSolarizedLight],
  ['solarized-dark', themeSolarizedDark],
  ['tokyo-night', themeTokyoNight],
  ['catppuccin-latte', themeCatppuccinLatte],
  ['catppuccin-mocha', themeCatppuccinMocha],
  ['everforest-light', themeEverforestLight],
  ['everforest-dark', themeEverforestDark],
  ['gruvbox-light-soft', themeGruvboxLightSoft],
  ['gruvbox-dark-soft', themeGruvboxDarkSoft],
  ['kanagawa-lotus', themeKanagawaLotus],
  ['kanagawa-dragon', themeKanagawaDragon],
  ['rose-pine', themeRosePine],
  ['rose-pine-dawn', themeRosePineDawn],
  ['vitesse-light', themeVitesseLight],
  ['vitesse-dark', themeVitesseDark],
  ['ayu-light', themeAyuLight],
  ['ayu-dark', themeAyuDark],
  ['night-owl', themeNightOwl],
])

/** Registration for a catalog id; `undefined` for unknown ids (callers fall back). */
export function highlightThemeRegistration(id: string): ThemeRegistration | undefined {
  return REGISTRATIONS.get(id)
}
