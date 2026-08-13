import { defineConfig } from 'tsdown'

// Node half: a plain ESM library bundle of src/index.ts.
export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  dts: true,
  outDir: 'lib',
  clean: true,
  platform: 'neutral',
  deps: { neverBundle: true },
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
})
