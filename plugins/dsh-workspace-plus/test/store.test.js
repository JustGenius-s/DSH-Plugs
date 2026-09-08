/**
 * On-disk persistence for the multi-folder bindings.
 *
 * The rename moved the store from `~/.dsh/multi-repo/projects.json` to
 * `~/.dsh/workspace-plus/bindings.json`, so the migration is the part that
 * could silently cost the user every workspace they already bound. These
 * cover that path plus the duplicate-binding rules that decide what
 * "re-adding the same folder" does.
 */

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let home = ''
let previousHome
let store

const LEGACY = {
  version: 1,
  projects: [
    {
      root: '/tmp/primary',
      title: 'primary · 2',
      primaryPath: '/tmp/primary',
      repos: [
        { name: 'primary', path: '/tmp/primary', kind: 'folder' },
        { name: 'side', path: '/tmp/side', kind: 'folder', external: true },
      ],
      updatedAt: 1787800187371,
    },
  ],
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'workspace-plus-'))
  previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  store = await import(`../src/store.ts?t=${Date.now()}${Math.random()}`)
})

afterEach(() => {
  process.env.DSH_HOME = previousHome
  rmSync(home, { recursive: true, force: true })
})

function writeLegacy(content) {
  const dir = join(home, 'multi-repo')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'projects.json'), content)
}

test('the legacy multi-repo store is copied forward on first load', () => {
  writeLegacy(JSON.stringify(LEGACY))
  const bindings = store.listBindings()

  assert.equal(bindings.length, 1, 'the legacy binding is carried over')
  assert.equal(bindings[0].root, '/tmp/primary')
  assert.equal(bindings[0].title, 'primary · 2')
  assert.equal(bindings[0].repos.length, 2, 'both folders survive')
  assert.equal(bindings[0].repos[1].external, true, 'the external flag survives')
})

test('the legacy file is left in place so a downgrade still works', () => {
  writeLegacy(JSON.stringify(LEGACY))
  store.listBindings()
  assert.equal(existsSync(join(home, 'multi-repo', 'projects.json')), true)
})

test('migration runs once: a later legacy edit does not overwrite new data', () => {
  writeLegacy(JSON.stringify(LEGACY))
  store.listBindings()
  store.deleteBinding('/tmp/primary')

  writeLegacy(JSON.stringify(LEGACY))
  assert.deepEqual(store.listBindings(), [], 'the new store stays authoritative')
})

test('an empty legacy store does not create an empty new one', () => {
  writeLegacy(JSON.stringify({ version: 1, projects: [] }))
  assert.deepEqual(store.listBindings(), [])
  assert.equal(existsSync(join(home, 'workspace-plus', 'bindings.json')), false)
})

test('a corrupt legacy store leaves the plugin usable', () => {
  writeLegacy('{not json')
  assert.deepEqual(store.listBindings(), [])
})

test('a new-store file using the legacy `projects` key still loads', () => {
  mkdirSync(join(home, 'workspace-plus'), { recursive: true })
  writeFileSync(
    join(home, 'workspace-plus', 'bindings.json'),
    JSON.stringify({ version: 1, projects: LEGACY.projects }),
  )
  assert.equal(store.listBindings().length, 1, 'both key spellings are accepted')
})

test('binding the same primary twice replaces rather than duplicates', () => {
  const first = store.bindBinding({
    root: '/tmp/primary',
    repos: [{ name: 'a', path: '/tmp/primary' }, { name: 'b', path: '/tmp/b' }],
  })
  store.bindBinding({
    root: '/tmp/primary',
    repos: [{ name: 'a', path: '/tmp/primary' }, { name: 'c', path: '/tmp/c' }],
  })

  const all = store.listBindings()
  assert.equal(all.length, 1, 'one binding per primary')
  assert.equal(first.root, '/tmp/primary')
})

test('deleting a binding removes it even when matched by primary path', () => {
  store.bindBinding({
    root: '/tmp/primary',
    repos: [{ name: 'a', path: '/tmp/primary' }, { name: 'b', path: '/tmp/b' }],
  })
  assert.equal(store.deleteBinding('/tmp/primary'), true)
  assert.deepEqual(store.listBindings(), [])
  assert.equal(store.deleteBinding('/tmp/primary'), false, 'a second delete reports miss')
})

test('a session cwd inside any bound folder resolves to that binding', () => {
  store.bindBinding({
    root: '/tmp/primary',
    repos: [{ name: 'a', path: '/tmp/primary' }, { name: 'b', path: '/tmp/b' }],
  })
  assert.equal(store.findBindingForCwd('/tmp/primary')?.root, '/tmp/primary')
  assert.equal(store.findBindingForCwd('/tmp/b')?.root, '/tmp/primary')
  assert.equal(store.findBindingForCwd('/tmp/unrelated'), null)
})

test('bindings are listed newest first', async () => {
  store.bindBinding({ root: '/tmp/one', repos: [{ name: 'one', path: '/tmp/one' }] })
  // A distinct mtime: `updatedAt` is the only ordering input.
  const later = await import(`../src/store.ts?later=${Math.random()}`)
  later.bindBinding({ root: '/tmp/two', repos: [{ name: 'two', path: '/tmp/two' }] })

  const roots = later.listBindings().map((b) => b.root)
  assert.deepEqual(roots, ['/tmp/two', '/tmp/one'])
})

test('the store file is written atomically, never left as .tmp', () => {
  store.bindBinding({ root: '/tmp/primary', repos: [{ name: 'a', path: '/tmp/primary' }] })
  const dir = join(home, 'workspace-plus')
  const leftovers = readFileSync(join(dir, 'bindings.json'), 'utf8')
  assert.match(leftovers, /"bindings"/)
  assert.equal(existsSync(join(dir, 'bindings.json.tmp')), false)
})
