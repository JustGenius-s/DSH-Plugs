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
  // Resolve the workspace bridge from source (same race-avoidance as dsh-codex).
  alias: {
    '@just-genius/dsh-plugin-runtime/client': sharedRuntimeClient,
  },
  // One client module factory per plugin entry; no relative chunks.
  outputOptions: {
    codeSplitting: false,
  },
  deps: {
    neverBundle: true,
    alwaysBundle: [
      /^@just-genius\/dsh-plugin-runtime(?:\/|$)/,
      /^@just-genius\/dsh-plugin-ui(?:\/|$)/,
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
})
