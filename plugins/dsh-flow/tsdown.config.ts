import { defineConfig } from 'tsdown'

export default defineConfig({
  // `graph` and `mode` are separate entries so their pure logic can be unit
  // tested without booting a host context — the orchestrator is only trustworthy
  // if readiness, cycle rules, and the mode switch are tested directly.
  entry: ['src/index.ts', 'src/graph.ts', 'src/mode.ts', 'src/wake-policy.ts'],
  format: 'esm',
  dts: true,
  outDir: 'lib',
  clean: true,
  platform: 'node',
  deps: { neverBundle: true },
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
})
