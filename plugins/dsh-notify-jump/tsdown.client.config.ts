import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'tsdown'

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
const id: string = pkg.name

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  format: 'cjs',
  dts: true,
  outDir: 'lib',
  clean: false,
  platform: 'browser',
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
})
