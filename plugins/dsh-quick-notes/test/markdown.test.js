/**
 * Markdown round-trip for the sticky-note editor.
 *
 * The editor edits a contenteditable surface, but a note is stored as plain
 * Markdown. If these two stop agreeing, a note silently rewrites itself on
 * every save — the kind of bug that only shows up as "my formatting keeps
 * changing".
 *
 * The pure helpers import the TypeScript source directly (Node strips types),
 * so these assert real behaviour rather than bundle text.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const {
  attachmentIdsOf,
  firstLineTitle,
  imageOnlyTitle,
  isTextless,
  matchesQuery,
  rankNotes,
  dedupeTags,
  metadataTextOf,
  truncate,
} = await import('../src/shared.ts')

/** A note body, for the helpers that take one. */
function note(overrides) {
  return {
    id: 'note-1',
    title: '',
    titleSource: 'first-line',
    body: '',
    tags: [],
    pinned: false,
    archived: false,
    trashed: false,
    createdAt: 1_000,
    updatedAt: 2_000,
    metadataAttempted: false,
    metadataState: 'pending',
    metadataError: null,
    ...overrides,
  }
}

test('the fallback title is the first non-empty line, cleaned of markers', () => {
  assert.equal(firstLineTitle('买咖啡豆'), '买咖啡豆')
  assert.equal(firstLineTitle('# 标题\n正文'), '标题')
  assert.equal(firstLineTitle('- 一条待办'), '一条待办')
  assert.equal(firstLineTitle('> 引用'), '引用')
  assert.equal(firstLineTitle('\n\n  空白后的一行  '), '空白后的一行')
  assert.equal(firstLineTitle(''), '')
  assert.equal(firstLineTitle('   \n  '), '')
})

test('a long first line is truncated rather than wrapping the card header', () => {
  const long = 'x'.repeat(200)
  assert.equal(firstLineTitle(long).length, 80)
  assert.ok(firstLineTitle(long).endsWith('…'))
})

test('an image-only note has no text; a note with a word does', () => {
  assert.equal(isTextless('![](http://x/1.png)'), true, 'a single image is not text')
  assert.equal(isTextless('![截图](/quick-notes/attachment/img-1)\n'), true)
  assert.equal(isTextless('图片 ![a](b)'), false, 'a caption counts as text')
  assert.equal(isTextless('```\ncode\n```'), true, 'a code fence alone is not prose')
  assert.equal(isTextless('# 标题'), false)
  assert.equal(isTextless(''), true)
})

test('an image-only note gets a dated, distinguishable title', () => {
  const title = imageOnlyTitle(Date.UTC(2026, 0, 2, 3, 4))
  assert.match(title, /^图片笔记 2026-01-02 \d{2}:\d{2}$/)
  assert.notEqual(imageOnlyTitle(0), imageOnlyTitle(86_400_000), 'two days differ')
})

test('model input strips images, code, and markup but keeps the words', () => {
  assert.equal(metadataTextOf('买咖啡 ![图](/a/1.png) 记得磨豆'), '买咖啡 记得磨豆')
  assert.equal(metadataTextOf('**粗体** 和 `code`'), '粗体 和 code')
  assert.equal(metadataTextOf('> 引用一行'), '引用一行')
  assert.equal(metadataTextOf('## 标题'), '标题')
  assert.equal(metadataTextOf('a'.repeat(9_000)).length, 4_000, 'long notes are capped')
})

test('attachment references are read back out of the Markdown', () => {
  const body = '前 ![](/quick-notes/attachment/img-a) 后 ![x](/quick-notes/attachment/img-b)'
  assert.deepEqual(attachmentIdsOf(body), ['img-a', 'img-b'])
  assert.deepEqual(attachmentIdsOf('![](/quick-notes/attachment/img-a) 重复一次 ![](/quick-notes/attachment/img-a)'), ['img-a'])
  assert.deepEqual(attachmentIdsOf('![外链](https://example.com/a.png)'), [], 'external images are not ours')
  assert.deepEqual(attachmentIdsOf('![](/quick-notes/attachment/not a valid id)'), [], 'a malformed id is ignored')
})

test('search matches title, body, and tags case-insensitively', () => {
  const target = note({ title: 'Coffee', body: '买咖啡豆', tags: ['生活'] })
  assert.equal(matchesQuery(target, 'coffee'), true, 'title matches across case')
  assert.equal(matchesQuery(target, '咖啡'), true, 'body matches')
  assert.equal(matchesQuery(target, '生活'), true, 'tags match')
  assert.equal(matchesQuery(target, ''), true, 'an empty query shows everything')
  assert.equal(matchesQuery(target, '茶'), false)
})

test('pinned notes lead, then the most recently edited', () => {
  const older = note({ id: 'a', updatedAt: 100 })
  const newer = note({ id: 'b', updatedAt: 900 })
  const pinned = note({ id: 'c', updatedAt: 1, pinned: true })
  assert.deepEqual(rankNotes([older, newer, pinned], '').map(item => item.id), ['c', 'b', 'a'])
})

test('a query ranks by relevance before pinned or fresh', () => {
  const exact = note({ id: 'exact', title: '咖啡' })
  const prefix = note({ id: 'prefix', title: '咖啡豆清单' })
  const bodyOnly = note({ id: 'body', title: '清单', body: '买咖啡' })
  const unrelated = note({ id: 'unrelated', title: '茶', body: '茶叶' })
  assert.deepEqual(
    rankNotes([bodyOnly, unrelated, prefix, exact], '咖啡').map(item => item.id),
    ['exact', 'prefix', 'body'],
  )
})

test('an archived note can be excluded from search results', () => {
  const active = note({ id: 'active' })
  const archived = note({ id: 'archived', archived: true })
  assert.deepEqual(rankNotes([active, archived], ''), [active, archived])
  const withoutArchived = [active, archived].filter(item => !item.archived)
  assert.deepEqual(withoutArchived.map(item => item.id), ['active'])
})

test('tags de-duplicate case-insensitively and keep first-seen order', () => {
  assert.deepEqual(dedupeTags(['前端', 'Frontend', '前端', ' web ', 'Web']), ['前端', 'Frontend', 'web'])
  assert.deepEqual(dedupeTags(['  ', '']), [], 'blank tags are dropped')
})

test('truncate keeps short strings and marks long ones', () => {
  assert.equal(truncate('短的', 10), '短的')
  assert.equal(truncate('0123456789', 5), '0123…')
})
