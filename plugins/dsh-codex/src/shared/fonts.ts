export type FontPreferenceKey = 'uiFontFamily' | 'codeFontFamily'

export const FONT_PREFERENCE_MAX_LENGTH = 256
export const UI_FONT_FALLBACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
export const CODE_FONT_FALLBACK = '"SF Mono", "JetBrains Mono", "Fira Code", Consolas, Menlo, monospace'
export const TERMINAL_FONT_FALLBACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded'])

/** Font names, not CSS declarations: quote each name and keep a usable fallback. */
export function fontFamilyStack(preference: string | undefined, fallback: string): string {
  const families = (preference ?? '').slice(0, FONT_PREFERENCE_MAX_LENGTH)
    .split(',')
    .map(name => name.trim().replace(/^(['"])(.*)\1$/, '$2').replace(/[\u0000-\u001f\u007f]/g, '').trim())
    .filter(Boolean)
    .map(name => GENERIC_FAMILIES.has(name.toLowerCase())
      ? name.toLowerCase()
      : `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
  return families.length === 0 ? fallback : `${families.join(', ')}, ${fallback}`
}
