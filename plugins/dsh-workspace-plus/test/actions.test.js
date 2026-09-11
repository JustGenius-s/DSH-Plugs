import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  archiveSession,
  forkSession,
  newSession,
  openSession,
  openWorkspace,
  sessionTitleOf,
} = await import('../src/client/session-commands.ts')

function context(uiWorkspace) {
  return {
    get: (name) => name === 'uiWorkspace' ? uiWorkspace : undefined,
    sessions: {
      list: { getSnapshot: () => ({ byId: {} }) },
      fork: async () => 'fallback-child',
      open: () => { throw new Error('fallback open should not run') },
    },
    workspaces: {
      archiveSession: async () => { throw new Error('fallback archive should not run') },
    },
  }
}

test('session navigation uses the current uiWorkspace capability', async () => {
  const calls = []
  const ctx = context({
    pickDirectory: async () => null,
    startSession: (id) => { calls.push(['start', id]) },
    openWorkspace: async (id) => { calls.push(['workspace', id]) },
    openSession: (id) => { calls.push(['open', id]) },
    forkSession: async (id) => { calls.push(['fork', id]) },
    archiveSession: async (id) => { calls.push(['archive', id]) },
  })
  newSession(ctx, 'ws-1')
  await openWorkspace(ctx, 'ws-1')
  openSession(ctx, 's-1')
  await forkSession(ctx, 's-1')
  await archiveSession(ctx, 's-1')
  assert.deepEqual(calls, [
    ['start', 'ws-1'],
    ['workspace', 'ws-1'],
    ['open', 's-1'],
    ['fork', 's-1'],
    ['archive', 's-1'],
  ])
})

test('session menu titles prefer durable and repaired display values', () => {
  assert.equal(sessionTitleOf({ title: 'Durable', displayTitle: 'Project' }, 'row'), 'Durable')
  assert.equal(sessionTitleOf({ displayTitle: 'Recovered' }, 'row'), 'Recovered')
  assert.equal(sessionTitleOf(undefined, 'row'), 'row')
})
