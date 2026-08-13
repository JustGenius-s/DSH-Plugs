import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'tsdown'

// Read the package name so the client bundle registers under the right id
// even after the package is renamed.
const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
const id: string = pkg.name

// Browser half: bundled to CJS (so peer imports become require()), then
// wrapped in the window.__ModuleLoader__.load({ id, factory }) handoff the
// DSH client module system expects. The CJS preamble (`module`/`exports`)
// lives in the banner because rolldown's CJS output does not emit it.
export default defineConfig({
  entry: { client: 'src/client/index.tsx' },
  format: 'cjs',
  dts: true,
  outDir: 'lib',
  clean: false,
  platform: 'browser',
  deps: { neverBundle: true },
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {
var module = { exports: {} };
var exports = module.exports;`,
  },
  footer: {
    js: `return module.exports; } });`,
  },
})
