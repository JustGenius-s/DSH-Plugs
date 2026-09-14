/**
 * Settings-page UX contracts for 随手笔记.
 *
 * These are the interactions that made the first page unusable: nested tabs,
 * a checkbox that also opened the note, a bulk bar sitting on zero selection,
 * and an in-page editor fighting the settings column. They are pinned against
 * the source so a later "just add a tab" cannot sneak back in.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const section = await readFile(new URL('../src/client/NotesSection.tsx', import.meta.url), 'utf8')
const locales = await readFile(new URL('../src/client/locales.ts', import.meta.url), 'utf8')
const entry = await readFile(new URL('../src/client/index.tsx', import.meta.url), 'utf8')

test('settings is one column: no nested tabs and no in-page editor', () => {
  assert.doesNotMatch(section, /type Tab =/)
  assert.doesNotMatch(section, /tabNotes|tabTags|tabTrash|tabSettings/)
  assert.doesNotMatch(section, /StickyEditor/, 'the floating card is the editor')
  assert.match(section, /<SettingsSection/)
  assert.match(section, /<SwitchField/)
})

test('settings subscribe to the live scope instead of a snapshot inject', () => {
  assert.match(entry, /inject: \(\): NotesSectionInjected => \(\{ store, t, scope \}\)/)
  assert.doesNotMatch(entry, /onConfigChange/)
  assert.match(section, /scope\?\.subscribe/)
  assert.match(section, /void scope\.set\(field, value\)/)
})

test('the title click opens a card; the checkbox only selects', () => {
  const row = section.slice(section.indexOf('function NoteRow'), section.indexOf('function ShortcutButton'))
  assert.match(row, /<input\s+type="checkbox"/)
  assert.match(row, /<button type="button" className=\{styles\.main\} onClick=\{props\.onOpen\}/)
  assert.doesNotMatch(row, /<label/, 'wrapping the title in a label would toggle selection')
  assert.match(section, /onOpen=\{\(\) => store\.openNote\(note\.id\)\}/)
})

test('the bulk toolbar is hidden until something is selected', () => {
  assert.match(section, /\{selected\.length > 0 \? \(/)
  assert.match(section, /removeTags: \[tagFilter\]/)
  assert.doesNotMatch(section, /removeTags: selected\.flatMap/)
})

test('deleting a tag is a two-step confirm, not an immediate click', () => {
  assert.match(section, /confirmTag/)
  assert.match(section, /setConfirmTag\(true\)/)
  assert.match(section, /void store\.deleteTag\(tagFilter\)/)
})

test('locale has no leftover tab or hint keys', () => {
  assert.doesNotMatch(locales, /tabNotes|pickNote|metadataRetryHint|tagsPlaceholder/)
})

test('settings has archive but no recycle bin', () => {
  assert.match(section, /scopeArchived/)
  assert.doesNotMatch(section, /scopeTrash|empty-trash|deleteForever|confirmEmptyTrash/)
  assert.doesNotMatch(locales, /scopeTrash|emptyTrash|deleteForever/)
})

test('the archived list shows unarchive and delete, not pin', () => {
  const row = section.slice(section.indexOf('function NoteRow'), section.indexOf('function ShortcutButton'))
  assert.match(row, /archived \? \(/)
  const archivedBranch = row.slice(row.indexOf('archived ? ('), row.indexOf(') : ('))
  assert.match(archivedBranch, /t\('unarchive'\)/)
  assert.match(archivedBranch, /t\('deleteNote'\)/)
  assert.doesNotMatch(archivedBranch, /t\('pin'\)|t\('unpin'\)/)
})
