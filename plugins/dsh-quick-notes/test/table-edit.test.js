/**
 * Table editing policy for the sticky-note surface.
 *
 * The editor is a contenteditable, so Tab / Enter / Backspace have to decide
 * whether to move between cells, grow the table, or leave it — without
 * rewriting innerHTML (that kills the caret). These functions are that
 * decision, kept out of the React component so they can be tested.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const {
  isSingleTableMarkdown,
  isTypedTableMarkdown,
  looksLikeTableLine,
  markdownFromPaste,
  pastedMarkdownLooksRich,
  tableAddControlsHtml,
  tableChromeKind,
  tableChromeCommand,
  tableGrowAction,
  tableInsertBodyIndex,
  tableKeyAction,
  tableShrinkAction,
  tsvToTableMarkdown,
  typedTableFromLines,
} = await import('../src/client/markdown.ts')

test('a finished GFM table is a single table document', () => {
  assert.equal(isSingleTableMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |'), true)
  assert.equal(isSingleTableMarkdown('| A | B |\n| --- | --- |'), true)
  assert.equal(isSingleTableMarkdown('说明\n| A | B |\n| --- | --- |'), false, 'prose above a table is not only a table')
  assert.equal(isSingleTableMarkdown('| A | B |'), false, 'a lone pipe row is still a paragraph')
  assert.equal(isSingleTableMarkdown('只是提到 A | B'), false)
})

test('typing only promotes a table after the delimiter row is there', () => {
  assert.equal(isTypedTableMarkdown('| A | B |\n| 1 | 2 |'), false)
  assert.equal(isTypedTableMarkdown('| A | B |\n| --- | --- |'), true)
  assert.equal(isTypedTableMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |'), true)
})

test('a typed table can be assembled from adjacent paragraphs after Enter', () => {
  assert.equal(looksLikeTableLine('| A | B |'), true)
  assert.equal(looksLikeTableLine('| --- | --- |'), true)
  assert.equal(looksLikeTableLine(':--- | :---: | ---:'), true)
  assert.equal(looksLikeTableLine('只是提到 A | B'), false, 'a pipe in prose is not a table line')
  assert.equal(looksLikeTableLine('说明如下'), false)

  assert.equal(
    typedTableFromLines(['| A | B |', '| --- | --- |', '| 1 | 2 |']),
    '| A | B |\n| --- | --- |\n| 1 | 2 |',
  )
  assert.equal(typedTableFromLines(['| A | B |', '| 1 | 2 |']), null, 'no delimiter yet')
  assert.equal(
    typedTableFromLines(['说明如下', '| A | B |', '| --- | --- |']),
    null,
    'prose above the pipes is not part of the table',
  )
})

test('a paste is treated as rich when it carries a table or a phrasing tag', () => {
  assert.equal(pastedMarkdownLooksRich('| A | B |\n| --- | --- |\n| 1 | 2 |'), true)
  assert.equal(pastedMarkdownLooksRich('<small>脚注</small>'), true)
  assert.equal(pastedMarkdownLooksRich('E = mc<sup>2</sup>'), true)
  assert.equal(pastedMarkdownLooksRich('普通一行'), false)
  assert.equal(pastedMarkdownLooksRich('第一行\n第二行'), false, 'plain line breaks stay insertText')
})

test('a tab-separated paste becomes a GFM table', () => {
  assert.equal(
    tsvToTableMarkdown('维度\t当前最高\nSWE-bench\t96%'),
    '| 维度 | 当前最高 |\n| --- | --- |\n| SWE-bench | 96% |',
  )
  assert.equal(tsvToTableMarkdown('只有一行\t两列'), null)
  assert.equal(tsvToTableMarkdown('普通一行\n第二行'), null)
  assert.equal(pastedMarkdownLooksRich('维度\t当前最高\nSWE-bench\t96%'), true)
  assert.equal(
    markdownFromPaste('维度\t当前最高\nSWE-bench\t96%'),
    '| 维度 | 当前最高 |\n| --- | --- |\n| SWE-bench | 96% |',
  )
})

test('Tab walks cells and grows the table after the last cell', () => {
  const at = (rowIndex, colIndex, extras = {}) => tableKeyAction({
    key: 'Tab',
    shiftKey: false,
    rowIndex,
    colIndex,
    rowCount: 3,
    colCount: 2,
    cellEmpty: false,
    caretAtStart: false,
    ...extras,
  })

  assert.deepEqual(at(0, 0), { type: 'move', row: 0, col: 1 })
  assert.deepEqual(at(0, 1), { type: 'move', row: 1, col: 0 })
  assert.deepEqual(at(2, 1), { type: 'insert-row', afterRow: 2, focusCol: 0 })
})

test('Shift+Tab walks backward and leaves the table from the first cell', () => {
  const at = (rowIndex, colIndex) => tableKeyAction({
    key: 'Tab',
    shiftKey: true,
    rowIndex,
    colIndex,
    rowCount: 3,
    colCount: 2,
    cellEmpty: false,
    caretAtStart: false,
  })

  assert.deepEqual(at(0, 0), { type: 'leave', direction: -1 })
  assert.deepEqual(at(1, 0), { type: 'move', row: 0, col: 1 })
  assert.deepEqual(at(1, 1), { type: 'move', row: 1, col: 0 })
})

test('Enter moves down a column and adds a row at the bottom', () => {
  const at = (rowIndex, colIndex, extras = {}) => tableKeyAction({
    key: 'Enter',
    shiftKey: false,
    rowIndex,
    colIndex,
    rowCount: 3,
    colCount: 2,
    cellEmpty: false,
    caretAtStart: false,
    ...extras,
  })

  assert.deepEqual(at(0, 1), { type: 'move', row: 1, col: 1 })
  assert.deepEqual(at(2, 1), { type: 'insert-row', afterRow: 2, focusCol: 1 })
  assert.deepEqual(
    tableKeyAction({
      key: 'Enter',
      shiftKey: true,
      rowIndex: 1,
      colIndex: 0,
      rowCount: 3,
      colCount: 2,
      cellEmpty: false,
      caretAtStart: false,
    }),
    { type: 'break' },
  )
})

test('Backspace on an empty last body row removes that row', () => {
  assert.deepEqual(
    tableKeyAction({
      key: 'Backspace',
      shiftKey: false,
      rowIndex: 2,
      colIndex: 0,
      rowCount: 3,
      colCount: 2,
      cellEmpty: true,
      caretAtStart: true,
    }),
    { type: 'remove-row', row: 2, focusRow: 1, focusCol: 0 },
  )
  assert.equal(
    tableKeyAction({
      key: 'Backspace',
      shiftKey: false,
      rowIndex: 0,
      colIndex: 0,
      rowCount: 3,
      colCount: 2,
      cellEmpty: true,
      caretAtStart: true,
    }),
    null,
    'the header row is not deleted',
  )
  assert.equal(
    tableKeyAction({
      key: 'Backspace',
      shiftKey: false,
      rowIndex: 2,
      colIndex: 0,
      rowCount: 3,
      colCount: 2,
      cellEmpty: false,
      caretAtStart: true,
    }),
    null,
    'a cell with text still deletes characters',
  )
})

test('the + chrome grows a row or a column from a known cell', () => {
  assert.equal(tableChromeKind('row'), 'row')
  assert.equal(tableChromeKind('col'), 'col')
  assert.equal(tableChromeKind('table'), null)
  assert.deepEqual(
    tableGrowAction('row', { rowIndex: 2, colIndex: 1 }),
    { type: 'insert-row', afterRow: 2, focusCol: 1 },
  )
  assert.deepEqual(
    tableGrowAction('col', { rowIndex: 0, colIndex: 1 }),
    { type: 'insert-col', afterCol: 1, focusRow: 0 },
  )
})

test('the − chrome shrinks the current body row or a spare column', () => {
  assert.deepEqual(
    tableShrinkAction('row', { rowIndex: 2, colIndex: 1, rowCount: 3, colCount: 2 }),
    { type: 'remove-row', row: 2, focusRow: 1, focusCol: 1 },
  )
  assert.deepEqual(
    tableShrinkAction('row', { rowIndex: 1, colIndex: 0, rowCount: 3, colCount: 2 }),
    { type: 'remove-row', row: 1, focusRow: 1, focusCol: 0 },
  )
  assert.equal(
    tableShrinkAction('row', { rowIndex: 0, colIndex: 0, rowCount: 3, colCount: 2 }),
    null,
    'the header row is not deleted',
  )
  assert.deepEqual(
    tableShrinkAction('col', { rowIndex: 0, colIndex: 1, rowCount: 3, colCount: 2 }),
    { type: 'remove-col', col: 1, focusRow: 0, focusCol: 0 },
  )
  assert.equal(
    tableShrinkAction('col', { rowIndex: 0, colIndex: 0, rowCount: 3, colCount: 1 }),
    null,
    'the last remaining column is kept',
  )
})

test('Backspace on an empty last column removes that column', () => {
  assert.deepEqual(
    tableKeyAction({
      key: 'Backspace',
      shiftKey: false,
      rowIndex: 1,
      colIndex: 2,
      rowCount: 3,
      colCount: 3,
      cellEmpty: true,
      caretAtStart: true,
      columnEmpty: true,
    }),
    { type: 'remove-col', col: 2, focusRow: 1, focusCol: 1 },
  )
  assert.equal(
    tableKeyAction({
      key: 'Backspace',
      shiftKey: false,
      rowIndex: 1,
      colIndex: 2,
      rowCount: 3,
      colCount: 3,
      cellEmpty: true,
      caretAtStart: true,
      columnEmpty: false,
    }),
    null,
    'a column with text in another row still deletes characters',
  )
})

test('a new body row lands in tbody, not thead', () => {
  assert.equal(tableInsertBodyIndex(0, 1, 0), 0, 'after the header, first body row')
  assert.equal(tableInsertBodyIndex(1, 1, 1), 1, 'after the last body row, append')
  assert.equal(tableInsertBodyIndex(1, 1, 2), 1, 'after the first body row, insert there')
  assert.equal(tableInsertBodyIndex(3, 1, 2), 2, 'past the end still appends')
})

test('rendered tables ship add and remove controls', () => {
  const html = tableAddControlsHtml()
  assert.match(html, /data-md-table-add="row"/)
  assert.match(html, /data-md-table-add="col"/)
  assert.match(html, /data-md-table-remove="row"/)
  assert.match(html, /data-md-table-remove="col"/)
  assert.match(html, /contenteditable="false"/)
  assert.deepEqual(tableChromeCommand({ getAttribute: name => (name === 'data-md-table-add' ? 'row' : null) }), { op: 'add', kind: 'row' })
  assert.deepEqual(tableChromeCommand({ getAttribute: name => (name === 'data-md-table-remove' ? 'col' : null) }), { op: 'remove', kind: 'col' })
  assert.equal(tableChromeCommand({ getAttribute: () => null }), null)
})

test('the editor surface styles a real table instead of wrapping every character', async () => {
  const css = await readFile(new URL('../src/client/StickyEditor.module.css', import.meta.url), 'utf8')
  assert.match(css, /\[data-md-table='1'\]/)
  assert.match(css, /data-md-table-scroll/)
  assert.match(css, /overflow-x:\s*auto/)
  assert.match(css, /data-md-table-add/)
  assert.match(css, /data-md-table-remove/)
  assert.match(css, /\.surface table/)
  assert.match(css, /\.surface small/)
  assert.doesNotMatch(css, /\.surface td \{[^}]*overflow-wrap:\s*anywhere/)
})
