import { defineConfig } from 'tsdown'
import { dshCssModules } from './src/css-modules.ts'

const PKG = '@just-genius/dsh-plugin-ui'

// Plain ESM library. React stays external: apps and plugins provide it.
// Small implementation dependencies are bundled here so a DSH plugin that
// materializes this package never leaks an unregistered transitive require
// (the client module loader only knows platform seed words and plugin peers).
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
    deps: {
      neverBundle: true,
      alwaysBundle: [
        'clsx',
        'dompurify',
        'markdown-it',
        'mdurl',
        'uc.micro',
        'entities',
        'linkify-it',
        'punycode.js',
      ],
    },
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
