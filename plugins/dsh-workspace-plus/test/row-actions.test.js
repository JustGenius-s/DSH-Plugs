/**
 * The row action sets.
 *
 * Two surfaces render these: the pinned area draws its own menus, and the
 * official menus get this plugin's rows APPENDED. If the two lists disagree the
 * user sees a missing row in one place and a duplicate in the other, so the
 * inventory and the ordering are worth pinning down.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  PLUGIN_PROJECT_ACTIONS,
  PLUGIN_SESSION_ACTIONS,
  OFFICIAL_PROJECT_ACTIONS,
  OFFICIAL_SESSION_ACTIONS,
  projectMenuActions,
  sessionMenuActions,
  pluginProjectRows,
  pluginSessionRows,
} = await import('../src/client/row-menu.ts')

const fs = await import('node:fs')

/** Read one of this plugin's sources, for assertions about how it is wired. */
const readSource = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8')

/** Every name the switch in menu-icons.tsx handles, read from its source. */
const iconSource = readSource('../src/client/menu-icons.tsx')

const ids = (rows) => rows.map((row) => row.id)

test('every declared row carries an icon the renderer knows', () => {
  // A name with no case in the switch renders an EMPTY slot: the row still works,
  // so the bug shows up only as a misaligned menu. Compare the two lists.
  const declared = new Set()
  for (const rows of [
    projectMenuActions({ pinned: true }),
    projectMenuActions({ pinned: false }),
    sessionMenuActions({ pinned: true, exporting: false, hasFolder: true }),
    sessionMenuActions({ pinned: false, exporting: true, hasFolder: false }),
    pluginProjectRows({ pinned: false, enabled: {} }),
    pluginProjectRows({ pinned: true, enabled: {} }),
  ]) {
    for (const row of rows) declared.add(row.icon)
  }
  for (const name of declared) {
    assert.ok(typeof name === 'string' && name !== '', `row icon must be a name, got ${String(name)}`)
    assert.match(
      iconSource,
      new RegExp(`case '${name}':`),
      `icon '${name}' has no case in menu-icons.tsx, so its slot would render empty`,
    )
  }
})

test('every row declares an icon at all', () => {
  const all = [
    ...OFFICIAL_PROJECT_ACTIONS,
    ...PLUGIN_PROJECT_ACTIONS,
    ...OFFICIAL_SESSION_ACTIONS,
    ...PLUGIN_SESSION_ACTIONS,
  ]
  for (const row of all) {
    assert.ok(row.icon !== undefined, `row ${row.id} has no icon`)
  }
})

test('the destructive row is marked dangerous, as the host\'s delete row is', () => {
  const del = projectMenuActions({ pinned: true }).find((row) => row.id === 'delete')
  assert.equal(del?.danger, true)
  assert.equal(del?.icon, 'trash')
})

test('the pin row swaps glyph along with its label', () => {
  // An unpinned project shows the outline pin and "pin"; a pinned one shows the
  // filled pin and "unpin". The two must move together.
  const unpinned = pluginProjectRows({ pinned: false, enabled: {} }).find((r) => r.id === 'pin')
  const pinned = pluginProjectRows({ pinned: true, enabled: {} }).find((r) => r.id === 'pin')
  assert.deepEqual([unpinned.icon, unpinned.labelKey], ['pin', 'menu.pin'])
  assert.deepEqual([pinned.icon, pinned.labelKey], ['unpin', 'menu.unpin'])
})

test('the unread row is gone for good', () => {
  // Removed by request. It must not survive anywhere in the inventory: a row
  // that still existed would come back the moment the switch defaulted on.
  const rows = pluginSessionRows({ exporting: false, hasFolder: true, enabled: {} })
  assert.equal(ids(rows).includes('unread'), false)
  assert.equal(ids(PLUGIN_SESSION_ACTIONS).includes('unread'), false)
  const all = sessionMenuActions({ pinned: true, exporting: false, hasFolder: true })
  assert.equal(all.some((r) => r.labelKey === 'menu.markUnread'), false)
  assert.equal(all.some((r) => r.labelKey === 'menu.markRead'), false)
})

