import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'tsdown'
import { dshCssModules } from '@just-genius/dsh-plugin-ui/css-modules'

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
const id: string = pkg.name

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  format: 'cjs',
  dts: true,
  outDir: 'lib',
  clean: false,
  platform: 'browser',
  // neverBundle leaves host seed packages as require(); schema-form is not a
  // seed (same class as dsh-client-web-react), so it and its validator chain
  // must be inlined or the client module table misses them at load.
  deps: {
    neverBundle: true,
    alwaysBundle: [
      '@deepseek-ai/dsh-client-schema-form',
      '@deepseek-ai/schemastery',
      '@deepseek-ai/cosmokit',
      '@standard-schema/spec',
    ],
  },
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {
var module = { exports: {} };
var exports = module.exports;`,
  },
  footer: {
    js: `return module.exports; } });`,
  },
  plugins: [dshCssModules(id)],
})
