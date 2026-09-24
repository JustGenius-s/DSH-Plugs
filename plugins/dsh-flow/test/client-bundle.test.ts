import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { afterEach, expect, test, vi } from 'vitest'
import type { InputTriggerSource } from '@just-genius/dsh-plugin-runtime/client'
import type { FlowCommand } from '../src/client/command.ts'

afterEach(() => vi.unstubAllGlobals())

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

test('client bundle declares the command and Sidebar services', () => {
  const { mod } = loadInBrowserScope()
  expect(mod?.inject).toEqual(['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'inputTriggers', 'commandUi'])
})

function installClient() {
  const loaded = loadInBrowserScope()
  const disposers: Array<() => void> = []
  const unregister = vi.fn()
  const registerDefinition = vi.fn(() => unregister)
  const decorate = vi.fn(() => unregister)
  const registerCommand = vi.fn((_command: FlowCommand) => unregister)
  const registerSource = vi.fn((_source: InputTriggerSource) => unregister)
  const openTab = vi.fn()
  let language = 'zh'
  let dictionaries: Record<string, Record<string, string>> = {}
  const ctx = {
    effect(register: () => () => void) {
      const dispose = register()
      disposers.push(dispose)
      return dispose
    },
    locale: {
      register(_namespace: string, values: typeof dictionaries) {
        dictionaries = values
        return unregister
      },
      bind: () => (key: string) => dictionaries[language]![key],
    },
    get: () => ({ decorate, register: registerCommand }),
    inputTriggers: { registerSource },
    sidebarRight: { openTab },
    sidebarRightTabs: { register: registerDefinition },
    slots: {
      inject(_key: string, cb: () => () => void) {
        const dispose = cb()
        disposers.push(dispose)
        return dispose
      },
      register(opts: Record<string, unknown>, comp: unknown) {
        loaded.registered.push({ ...opts, component: typeof comp })
        return unregister
      },
    },
  }
  loaded.mod!.apply(ctx)
  return {
    ...loaded, registerDefinition, decorate, registerCommand, registerSource, openTab, disposers, unregister,
    setLanguage: (next: string) => { language = next },
  }
}

test('apply registers a Sidebar page and composer chip, without a conversation view', () => {
  const { registered, registerDefinition } = installClient()
  expect(registered).toEqual([
    { name: 'sidebar.right.pane.tab', key: '@just-genius/dsh-flow', component: 'function' },
    { name: 'sidebar.right.pane.tab.title', key: '@just-genius/dsh-flow', component: 'function' },
    expect.objectContaining({ name: 'conversation.input.left', id: 'flow-chip', locale: 'flow', component: 'function' }),
  ])
  expect(registerDefinition).toHaveBeenCalledWith(expect.objectContaining({
    id: '@just-genius/dsh-flow',
    kind: 'dsh-flow',
    priority: 'extension',
    guide: [expect.objectContaining({ id: 'new', title: expect.any(Function) })],
  }))
  const chip = registered[2]!
  expect((chip.inject as (sessionId: string) => unknown)('session-2')).toEqual({ sessionId: 'session-2' })
})

test('bare /flow opens the Sidebar and enables the selected session without a duplicate command', async () => {
  const fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, value: { ok: true, mode: true } }),
  }))
  vi.stubGlobal('fetch', fetch)
  const { decorate, registerCommand, openTab } = installClient()
  expect(decorate).not.toHaveBeenCalled()
  expect(registerCommand).toHaveBeenCalledTimes(1)
  const command = registerCommand.mock.calls[0]![0]
  expect(command.name).toBe('flow')
  expect(command.ui.kind).toBe('action')
  command.ui.run({ sessionId: 'session/2' })
  expect(openTab).toHaveBeenCalledWith('dsh-flow')
  expect(fetch).toHaveBeenCalledWith('/api/dsh-flow/mode?sessionId=session%2F2', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ on: true }),
  }))
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
})

test('the registered menu row exposes a localized title, description, and monochrome icon', () => {
  const { registerCommand, setLanguage } = installClient()
  const command = registerCommand.mock.calls[0]![0]
  expect(command.label()).toBe('流程')
  expect(command.description()).toContain('主 Agent 规划')
  expect(command.icon.name).toBe('IconFlowOutline16')
  setLanguage('en')
  expect(command.label()).toBe('Flow')
  expect(command.description()).toContain('the Leader plans')
})

test('typed command arguments use the mode route and surface failures to the composer', async () => {
  const fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, value: { ok: true, mode: true } }),
  }))
  vi.stubGlobal('fetch', fetch)
  const { registerSource, openTab } = installClient()
  const source = registerSource.mock.calls[0]![0]
  const result = source.matchSpace!({ sessionId: 'session/2' as never }, '/flow')
  if (result === undefined || typeof result !== 'object' || !('claim' in result)) throw new Error('missing Flow claim')
  expect(await result.claim.submit('调整登录流程', {} as never, [])).toEqual({ kind: 'success' })
  expect(fetch).toHaveBeenCalledWith('/api/dsh-flow/mode?sessionId=session%2F2', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ rawInput: '调整登录流程' }),
  }))
  expect(openTab).toHaveBeenCalledWith('dsh-flow')
  openTab.mockClear()
  expect(await result.claim.submit('off', {} as never, [])).toEqual({ kind: 'success' })
  expect(openTab).not.toHaveBeenCalled()
  fetch.mockRejectedValueOnce(new Error('offline'))
  expect(await result.claim.submit('off', {} as never, [])).toEqual({ kind: 'error', text: 'offline' })
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