test('copying a session reference is offered on every session row', () => {
  const rows = pluginSessionRows({ exporting: false, hasFolder: true, enabled: {} })
  const row = rows.find((r) => r.id === 'copyReference')
  assert.ok(row, 'the row must be present')
  assert.equal(row.labelKey, 'menu.copyReference')
  // Glyph coverage for every name is asserted by
  // 'every declared row carries an icon the renderer knows'.
})

test('the plugin session rows carry glyphs and flip with state', () => {
  // This is the surface that was MISSING icons entirely: the official Session
  // menu slot rendered bare labels while the panel's own menu had glyphs.
  const idle = pluginSessionRows({ exporting: false, hasFolder: true, enabled: {} })
  const flagged = pluginSessionRows({ exporting: true, hasFolder: false, enabled: {} })
  for (const rows of [idle, flagged]) {
    for (const row of rows) assert.ok(row.icon, `row ${row.id} must declare an icon`)
  }
  assert.deepEqual(ids(idle), ['copyReference', 'export', 'openFolder'])
})

test('an in-flight export and a folderless session are disabled, not dropped', () => {
  // Capability differences grey the row; they must NOT remove it, or the menu
  // would change shape as the user works and the rows below would move.
  const rows = pluginSessionRows({ exporting: true, hasFolder: false, enabled: {} })
  assert.equal(ids(rows).length, 3, 'all three rows stay present')
  assert.equal(rows.find(r => r.id === 'export').disabled, true)
  assert.equal(rows.find(r => r.id === 'openFolder').disabled, true)
  assert.equal(rows.find(r => r.id === 'copyReference').disabled, undefined)
  assert.equal(rows.find(r => r.id === 'export').labelKey, 'menu.exporting')
})

test('the Settings switches still REMOVE a session row', () => {
  // A switch is a different thing from a capability: off means absent.
  const rows = pluginSessionRows({
    exporting: false, hasFolder: true,
    enabled: { export: false, openFolder: false },
  })
  assert.deepEqual(ids(rows), ['copyReference'])
})

test('the panel session menu and the official one list the same plugin rows', () => {
  // Both derive from one builder, so a glyph or label added for one shows in the
  // other. Compare the plugin-owned slice of each.
  const panel = sessionMenuActions({ pinned: true, exporting: false, hasFolder: true })
    .filter(r => ids(PLUGIN_SESSION_ACTIONS).includes(r.id))
  const official = pluginSessionRows({ exporting: false, hasFolder: true, enabled: {} })
  assert.deepEqual(
    panel.map(r => [r.id, r.labelKey, r.icon]),
    official.map(r => [r.id, r.labelKey, r.icon]),
  )
})

