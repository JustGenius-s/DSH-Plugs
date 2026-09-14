import { test } from 'node:test'
import assert from 'node:assert/strict'

import { requestRejection } from '../src/request-auth.ts'

const request = { headers: {} }

test('routes fail closed when browser authentication is unavailable', () => {
  assert.equal(requestRejection(undefined, request), 401)
  assert.equal(requestRejection({}, request), 401)
})

test('routes preserve the current Connection authentication decision', () => {
  assert.equal(requestRejection({ requestRejection: () => undefined }, request), undefined)
  assert.equal(requestRejection({ requestRejection: () => 403 }, request), 403)
})

test('a broken authentication adapter also fails closed', () => {
  assert.equal(requestRejection({ requestRejection: () => { throw new Error('broken') } }, request), 401)
})
