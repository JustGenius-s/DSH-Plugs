/**
 * Client-bundle deps that must be inlined. DSH 0.1.2-alpha+ only seeds
 * react, react-dom, cordis, dsh-client-store, ui-slots, and ui-primitives.
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
]

/** Inline every non-seed, non-official package. Use with `neverBundle: true`. */
export function shouldInlinePluginClientDep(id) {
  if (dsh012PlatformSeeds.includes(id)) return false
  if (id.startsWith('@deepseek-ai/')) return false
  return true
}
