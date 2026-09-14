import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
const intentStart = source.indexOf('function cardTitleIntent')
const intentEnd = source.indexOf('function cardActions', intentStart)
assert.ok(intentStart >= 0 && intentEnd > intentStart)
const cardTitleIntent = new Function(`${source.slice(intentStart, intentEnd)}; return cardTitleIntent`)()
const card = { id: 'card', question: 'Question' }
const doubleClick = { type: 'dblclick', button: 0 }

test('only a title double-click requests renaming, not either preceding single-click event', () => {
  for (const detail of [1, 2]) {
    assert.equal(cardTitleIntent(card, { type: 'click', detail, button: 0 }), null)
  }
  assert.equal(cardTitleIntent(card, doubleClick), 'rename-card')
  assert.equal(cardTitleIntent(card, { ...doubleClick, button: 1 }), null)
  assert.equal(cardTitleIntent(card, { ...doubleClick, button: 2 }), null)
})

test('title renaming supports keyboard activation without consuming composition or modified gestures', () => {
  for (const key of ['Enter', ' ', 'F2']) {
    assert.equal(cardTitleIntent(card, { type: 'keydown', key }), 'rename-card')
    assert.equal(cardTitleIntent(card, { type: 'keydown', key, isComposing: true }), null)
    assert.equal(cardTitleIntent(card, { type: 'keydown', key, repeat: true }), null)
  }
  for (const key of ['Escape', 'Tab', 'a']) {
    assert.equal(cardTitleIntent(card, { type: 'keydown', key }), null)
  }
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'defaultPrevented']) {
    assert.equal(cardTitleIntent(card, { ...doubleClick, [modifier]: true }), null)
  }
})

test('missing, blank, hidden, or busy cards do not start title editing', () => {
  for (const unavailable of [undefined, null, { ...card, blank: true }, { ...card, hidden: true }]) {
    assert.equal(cardTitleIntent(unavailable, doubleClick), null)
  }
  assert.equal(cardTitleIntent(card, doubleClick, true), null)
  assert.equal(cardTitleIntent({ ...card, status: 'running' }, doubleClick), 'rename-card')
})

function renameHarness(cards = [card], visibilityMutation = null) {
  const state = {
    canvasCardsById: new Map(cards.map(card => [card.id, card])),
    renamingCardId: null,
    inspectorCardId: 'another-card',
    activeId: 'thread',
    visibilityMutation,
  }
  let refreshes = 0
  const start = source.indexOf('function beginCardRename')
  const end = source.indexOf('async function commitCardRename', start)
  assert.ok(start >= 0 && end > start)
  const beginCardRename = new Function('state', 'render', `${source.slice(start, end)}; return beginCardRename`)(state, () => { refreshes += 1 })
  return { state, beginCardRename, refreshes: () => refreshes }
}

test('title and inspector actions share the existing editor without opening or changing the inspector', () => {
  const { state, beginCardRename, refreshes } = renameHarness()
  beginCardRename(card.id)
  assert.equal(state.renamingCardId, card.id)
  assert.equal(state.inspectorCardId, 'another-card')
  assert.equal(state.activeId, 'thread')
  assert.equal(refreshes(), 1)
})

test('the rename entry point also protects stale targets and visibility changes', () => {
  const cases = [
    [[], null],
    [[{ ...card, blank: true }], null],
    [[{ ...card, hidden: true }], null],
    [[card], { workspaceId: 'workspace' }],
  ]
  for (const args of cases) {
    const { state, beginCardRename, refreshes } = renameHarness(...args)
    beginCardRename(card.id)
    assert.equal(state.renamingCardId, null)
    assert.equal(refreshes(), 0)
  }
})
