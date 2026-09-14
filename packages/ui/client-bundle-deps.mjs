/**
 * Client-bundle deps that must be inlined. DSH seeds exactly the packages in
 * `dsh012PlatformSeeds` below — read that list, not this prose, as the source
 * of truth; it mirrors the web frontend's `staticModules` table.
 */
export const pluginClientAlwaysBundle = [
  '@just-genius/dsh-plugin-ui',
  /^@just-genius\/dsh-plugin-runtime(?:\/|$)/,
  'markdown-it',
  'highlight.js',
  'markdown-it-for-inline',
  'clsx',
  'dompurify',
  // markdown-it / shiki transitives — neverBundle:true does not follow them.
  'hast-util-to-html',
  'oniguruma-to-es',
  'mdurl',
  'uc.micro',
  'entities',
  'linkify-it',
  'punycode.js',
]

export const dsh012PlatformSeeds = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/** Inline every non-seed, non-official package. Use with `neverBundle: true`. */
export function shouldInlinePluginClientDep(id) {
  if (dsh012PlatformSeeds.includes(id)) return false
  if (id.startsWith('@deepseek-ai/')) return false
  return true
}
