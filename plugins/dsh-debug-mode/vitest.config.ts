import { fileURLToPath } from 'node:url'

const pluginRoot = fileURLToPath(new URL('.', import.meta.url))

export default {
  root: pluginRoot,
  test: {
    environment: 'node',
    dir: pluginRoot,
    include: ['test/**/*.test.ts'],
  },
}
