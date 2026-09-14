/**
 * Search, ordering, and the AI metadata rules for 随手笔记.
 *
 * These are the product rules most likely to regress silently: a relevance
 * tweak that buries a pinned note, or a tag round that invents "Frontend"
 * next to an existing "前端". Both are invisible in a single manual check.
 *
 * Assertions read the BUILT bundles: the bundler inlines module-level
 * constants, so source-level names like `MAX_AI_TAGS` no longer exist there.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const host = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')

test('search is case-insensitive across title, body, and tags', () => {
  assert.match(client, /title\.toLowerCase\(\)\.includes\(needle\)/, 'title matches case-insensitively')
  assert.match(client, /body\.toLowerCase\(\)\.includes\(needle\)/, 'body matches case-insensitively')
  assert.match(client, /tags\.some\(\(tag\) => tag\.toLowerCase\(\)\.includes\(needle\)\)/, 'tags are searched too')
  assert.match(client, /needle = query\.trim\(\)\.toLowerCase\(\)/, 'the query itself is normalized')
})

test('pinned notes lead, then the most recently edited', () => {
  assert.match(client, /a\.pinned \? -1 : 1/, 'pinned outranks unpinned')
  assert.match(client, /b\.updatedAt - a\.updatedAt/, 'fresher notes come first')
})

test('a non-empty query ranks by relevance before pinned/fresh', () => {
  assert.match(client, /b\.score - a\.score \|\| compareNotes/, 'score wins, order breaks ties')
  assert.match(client, /score \+= 100/, 'an exact title hit scores highest')
  assert.match(client, /startsWith\(needle\)/, 'a title prefix outranks a mid-title hit')
})

test('archived notes stay out of search unless included', () => {
  assert.match(client, /includeArchived \|\| !\(note\.archived \|\| note\.trashed\)/, 'archived notes are filtered by default')
})

test('notes leave the library only by an explicit delete', () => {
  assert.doesNotMatch(client, /action: "trash"|action: "empty-trash"/)
  assert.doesNotMatch(host, /action === "trash"|action === "empty-trash"/)
  assert.match(host, /action === "delete"/)
  assert.match(client, /action: "delete"/)
  assert.match(host, /trashed: false,\s*archived: true/, 'legacy recycle-bin notes revive as archived')
})

test('AI tags reuse existing tags and invent at most one new tag', () => {
  // Constants are inlined by the bundler, so assert the literal budgets.
  assert.match(host, /Tags: at most \$?\{?String\(3\)\}?/, 'the prompt caps tags at 3')
  assert.match(host, /invent at most .*1.* new tag/, 'the prompt allows at most 1 new tag')
  assert.match(host, /known\.get\(tag\.toLowerCase\(\)\)/, 'existing tags are matched case-insensitively')
  assert.match(host, /invented >= 1/, 'the invention budget is enforced at runtime')
  assert.match(host, /out\.length >= 3/, 'the total tag budget is enforced at runtime')
})

test('the model only ever sees the note text and the existing tag names', () => {
  assert.match(host, /Existing tags: /, 'tag names are sent for reuse')
  assert.doesNotMatch(host, /type: "image"/, 'no image is ever sent to the model')
  assert.match(host, /Note:\\n\$?\{?text\}?/, 'the body is reduced to plain text first')
  assert.match(host, /maxTokens: 512/, 'the labelling call is bounded')
})

test('a failed metadata round keeps the note usable', () => {
  assert.match(host, /metadataState: "failed"/, 'the failure is recorded for the Settings page')
  // The fallback title branch: a note with no generated title still gets a
  // readable one — first line, or a dated title when it holds only images.
  assert.match(host, /isTextless\(note\.body\) \? imageOnlyTitle\(note\.updatedAt\) : firstLineTitle\(note\.body\)/)
  assert.match(host, /"image-only"/, 'the dated title is tagged so AI may replace it later')
  assert.match(client, /firstLineTitle/, 'the browser half shows the first line meanwhile')
})

test('a manual title is not overwritten without confirmation', () => {
  assert.match(host, /force !== true && note\.titleSource === "manual"/, 'manual titles are protected')
  assert.match(host, /kind: "needs-confirm"/, 'the refusal is surfaced rather than silent')
})

test('autosave is debounced but flushed on blur, close, and unload', () => {
  // The constant is inlined, so assert the debounce interval itself.
  assert.match(client, /window\.setTimeout\(\(\) => \{\s*this\.flush\(key\);\s*\}, 500\)/, 'edits debounce 500ms')
  assert.match(client, /beforeunload/, 'a pending edit survives navigation')
  assert.match(client, /pagehide/, 'and the page-hide path too')
  assert.match(client, /window\.clearTimeout/, 'a flush cancels the pending timer')
})

test('closing a card labels the note exactly once', () => {
  assert.match(client, /labelOnClose/, 'closing triggers labelling')
  assert.match(client, /note === void 0 \|\| note\.metadataAttempted/, 'a second close does not re-label')
  assert.match(client, /this\.labelling\.has\(id\)/, 'and a note cannot be labelled twice at once')
})
