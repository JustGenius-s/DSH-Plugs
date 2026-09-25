/**
 * Keeping a row marked while its own menu is open.
 *
 * The bug this guards: the menu opens 4px below the row, so the pointer crosses
 * a strip belonging to neither the trigger nor the list on its way down. The row
 * used to close on pointer-leave after a 200ms grace, which an unhurried hand
 * beats — the menu shut while the user was reaching for a row INSIDE it. The
 * dismissal is now outside-click/Escape/selection, and the row marks itself so
 * the trigger stays rendered while its menu is up.
 *
 * Both halves are easy to undo by accident (re-adding the pointer-leave close is
 * one prop), so the reader of this file should treat it as a regression guard.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { MENU_OPEN_ATTRIBUTE, menuOpenAttribute } = await import('../src/client/menu-open.ts')

const panelSource = readFileSync(new URL('../src/client/PinnedPanel.tsx', import.meta.url), 'utf8')

test('an open row carries the attribute and a closed one does not', () => {
  assert.deepEqual(menuOpenAttribute(true), { [MENU_OPEN_ATTRIBUTE]: '' })
  assert.deepEqual(menuOpenAttribute(false), {})
})

test('the attribute is a data attribute, not a hashed class', () => {
  // The panel's CSS-module classes are hashed per build, so a class could not be
  // matched reliably from the stylesheet; the panel already keys styling off
  // data attributes for this reason.
  assert.match(MENU_OPEN_ATTRIBUTE, /^data-/)
})

test('the panel never closes a row menu on pointer-leave', () => {
  // This is the regression itself. `closeOnPointerLeave` arms a 200ms close when
  // the pointer leaves the TRIGGER's box — which, inside a 34px row holding a
  // 16px button, happens well before the pointer reaches the menu. Re-adding it
  // reintroduces "the menu disappears as I move down into it".
  assert.ok(
    !panelSource.includes('closeOnPointerLeave'),
    'a row menu must dismiss on outside click / Escape / selection, not on pointer-leave',
  )
})

test('the stylesheet keeps the action strip laid out while a menu is open', () => {
  // Without this the trigger unmounts from the layout as soon as the pointer
  // leaves the row, so the user cannot see which row the open menu belongs to.
  const css = readFileSync(new URL('../src/client/PinnedPanel.module.css', import.meta.url), 'utf8')
  assert.ok(
    css.includes(`[${MENU_OPEN_ATTRIBUTE}] .actions`)
      || css.includes(`[${MENU_OPEN_ATTRIBUTE}]`),
    'the row must restyle itself from the menu-open attribute',
  )
})

test('each row kind computes its own menu key', () => {
  // A nested session row must not light up because its PROJECT's menu is open:
  // keys are namespaced by kind, so the two can never collide.
  assert.ok(panelSource.includes('`workspace:${row.id}`'), 'project rows key by workspace')
  assert.ok(panelSource.includes('`session:${session.id}`'), 'session rows key by session')
})
