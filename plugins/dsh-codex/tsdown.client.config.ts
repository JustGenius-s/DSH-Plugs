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
  // DSH registers one client module factory per plugin entry. Any relative
  // chunk emitted by Rolldown (including its shared runtime chunk) is not a
  // separately registered module and therefore cannot be required at runtime.
  // Keep the client bundle self-contained, including Shiki language imports.
  outputOptions: {
    codeSplitting: false,
  },
  // alwaysBundle inlines the shared UI package (never a runtime dep) beside
  // the terminal/shiki stacks. markdown-it is a production dependency, which
  // tsdown externalizes by default — so it must be inlined here too.
  deps: {
    alwaysBundle: [
      '@just-genius/dsh-plugin-ui',
      /^@just-genius\/dsh-plugin-runtime(?:\/|$)/,
      /^@xterm\//,
      'shiki',
      /^shiki\//,
      /^@shikijs\//,
      'markdown-it',
      'dompurify',
    ],
  },
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  banner: {
    js: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(id) + ', factory: (require) => {\nvar module = { exports: {} };\nvar exports = module.exports;',
  },
  footer: {
    js: 'return module.exports; } });',
  },
})
