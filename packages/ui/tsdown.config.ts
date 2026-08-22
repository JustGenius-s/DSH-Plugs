import { defineConfig } from 'tsdown'
import { dshCssModules } from './src/css-modules.ts'

const PKG = '@just-genius/dsh-plugin-ui'

// Plain ESM library. react stays external: apps and plugins provide it.
// CSS modules are inlined via the same HMR-friendly contract as DSH client
// bundles. The second entry is the node-side css-modules helper itself.
export default defineConfig([
  {
    entry: ['src/index.tsx'],
    format: 'esm',
    dts: true,
    outDir: 'lib',
    clean: true,
    platform: 'browser',
    deps: { neverBundle: true },
    plugins: [dshCssModules(PKG)],
  },
  {
    entry: { 'css-modules': 'src/css-modules.ts' },
    format: 'esm',
    dts: true,
    outDir: 'lib',
    clean: false,
    platform: 'node',
    deps: { neverBundle: true },
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  },
])
