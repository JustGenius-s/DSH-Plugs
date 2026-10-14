import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'
const local = (path: string): string => fileURLToPath(new URL(path, import.meta.url))
export default defineConfig([{
  entry: { index: 'src/desktop/index.ts' }, format: 'esm', dts: false, outDir: 'lib/desktop', clean: false, platform: 'node',
  alias: {
    '@just-genius/dsh-plugin-runtime/host': local('../../packages/runtime/src/host.ts'),
    '@deepseek-ai/schemastery': local('lib/desktop-runtime/schemastery/lib/index.mjs'),
    '@deepseek-ai/cosmokit': local('lib/desktop-runtime/cosmokit/lib/index.js'),
  },
  deps: { alwaysBundle: [/^@just-genius\/dsh-plugin-runtime/, /^@deepseek-ai\/(schemastery|cosmokit)$/] },
  treeshake: { moduleSideEffects: false }, outExtensions: () => ({ js: '.js' }),
}, {
  entry: { editor: 'src/desktop/client.tsx' }, format: 'cjs', dts: false, outDir: 'lib/desktop-build', clean: false, platform: 'browser',
  deps: { neverBundle: true },
  outExtensions: () => ({ js: '.js' }),
}])
