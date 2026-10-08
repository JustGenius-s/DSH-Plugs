/**
 * Settings-page UX contracts for 会话归档.
 *
 * These pin the two interactions that made the page unusable: a delete that
 * reloaded the whole page (so the list blanked mid-action), and an archive set
 * with no way back — the page had Delete and nothing else. They are asserted
 * against the source so a later edit cannot quietly restore either.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const section = await readFile(new URL('../src/client/ArchiveSection.tsx', import.meta.url), 'utf8')
const locales = await readFile(new URL('../src/client/locales.ts', import.meta.url), 'utf8')
const viewState = await readFile(new URL('../src/client/view-state.ts', import.meta.url), 'utf8')

test('every row offers both unarchive and delete', () => {
  assert.match(section, /UNARCHIVE_PATH/)
  assert.match(section, /translate\('unarchive'\)/)
  assert.match(section, /mutate\(session\.id, 'unarchive'\)/)
  assert.match(section, /mutate\(session\.id, 'delete'\)/)
})

test('both dictionaries carry the unarchive action and its progress label', () => {
  for (const key of ['unarchive', 'unarchiving', 'unarchiveFailed', 'deleting']) {
    assert.match(locales, new RegExp(`\\| '${key}'`), `${key} must be a declared ArchiveKey`)
    assert.equal(locales.match(new RegExp(`^\\s*${key}:`, 'gm'))?.length, 2, `${key} needs zh and en`)
  }
})

test('the section never renders its loading status over already-rendered rows', () => {
  // The reading status belongs to the first load only; a refresh keeps rows up
  // and reports through the list notice or the row itself.
  assert.match(section, /const firstLoad = !view\.loaded/)
  assert.match(section, /\{firstLoad && view\.status === 'loading' \? <StatusText>\{translate\('loading'\)\}<\/StatusText> : null\}/)
  assert.match(section, /<SettingsSection busy=\{firstLoad\}>/)
  assert.match(viewState, /export function blockingError/)
  assert.match(viewState, /export function refreshNotice/)
})

test('mutation results are reported on their own row', () => {
  assert.match(section, /const pending = pendingActionOf\(view, session\.id\)/)
  assert.match(section, /const rowError = rowErrorOf\(view, session\.id\)/)
  assert.match(section, /disabled=\{busy\}/)
  assert.match(section, /styles\.rowError/)
  // No section-wide busy gate: only the mutating row is disabled.
  assert.doesNotMatch(section, /disabled=\{busyId !== null\}/)
  assert.doesNotMatch(section, /\bbusyId\b/)
})

test('the delete confirm shows progress in the button it was clicked on', () => {
  const confirm = section.slice(section.indexOf("{confirming ? ("), section.indexOf(') : ('))
  assert.match(confirm, /pending === 'delete' \? translate\('deleting'\) : translate\('delete'\)/)
  assert.match(confirm, /disabled=\{busy\}/)
})

test('the list is re-read through the shared reload, never by remounting', () => {
  assert.match(section, /refresh: reload/)
  assert.match(viewState, /if \(await refresh\(\)\) dispatch\(\{ type: 'mutation-settled', id \}\)/)
  assert.doesNotMatch(section, /window\.location|location\.reload/)
})
