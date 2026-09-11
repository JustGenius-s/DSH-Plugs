import { test } from 'node:test'
import assert from 'node:assert/strict'

import { selectSessionHeader } from '../src/session-reference.ts'

function header(id, cwd) {
  return {
    version: 1,
    id,
    createdAt: 1,
    cwd,
    isSeeded: false,
  }
}

test('a unique session id selects its persistence header', () => {
  const selected = selectSessionHeader([header('s-1', '/workspace/a')], 's-1')
  assert.equal(selected?.cwd, '/workspace/a')
})

test('cwd disambiguates a migrated duplicate session id', () => {
  const selected = selectSessionHeader([
    header('s-1', '/workspace/old'),
    header('s-1', '/workspace/current'),
  ], 's-1', '/workspace/current')
  assert.equal(selected?.cwd, '/workspace/current')
})

test('an ambiguous id without a cwd is rejected', () => {
  const selected = selectSessionHeader([
    header('s-1', '/workspace/a'),
    header('s-1', '/workspace/b'),
  ], 's-1')
  assert.equal(selected, undefined)
})

test('an unknown session id has no persistence header', () => {
  assert.equal(selectSessionHeader([header('s-1', '/workspace/a')], 'missing'), undefined)
})
