import { fileURLToPath } from 'node:url';

const pluginRoot = fileURLToPath(new URL('.', import.meta.url));

export default {
  root: pluginRoot,
  // The shared kit forwards host-owned menus and glyphs. Tests exercise plain
  // functions, so stub the browser-only primitive module and inline the kit.
  resolve: {
    // Matched exactly, so a subpath import (the package's own `./client`
    // entry) is not silently rewritten to this stub.
    alias: [{
      find: /^@deepseek-ai\/dsh-client-ui-primitives$/,
      replacement: fileURLToPath(new URL('./test/fixtures/primitives-stub.ts', import.meta.url)),
    }],
  },
  test: {
    environment: 'node',
    dir: pluginRoot,
    include: ['test/**/*.test.ts'],
    server: {
      deps: {
        inline: [/@just-genius\/dsh-plugin-ui/],
      },
    },
  },
};
