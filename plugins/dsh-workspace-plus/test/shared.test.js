import { test } from 'node:test'
import assert from 'node:assert/strict'

import { samePath, SETTINGS_NS } from '../src/shared.ts'

test('plugin settings namespace matches the plugins tab dispatch key', () => {
  assert.equal(SETTINGS_NS, 'workspace-plus')
})

test('path identity does not merge distinct case-sensitive paths', () => {
  assert.equal(samePath('/Workspace/Repo', '/workspace/repo'), false)
  assert.equal(samePath('/Workspace/Repo/', '/Workspace/Repo'), true)
})
