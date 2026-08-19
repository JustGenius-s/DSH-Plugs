import { defineConfig } from 'tsdown'

// Plain ESM library. react stays external: plugins bundle this package and
// externalize react themselves against the DSH-provided peer. The second
// entry is the node-side build helper (CSS-modules inline plugin) imported
// by the plugins' tsdown configs.
export default defineConfig([
  {
    entry: ['src/index.tsx'],
    format: 'esm',
    dts: true,
    outDir: 'lib',
    clean: true,
    platform: 'browser',
    deps: { neverBundle: true },
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
