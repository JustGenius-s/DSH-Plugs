import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  dts: true,
  outDir: 'lib',
  clean: true,
  platform: 'node',
  deps: { neverBundle: true },
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
})
