import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'tsdown'

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
const id: string = pkg.name

export default defineConfig({
  entry: { client: 'src/client/index.tsx' },
  format: 'cjs',
  dts: true,
  outDir: 'lib',
  clean: false,
  platform: 'browser',
  // alwaysBundle inlines the shared UI package (never a runtime dep) beside
  // the terminal/shiki stacks.
  deps: { alwaysBundle: ['@just-genius/dsh-plugin-ui', /^@xterm\//, 'shiki', /^shiki\//, /^@shikijs\//] },
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  banner: {
    js: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(id) + ', factory: (require) => {\nvar module = { exports: {} };\nvar exports = module.exports;',
  },
  footer: {
    js: 'return module.exports; } });',
  },
})
