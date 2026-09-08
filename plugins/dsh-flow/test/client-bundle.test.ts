import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'vitest'

const require = createRequire(import.meta.url)
const CLIENT = fileURLToPath(new URL('../lib/client.js', import.meta.url))

/**
 * The client bundle must be loadable with the Node globals a browser lacks.
 *
 * This is a boot-safety test for the BROWSER half, the counterpart to
 * `tools-schema.test.ts` for the Host half. The bundle is a
 * `window.__ModuleLoader__.load(...)` CJS factory evaluated in the page, so any
 * surviving `process`/`require`/`module` reference throws "process is not
 * defined" and the plugin fails to load — which is exactly what happened when
 * React Flow's dependency tree (`use-sync-external-store`) dragged in the
 * `process.env.NODE_ENV` idiom.
 *
 * React and react-dom are resolved BEFORE the globals are hidden: they
 * legitimately read `process.env.NODE_ENV`, and requiring them lazily inside
 * the clean window would fail this test for the harness's own reasons.
 */

type LoadedModule = {
  apply: (ctx: unknown) => void
  inject: string[]
}

type StyleTag = {
  dataset: Record<string, string>
  style: Record<string, string>
  textContent: string
}

/**
 * Load the bundle with `process`, `require`, and `module` all absent.
 *
 * `installed` tracks the styles the page has already accepted, so the
 * once-per-tag guard in the bundle behaves realistically: each fresh load sees
 * an empty head and re-injects, which is what happens in a real reload.
 */
function loadInBrowserScope() {
  const deps: Record<string, unknown> = {
    react: require('react'),
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-dom': require('react-dom'),
  }
  const registered: Array<Record<string, unknown>> = []
  const styleTags: StyleTag[] = []
  const installed = new Set<string>()

  ;(globalThis as { window?: unknown }).window = {
    __ModuleLoader__: {
      load({ id, factory }: { id: string; factory: (req: (name: string) => unknown) => LoadedModule }) {
        const mod = factory((name) => {
          if (!(name in deps)) throw new Error(`unexpected require: ${name}`)
          return deps[name]
        })
        ;(globalThis as { __loaded?: LoadedModule }).__loaded = mod
        ;(globalThis as { __loadedId?: string }).__loadedId = id
      },
    },
  }
  ;(globalThis as { document?: unknown }).document = {
    querySelector: (selector: string) => (installed.has(selector) ? { dataset: {} } : null),
    createElement: () => {
      const tag: StyleTag = { dataset: {}, style: {}, textContent: '' }
      styleTags.push(tag)
      return tag
    },
    head: {
      appendChild(tag: StyleTag) {
        if (tag.dataset?.pluginCss !== undefined) {
          installed.add(`style[data-plugin-css=${JSON.stringify(tag.dataset.pluginCss)}]`)
        }
      },
    },
  }

  const root = globalThis as typeof globalThis & {
    process?: unknown
    require?: unknown
    module?: unknown
    exports?: unknown
    __loaded?: LoadedModule
    __loadedId?: string
  }
  const saved = {
    process: root.process,
    require: root.require,
    module: root.module,
    exports: root.exports,
  }
  Reflect.deleteProperty(root, 'process')
  Reflect.deleteProperty(root, 'require')
  Reflect.deleteProperty(root, 'module')
  Reflect.deleteProperty(root, 'exports')

  try {
    // Re-require the bundle each time: module state (including the CSS
    // injection guard) must be re-evaluated, as it would be on a page reload.
    delete require.cache[CLIENT]
    require(CLIENT)
  } finally {
    Object.assign(globalThis, saved)
  }
  return { mod: root.__loaded, id: root.__loadedId, registered, styleTags }
}

test('client bundle loads without process, require, or module', () => {
  const { mod, id } = loadInBrowserScope()
  expect(id).toBe('@just-genius/dsh-flow')
  expect(typeof mod?.apply).toBe('function')
})

test('client bundle declares only the slots injection', () => {
  const { mod } = loadInBrowserScope()
  expect(mod?.inject).toEqual(['slots'])
})

test('apply registers only the Flow conversation view', () => {
  const { mod, registered } = loadInBrowserScope()
  const ctx = {
    slots: {
      inject(key: string, cb: () => void) {
        if (key === 'conversation.view') cb()
        return () => {}
      },
      register(opts: Record<string, unknown>, comp: unknown) {
        registered.push({ ...opts, component: typeof comp })
        return () => {}
      },
    },
  }
  mod!.apply(ctx)

  expect(registered.length).toBe(1)
  expect(registered[0]!.name).toBe('conversation.view')
  expect(registered[0]!.id).toBe('flow')
  expect(registered[0]!.label).toBe('Flow')
  expect(registered[0]!.component).toBe('function')
})

test('bundle self-injects its stylesheets at load time', () => {
  // Styles are injected by the bundle's banner when it is EVALUATED, not by
  // apply(). Across tests in one process the module is evaluated once, so this
  // asserts the injection contract statically instead of re-running it.
  const source = readFileSync(CLIENT, 'utf8')

  // React Flow's stylesheet cannot be required at runtime (the client module
  // table admits only React, React DOM, and declared DSH injections), so the
  // build inlines it as a tagged <style>.
  expect(
    source.includes('@just-genius/dsh-flow/reactflow'),
    "React Flow's stylesheet must be inlined by the build",
  ).toBe(true)
  expect(
    source.includes('FlowCanvas.module.css'),
    "this plugin's own CSS module must be inlined by the build",
  ).toBe(true)
  // Every injection must be owner-tagged so the HMR receiver can strip it.
  expect(
    source.includes('tag.dataset.plugin'),
    'style tags must carry data-plugin for HMR cleanup',
  ).toBe(true)
  expect(
    source.includes('data-plugin-css='),
    'style tags must carry data-plugin-css for the once-per-tag guard',
  ).toBe(true)
})

test('bundle contains no process.env references', () => {
  const source = readFileSync(CLIENT, 'utf8')
  expect(source.includes('process.env')).toBe(false)
})
