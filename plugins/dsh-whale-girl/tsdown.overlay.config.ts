import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { overlay: 'src/client/overlay.ts' },
  format: 'iife',
  dts: false,
  outDir: 'lib',
  clean: false,
  platform: 'browser',
  deps: { neverBundle: true },
  outExtensions: () => ({ js: '.js' }),
  outputOptions: {
    name: 'WhaleGirlOverlay',
  },
})
