import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'tsdown'

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
  // Resolve the workspace bridge from source. Resolving its package export
  // through packages/runtime/lib makes this bundle race that package's clean
  // build and can silently leave a module-table-incompatible require() behind.
  alias: {
    '@just-genius/dsh-plugin-runtime/client': sharedRuntimeClient,
  },
  // DSH registers one client module factory per plugin entry. Any relative
  // chunk emitted by Rolldown is not a separately registered module.
  outputOptions: {
    codeSplitting: false,
  },
  // alwaysBundle inlines the shared UI package (never a runtime dep) beside
  // the terminal/shiki stacks. markdown-it is a production dependency, which
  // tsdown externalizes by default — so it must be inlined here too. Only the
  // official primitive package stays external: DSH materializes it from the
  // matching client injection before this plugin factory executes.
  deps: {
    neverBundle: ['@deepseek-ai/dsh-client-ui-primitives'],
    alwaysBundle: [
      /^@just-genius\/dsh-plugin-ui(?:\/|$)/,
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
