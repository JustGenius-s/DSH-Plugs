import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('.', import.meta.url))

export default {
  root: packageRoot,
  test: {
    environment: 'node',
    dir: packageRoot,
    include: ['test/**/*.test.ts'],
  },
}
