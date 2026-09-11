import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { spawnOpener } from '../src/open-path.ts'

function childWithExit(code) {
  const child = new EventEmitter()
  child.unref = () => {}
  queueMicrotask(() => { child.emit('exit', code) })
  return child
}

test('an opener resolves only on exit code zero', async () => {
  await spawnOpener('fake', [], () => childWithExit(0))
  await assert.rejects(
    spawnOpener('fake', [], () => childWithExit(7)),
    /opener exited with code 7/,
  )
})

test('a terminated opener is not reported as success', async () => {
  await assert.rejects(
    spawnOpener('fake', [], () => childWithExit(null)),
    /terminated before completion/,
  )
})