test('the session menu slot renders those glyphs through the shared map', async () => {
  // The slot is a separate file; assert it goes through MenuRowIcon rather than
  // hard-coding a glyph (which is how it ended up without icons at all).
  const source = await readSource('../src/client/SessionMenuExtra.tsx')
  assert.match(source, /<MenuRowIcon name=\{row\.icon\} \/>/, 'the slot must render the row glyph')
  assert.match(source, /pluginSessionRows\(/, 'the slot must use the shared inventory')
})

test('the Settings switches drop rows without reordering the rest', () => {
  const all = pluginProjectRows({ pinned: false, enabled: {} })
  const some = pluginProjectRows({
    pinned: false,
    enabled: { editBinding: false, copyPath: false },
  })
  assert.deepEqual(ids(some), ['pin', 'openExplorer', 'newSession'])
  assert.ok(some.length < all.length)
})

test('the pin row follows the project\'s current state', () => {
  // The same row id must read "pin" on an unpinned project and "unpin" on a
  // pinned one, which is what keeps the appended and panel menus identical.
  const unpinned = pluginProjectRows({ pinned: false, enabled: {} }).find((r) => r.id === 'pin')
  const pinned = pluginProjectRows({ pinned: true, enabled: {} }).find((r) => r.id === 'pin')
  assert.equal(unpinned?.labelKey, 'menu.pin')
  assert.equal(pinned?.labelKey, 'menu.unpin')
})

test('the plugin never re-declares a row the host already ships', () => {
  // A duplicate id is exactly the failure that would double a menu entry.
  for (const action of PLUGIN_PROJECT_ACTIONS) {
    assert.ok(
      !OFFICIAL_PROJECT_ACTIONS.some((official) => official.id === action.id),
      `project action ${action.id} shadows an official row`,
    )
  }
  for (const action of PLUGIN_SESSION_ACTIONS) {
    assert.ok(
      !OFFICIAL_SESSION_ACTIONS.some((official) => official.id === action.id),
      `session action ${action.id} shadows an official row`,
    )
  }
})

test('the panel project menu is the host rows then the plugin rows', () => {
  const menu = projectMenuActions({ pinned: true })
  assert.deepEqual(
    ids(menu),
    [...ids(OFFICIAL_PROJECT_ACTIONS), ...ids(PLUGIN_PROJECT_ACTIONS)],
  )
})

test('the project pin row follows the REAL state, exactly one way round', () => {
  // The shipped bug, and the same one that was on session rows: the label was
  // hard-coded to "unpin" because "the panel only lists pinned projects". The
  // executor TOGGLES, so the second use of that row would re-pin while still
  // reading "unpin" — the row doing the opposite of what it says.
  const pinned = projectMenuActions({ pinned: true }).find((a) => a.id === 'pin')
  const unpinned = projectMenuActions({ pinned: false }).find((a) => a.id === 'pin')
  assert.equal(pinned?.labelKey, 'menu.unpin')
  assert.equal(pinned?.icon, 'unpin')
  assert.equal(unpinned?.labelKey, 'menu.pin')
  assert.equal(unpinned?.icon, 'pin')

  // Exactly one pin row in either state, so the strip never shows both.
  for (const menu of [projectMenuActions({ pinned: true }), projectMenuActions({ pinned: false })]) {
    assert.equal(ids(menu).filter((id) => id === 'pin').length, 1)
  }
})

test('the session menu offers pin or unpin to match the row’s REAL state', () => {
  // The shipped bug: this row was hard-coded to "unpin", on the reasoning that
  // the panel only listed pinned sessions. It does not — a pinned PROJECT lists
  // every session in that workspace, so most rows are not individually pinned,
  // and "unpin" on one of those silently drops a pin the user never placed.
  const pinned = ids(sessionMenuActions({ pinned: true, exporting: false, hasFolder: true }))
  const unpinned = ids(sessionMenuActions({ pinned: false, exporting: false, hasFolder: true }))

  assert.ok(pinned.includes('unpinSession'), 'a pinned row must offer unpin')
  assert.ok(!pinned.includes('pinSession'), 'a pinned row must not offer pin')

  assert.ok(unpinned.includes('pinSession'), 'an unpinned row must offer pin')
  assert.ok(!unpinned.includes('unpinSession'), 'an unpinned row must not offer unpin')

  // Exactly one pin row either way, so the strip never shows both.
  const pinRows = (menu) => menu.filter((id) => id === 'pinSession' || id === 'unpinSession')
  assert.equal(pinRows(pinned).length, 1)
  assert.equal(pinRows(unpinned).length, 1)
})

test('the panel session menu keeps the host rows in their official order', () => {
  const menu = ids(sessionMenuActions({ pinned: true, exporting: false, hasFolder: true }))
  const hostOrder = menu.filter((id) => ids(OFFICIAL_SESSION_ACTIONS).includes(id))
  assert.deepEqual(hostOrder, ids(OFFICIAL_SESSION_ACTIONS))
  // The plugin's additions follow the host's rows, as they do in the real menu.
  const firstPlugin = menu.indexOf(PLUGIN_SESSION_ACTIONS[0].id)
  assert.ok(firstPlugin > menu.indexOf(OFFICIAL_SESSION_ACTIONS.at(-1).id))
})



test('an in-flight export labels its row instead of hiding it', () => {
  const exporting = sessionMenuActions({ pinned: true, exporting: true, hasFolder: true })
    .find((action) => action.id === 'export')
  assert.equal(exporting?.labelKey, 'menu.exporting')
})
