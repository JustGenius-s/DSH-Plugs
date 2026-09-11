import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'tsdown'
import { dshCssModules } from '@just-genius/dsh-plugin-ui/css-modules'

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
const id: string = pkg.name
const sharedRuntimeClient = resolve(process.cwd(), '../../packages/runtime/src/client.ts')

export default defineConfig({
  entry: { client: 'src/client/index.tsx' },
  format: 'cjs',
  dts: true,
  outDir: 'lib',
  clean: false,
  platform: 'browser',
  // Resolve the workspace bridge from source so no module-table-incompatible
  // require() of the shared runtime package is left in the client bundle.
  alias: {
    '@just-genius/dsh-plugin-runtime/client': sharedRuntimeClient,
  },
  deps: {
    neverBundle: true,
    alwaysBundle: [
      '@just-genius/dsh-plugin-ui',
      /^@just-genius\/dsh-plugin-runtime(?:\/|$)/,
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
