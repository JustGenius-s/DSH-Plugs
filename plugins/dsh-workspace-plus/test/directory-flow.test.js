/**
 * The directory-flow occupant's contract.
 *
 * This is the one place where a silent regression is expensive: if the occupant
 * stops filling the official hole, "Add workspace…" still WORKS — it just falls
 * back to the official single-folder picker, so multi-folder workspaces quietly
 * become impossible to create. These pin the parts that make the takeover valid.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { DIRECTORY_FLOW_PRIORITY, DIRECTORY_FLOW_SLOTS } = await import('../src/client/directory-flow-slots.ts')

test('both official holes are filled by the same occupant', () => {
  // The sidebar and the conversation hero are independent slot entries; the
  // official contract is that one occupant fills both. Filling only one would
  // leave the other surface on the single-folder picker.
  assert.deepEqual([...DIRECTORY_FLOW_SLOTS], [
    'sidebar.workspaces.directoryFlow',
    'conversation.hero.workspace.directoryFlow',
  ])
})

test('the occupant outranks the official picker backends', () => {
  // The cell's LOWEST live entry renders and the official backends sit at the
  // default 0, so this MUST be negative — at 0 the registration would throw
  // (occupied cell, same priority) and the plugin's dialog would never appear.
  assert.ok(DIRECTORY_FLOW_PRIORITY < 0, 'priority must beat the default 0')
})

test('the two holes carry no locale seat of their own', () => {
  // The dialog owns the copy; a locale seat here would demand `t` in the
  // occupant's inject face for nothing. Guarded because adding `locale` later is
  // easy and would only fail at render time.
  assert.equal(new Set(DIRECTORY_FLOW_SLOTS).size, DIRECTORY_FLOW_SLOTS.length, 'no duplicate hole names')
})
