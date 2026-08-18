import { defineConfig } from 'tsdown'

// Plain ESM library. react stays external: plugins bundle this package and
// externalize react themselves against the DSH-provided peer.
export default defineConfig({
  entry: ['src/index.tsx'],
  format: 'esm',
  dts: true,
  outDir: 'lib',
  clean: true,
  platform: 'browser',
  deps: { neverBundle: true },
})
