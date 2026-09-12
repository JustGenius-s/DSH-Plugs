import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'tsdown'
import { dshCssModules } from '@just-genius/dsh-plugin-ui/css-modules'

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
const id: string = pkg.name

export default defineConfig({
  entry: { client: 'src/client/index.tsx' },
  format: 'cjs',
  dts: true,
  outDir: 'lib',
  clean: false,
  platform: 'browser',
  // DSH's browser module table only materializes platform seeds and declared
  // client injections. Shared workspace helpers are build-time libraries, so
  // leaving the runtime package external would emit an unresolvable require().
  deps: {
    neverBundle: true,
    alwaysBundle: ['@just-genius/dsh-plugin-ui', /^@just-genius\/dsh-plugin-runtime(?:\/|$)/],
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
