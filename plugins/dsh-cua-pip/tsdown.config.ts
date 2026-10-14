import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  dts: true,
  outDir: 'lib',
  // DSH HMR watches existing modules for change, not unlink/add. Keep the host
  // file present so rebuilding does not silently leave the old module running.
  clean: false,
  platform: 'node',
  deps: { neverBundle: true },
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
})
