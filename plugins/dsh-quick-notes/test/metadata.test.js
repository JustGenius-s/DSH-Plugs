/**
 * AI title and tag generation for 随手笔记.
 *
 * The subtle rules live here: reuse an existing tag before inventing one,
 * never spend more than one new tag per note, and never let an unparseable
 * model reply make a note unreadable. These import the TypeScript source
 * directly, so they exercise the shipped logic rather than bundle text.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { parseMetadata, pickTags } = await import('../src/metadata.ts')

const EXISTING = ['前端', '生活', 'DeepSeek']

test('the model reply is parsed even inside a code fence', () => {
  assert.deepEqual(parseMetadata('{"title":"买咖啡豆","tags":["生活"]}'), {
    title: '买咖啡豆',
    tags: ['生活'],
  })
  assert.deepEqual(parseMetadata('```json\n{"title":"买咖啡豆","tags":[]}\n```'), {
    title: '买咖啡豆',
    tags: [],
  })
})

test('a reply with prose around the JSON still parses', () => {
  assert.deepEqual(
    parseMetadata('Sure! {"title":"周会纪要","tags":["工作"]} hope that helps'),
    { title: '周会纪要', tags: ['工作'] },
  )
})

test('an unusable reply is rejected rather than half-applied', () => {
  assert.equal(parseMetadata(''), null, 'an empty reply is not a label')
  assert.equal(parseMetadata('抱歉，我无法完成'), null, 'prose with no JSON is not a label')
  assert.equal(parseMetadata('{"tags":[]}'), null, 'no title and no tags is not a label')
  assert.equal(parseMetadata('{not json}'), null, 'malformed JSON is not a label')
})

test('an existing tag is reused before a new one is invented', () => {
  assert.deepEqual(pickTags(['生活', '咖啡'], EXISTING), ['生活', '咖啡'])
  assert.deepEqual(pickTags(['前端'], EXISTING), ['前端'])
})

test('tag reuse is case-insensitive and keeps the stored spelling', () => {
  // "deepseek" should become the existing "DeepSeek", not a second tag.
  assert.deepEqual(pickTags(['deepseek'], EXISTING), ['DeepSeek'])
  assert.deepEqual(pickTags(['DEEPSEEK', '前端'], EXISTING), ['DeepSeek', '前端'])
})

test('at most one brand-new tag is invented per round', () => {
  const picked = pickTags(['咖啡', '手冲', '器具'], EXISTING)
  const invented = picked.filter(tag => !EXISTING.includes(tag))
  assert.equal(invented.length, 1, 'only one new tag survives')
  assert.deepEqual(picked, ['咖啡'], 'the first suggestion wins')
})

test('at most three tags are attached in total', () => {
  const picked = pickTags(['前端', '生活', 'DeepSeek', '咖啡', '手冲'], EXISTING)
  assert.equal(picked.length, 3)
  assert.deepEqual(picked, ['前端', '生活', 'DeepSeek'], 'existing tags fill the budget first')
})

test('a leading # and stray blanks are cleaned off a suggested tag', () => {
  assert.deepEqual(pickTags(['#咖啡', '  ', ''], EXISTING), ['咖啡'])
})

test('duplicate suggestions collapse to one tag', () => {
  assert.deepEqual(pickTags(['咖啡', '咖啡'], EXISTING), ['咖啡'])
})

test('an empty suggestion list leaves the note untagged', () => {
  assert.deepEqual(pickTags([], EXISTING), [])
})
