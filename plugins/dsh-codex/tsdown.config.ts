import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'side-panels': 'src/side-panels.ts',
  },
  format: 'esm',
  dts: true,
  outDir: 'lib',
  clean: false,
  platform: 'neutral',
  deps: { neverBundle: true },
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
})
