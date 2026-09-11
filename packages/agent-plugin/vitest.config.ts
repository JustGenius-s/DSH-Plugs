import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default {
  root,
  test: {
    environment: 'node',
    dir: root,
    include: ['test/**/*.test.ts'],
  },
}
