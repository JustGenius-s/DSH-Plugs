import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'tsdown'
import { dshCssModules } from '@just-genius/dsh-plugin-ui/css-modules'

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
const id: string = pkg.name

/**
 * React Flow's stylesheet, inlined with this monorepo's CSS convention.
 *
 * The client contract is strict: `check-client-modules.mjs` rejects every
 * `require(...)` that is not React, React DOM, or a declared DSH client
 * injection. `reactflow/dist/style.css` is a real package export, so rolldown
 * resolves and externalises it — which would emit a rejected `require`.
 *
 * Injecting it as a tagged `<style>` at bundle-evaluation time matches exactly
 * what `dshCssModules` emits for `*.module.css`, so the HMR receiver strips it
 * the same way and the module table stays clean.
 */
const reactflowCss = readFileSync(resolve(process.cwd(), 'node_modules/reactflow/dist/style.css'), 'utf8')

const injectReactflowCss = [
  "(function(){",
  'var tagId = ' + JSON.stringify(`${id}/reactflow`) + ';',
  "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
  "  var tag = document.createElement('style');",
  "  tag.dataset.plugin = " + JSON.stringify(id) + ';',
  '  tag.dataset.pluginCss = tagId;',
  '  tag.textContent = ' + JSON.stringify(reactflowCss) + ';',
  "  document.head.appendChild(tag);",
  '}',
  '})();',
].join('\n')

export default defineConfig({
  entry: { client: 'src/client/index.tsx' },
  format: 'cjs',
  dts: true,
  outDir: 'lib',
  clean: false,
  platform: 'browser',
  deps: {
    neverBundle: true,
    // reactflow and everything it pulls in is browser ESM. None of it has a
    // client module-table entry, so the whole subtree must be inlined.
    alwaysBundle: [
      '@just-genius/dsh-plugin-ui',
      /^reactflow$/,
      /^@reactflow\//,
      /^classcat$/,
      /^zustand($|\/)/,
      /^use-sync-external-store($|\/)/,
      /^d3-[a-z]+$/,
      /^(internmap|delaunator|robust-predicates)$/,
      /^@just-genius\/dsh-plugin-runtime(?:\/|$)/,
    ],
  },
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  // React Flow's dependency tree (`use-sync-external-store`) is published with
  // the `process.env.NODE_ENV` idiom. `process` does not exist in the browser,
  // so leaving those reads in the bundle throws "process is not defined" the
  // moment the client half is imported — surfacing as a plugin load failure.
  // Replacing them with literals also lets the dead branch drop out.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
${injectReactflowCss}`,
  },
  footer: {
    js: `return module.exports; } });`,
  },
  plugins: [dshCssModules(id)],
})
