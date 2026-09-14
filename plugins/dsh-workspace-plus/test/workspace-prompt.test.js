import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderWorkspaceContext } from '../src/workspace-prompt.ts'

test('workspace context reports the real cwd without inventing permission facts', () => {
  const text = renderWorkspaceContext({
    cwd: '/repo/secondary',
    binding: {
      root: '/repo/primary',
      primaryPath: '/repo/primary',
      title: 'workspace',
      updatedAt: 1,
      repos: [
        { name: 'primary', path: '/repo/primary' },
        { name: 'secondary', path: '/repo/secondary' },
      ],
    },
  })
  assert.match(text, /Current session working directory: `\/repo\/secondary`/)
  assert.match(text, /Actual read, write, and approval rules come from the active DSH permission policy/)
  assert.doesNotMatch(text, /workspace-write follow the primary/)
})

test('folder text containing prompt braces stays data in the variable value', () => {
  const text = renderWorkspaceContext({
    cwd: '/repo/{{cwd}}',
    binding: {
      root: '/repo/{{cwd}}',
      primaryPath: '/repo/{{cwd}}',
      title: 'workspace',
      updatedAt: 1,
      repos: [
        { name: '{{name}}', path: '/repo/{{cwd}}' },
        { name: 'side', path: '/side' },
      ],
    },
  })
  assert.match(text, /\{\{name\}\}/)
  assert.match(text, /\{\{cwd\}\}/)
})
