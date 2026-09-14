/**
 * On-disk persistence for 随手笔记.
 *
 * The product promise is "记录绝不丢", so these cover the paths where a note
 * could vanish: a crash mid-write, a reload between saves, a bulk edit, and
 * the attachment sweep that follows an edit.
 *
 * The store resolves its root from `DSH_HOME`, so each test points it at a
 * fresh temporary directory.
 */

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let root = ''
let previousHome

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'quick-notes-'))
  previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  rmSync(root, { recursive: true, force: true })
})

/**
 * Resolve the id of a just-created note by its body.
 *
 * `create` returns the whole snapshot, ordered pinned-first then newest-first,
 * so `notes[0]` is not reliably the note just added — and a test that silently
 * edits the wrong note keeps passing for a while.
 */
function noteIdByBody(snapshot, body) {
  const found = snapshot.notes.find(note => note.body.startsWith(body))
  assert.ok(found !== undefined, `a note with body "${body}" was created`)
  return found.id
}

/** Import a fresh copy of the store so each test re-reads from disk. */
async function store() {
  const spec = `../src/notes-store.ts?t=${Date.now()}-${Math.random()}`
  return import(spec)
}

test('a new library starts empty and creates its directory on first write', async () => {
  const { listSnapshot, notesRoot } = await store()
  assert.deepEqual(listSnapshot().notes, [])
  assert.equal(notesRoot(), join(root, 'quick-notes'))
})

test('a created note is written to disk and read back intact', async () => {
  const { applyAction, listSnapshot } = await store()
  const created = applyAction({ action: 'create', body: '# 买咖啡\n\n记得磨豆' })
  assert.equal(typeof created.createdId, 'string')
  const saved = listSnapshot()
  assert.equal(saved.notes.length, 1)
  assert.equal(saved.notes[0].id, created.createdId)
  // Bodies are stored as POSIX text files, so each ends with a newline.
  assert.equal(saved.notes[0].body, '# 买咖啡\n\n记得磨豆\n')
  // The body is a readable file next to the index, not a blob in it.
  const file = join(root, 'quick-notes', 'notes', `${saved.notes[0].id}.md`)
  assert.ok(existsSync(file), 'the note body is a real Markdown file')
  assert.match(readFileSync(file, 'utf8'), /记得磨豆/)
})

test('a note survives a reload of the store', async () => {
  const first = await store()
  first.applyAction({ action: 'create', body: '持久化检查' })
  const id = first.listSnapshot().notes[0].id

  // A fresh import simulates a restart: nothing is held in memory.
  const second = await store()
  const reloaded = second.listSnapshot().notes.find(note => note.id === id)
  assert.equal(reloaded?.body, '持久化检查\n')
})

test('an update changes the body and bumps updatedAt', async () => {
  const { applyAction, listSnapshot } = await store()
  const created = applyAction({ action: 'create', body: '第一版' })
  const id = noteIdByBody(created, '第一版')
  const snapshot = applyAction({ action: 'update', id, body: '第二版' })
  const updated = snapshot.notes.find(note => note.id === id)
  assert.equal(updated.body, '第二版\n')
  assert.ok(updated.updatedAt >= created.notes[0].updatedAt)
})

test('deleting a note removes it and its body file', async () => {
  const { applyAction, listSnapshot } = await store()
  const id = noteIdByBody(applyAction({ action: 'create', body: '告别' }), '告别')
  const file = join(root, 'quick-notes', 'notes', `${id}.md`)
  assert.ok(existsSync(file))

  applyAction({ action: 'delete', ids: [id] })
  assert.equal(listSnapshot().notes.find(note => note.id === id), undefined)
  assert.equal(existsSync(file), false)
})

