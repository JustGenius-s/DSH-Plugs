/**
 * The guard that keeps the official Project-row menu open across this plugin's
 * injected rows.
 *
 * Background, measured on the real app: with only the host's two rows the menu
 * stays open indefinitely; once our rows are injected it closed ~221ms after
 * opening with the pointer completely still. The cause is a React tree boundary
 * — the host's Menu reads "the pointer left me" from React's enter/leave
 * simulation, and our rows are DOM children of the list but React children of
 * another root, so crossing onto them looks like leaving.
 *
 * The guard swallows that one false signal. What matters for correctness is that
 * it swallows NOTHING ELSE: a genuine exit must still reach the host so the menu
 * closes as it always did. These tests pin both halves.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { holdsMenuOpen, movingIntoMenu } = await import('../src/client/menu-pointer-guard.ts')

test('the guard holds the menu while the pointer is inside it', () => {
  assert.equal(holdsMenuOpen({ decorating: true, movedInsideMenu: true, movedInsideRow: false }), true)
})

test('the guard also holds it across the trigger-to-list transit', () => {
  // MEASURED: the event that armed the close had its destination in the row's
  // action strip — the 4px between the trigger button and the list — not in the
  // list itself. A menu-only test let it through and the menu died ~200ms later
  // with the pointer sitting on a row.
  assert.equal(holdsMenuOpen({ decorating: true, movedInsideMenu: false, movedInsideRow: true }), true)
})

test('the guard never interferes when a menu is not ours', () => {
  // A menu we did not decorate is none of our business: swallowing anything there
  // would change the behaviour of every other menu in the app.
  for (const movedInsideMenu of [true, false]) {
    for (const movedInsideRow of [true, false]) {
      assert.equal(holdsMenuOpen({ decorating: false, movedInsideMenu, movedInsideRow }), false)
    }
  }
})

test('a genuine exit still reaches the host', () => {
  // This is the regression that would make the menu impossible to dismiss by
  // moving away: the pointer left both the row and the list, so the host must
  // hear about it.
  assert.equal(holdsMenuOpen({ decorating: true, movedInsideMenu: false, movedInsideRow: false }), false)
})

test('movingIntoMenu needs a real node inside a real menu', () => {
  // A null destination is the pointer leaving the window: a genuine exit, so it
  // must never be treated as "still inside".
  assert.equal(movingIntoMenu(null, null), false)
  // No menu open at all.
  assert.equal(movingIntoMenu(null, {}), false)
  // A destination that is not a DOM node must not be mistaken for one.
  assert.equal(movingIntoMenu({ contains: () => true }, {}), false)
})

test('movingIntoMenu asks the menu whether it contains the destination', () => {
  // The decision is delegated to the menu's own `contains`, so an element inside
  // counts and one outside does not.
  const inside = { nodeType: 1 }
  const outside = { nodeType: 1 }
  const menu = { contains: (node) => node === inside }
  assert.equal(movingIntoMenu(menu, inside), true)
  assert.equal(movingIntoMenu(menu, outside), false)
})

test('the guard uses capture so it runs before the host listener', () => {
  // React attaches at the root container, which is a descendant of document. A
  // bubble-phase listener here would run AFTER React had already simulated the
  // leave, i.e. too late to stop it.
  const source = readFileSync(new URL('../src/client/menu-pointer-guard.ts', import.meta.url), 'utf8')
  const addCalls = source.match(/addEventListener\('pointer(?:out|leave)', onPointerEvent, (\w+)\)/g) ?? []
  assert.equal(addCalls.length, 2, 'both pointerout and pointerleave must be guarded')
  for (const call of addCalls) {
    assert.match(call, /, true\)$/, 'the listener must be registered in the capture phase')
  }
})

test('the guard is released whenever the decorated menu closes', () => {
  // If it stayed armed with no menu open, it would keep intercepting pointer
  // moves over the rest of the app. The watcher must release it on the same
  // transition that clears its published target.
  const watcher = readFileSync(new URL('../src/client/workspace-menu.ts', import.meta.url), 'utf8')
  assert.match(watcher, /guard\.release\(\)/, 'the watcher must release the guard')
  assert.match(watcher, /guard\.arm\(\)/, 'the watcher must arm the guard')
  // Release must happen before the early return for "already null", or a menu
  // that closed while we were not decorating would leave it armed.
  const clearBlock = watcher.slice(watcher.indexOf('if (workspaceId === undefined || host === undefined)'))
  assert.ok(
    clearBlock.indexOf('guard.release()') < clearBlock.indexOf('if (snapshot === null) return'),
    'release must precede the no-op return',
  )
})