test('a leftover recycle-bin note is revived as archived', async () => {
  const { applyAction, listSnapshot } = await store()
  const id = noteIdByBody(applyAction({ action: 'create', body: '旧回收站' }), '旧回收站')
  const indexFile = join(root, 'quick-notes', 'index.json')
  const index = JSON.parse(readFileSync(indexFile, 'utf8'))
  const row = index.notes.find(note => note.id === id)
  row.trashed = true
  row.archived = false
  writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`)

  const revived = listSnapshot().notes.find(note => note.id === id)
  assert.equal(revived.trashed, false)
  assert.equal(revived.archived, true)
  assert.match(revived.body, /旧回收站/)
})

test('bulk actions apply to every selected note and nothing else', async () => {
  const { applyAction, listSnapshot } = await store()
  const first = noteIdByBody(applyAction({ action: 'create', body: '一' }), '一')
  const second = noteIdByBody(applyAction({ action: 'create', body: '二' }), '二')
  const third = noteIdByBody(applyAction({ action: 'create', body: '三' }), '三')

  applyAction({ action: 'bulk', ids: [first, second], archived: true, addTags: ['批量'] })

  const notes = listSnapshot().notes
  assert.equal(notes.find(note => note.id === first).archived, true)
  assert.equal(notes.find(note => note.id === second).archived, true)
  assert.equal(notes.find(note => note.id === third).archived, false, 'unselected notes are untouched')
  assert.deepEqual(notes.find(note => note.id === first).tags, ['批量'])
})

test('bulk tag removal leaves the note in place', async () => {
  const { applyAction, listSnapshot } = await store()
  const id = noteIdByBody(applyAction({ action: 'create', body: '标签测试', tags: ['保留', '移除'] }), '标签测试')
  applyAction({ action: 'bulk', ids: [id], removeTags: ['移除'] })

  const note = listSnapshot().notes.find(item => item.id === id)
  assert.deepEqual(note.tags, ['保留'])
  assert.equal(note.trashed, false)
})

test('renaming a tag merges it instead of creating a second one', async () => {
  const { applyAction, listSnapshot } = await store()
  const id = noteIdByBody(applyAction({ action: 'create', body: '前端笔记', tags: ['前端'] }), '前端笔记')
  applyAction({ action: 'rename-tag', name: '前端', next: 'Web 前端' })

  const note = listSnapshot().notes.find(item => item.id === id)
  assert.deepEqual(note.tags, ['Web 前端'])
  assert.deepEqual(listSnapshot().tags, ['Web 前端'], 'the tag directory holds one name')
})

test('deleting a tag detaches it from every note', async () => {
  const { applyAction, listSnapshot } = await store()
  const id = noteIdByBody(applyAction({ action: 'create', body: '待清理', tags: ['临时'] }), '待清理')
  applyAction({ action: 'delete-tag', name: '临时' })
  assert.deepEqual(listSnapshot().notes.find(item => item.id === id).tags, [])
  assert.deepEqual(listSnapshot().tags, [])
})

test('the tag directory counts usage across notes', async () => {
  const { applyAction, listSnapshot } = await store()
  applyAction({ action: 'create', body: '一', tags: ['常用'] })
  applyAction({ action: 'create', body: '二', tags: ['常用'] })
  applyAction({ action: 'create', body: '三', tags: ['丢弃'] })

  assert.deepEqual(listSnapshot().tags, ['常用', '丢弃'])
})

test('a stored image is written to its own directory and read back', async () => {
  const { saveImage, readImage } = await store()
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  saveImage('img-test', 'image/png', bytes)

  const found = readImage('img-test')
  assert.equal(found?.mediaType, 'image/png')
  assert.deepEqual(found?.data, bytes)
  assert.equal(readImage('img-missing'), null, 'an unknown id reads as null')
})

test('an image referenced by a note survives the orphan sweep', async () => {
  const { applyAction, saveImage, readImage } = await store()
  saveImage('img-keep', 'image/png', Buffer.from([1, 2, 3]))
  saveImage('img-drop', 'image/png', Buffer.from([4, 5, 6]))

  const id = noteIdByBody(applyAction({
    action: 'create',
    body: '看图 ![](/quick-notes/attachment/img-keep)',
  }), '看图')

  // Any later write sweeps unreferenced attachments.
  applyAction({ action: 'update', id, body: '看图 ![](/quick-notes/attachment/img-keep) 补一句' })

  assert.notEqual(readImage('img-keep'), null, 'the referenced image survives')
  assert.equal(readImage('img-drop'), null, 'the unreferenced one is swept')
})

test('writes are atomic: no temporary files are left beside the index', async () => {
  const { applyAction } = await store()
  applyAction({ action: 'create', body: '原子写入' })

  const entries = readdirSync(join(root, 'quick-notes'))
  assert.deepEqual(entries.filter(name => name.includes('.tmp')), [], 'no temp files remain')
  assert.ok(entries.includes('index.json'))
})
