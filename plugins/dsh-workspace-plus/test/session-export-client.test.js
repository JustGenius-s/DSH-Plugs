import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createSessionExporter,
  downloadSessionMarkdown,
  requestSessionExport,
} from '../src/client/session-export.ts'

const payload = { filename: '会话.md', markdown: '# 会话\n\n你好 🌱\n' }

test('session export posts the requested id and unwraps the HTTP result', async (t) => {
  const previousFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = previousFetch })
  globalThis.fetch = async (path, init) => {
    assert.equal(path, '/dsh-workspace-plus/session-export')
    assert.equal(init.method, 'POST')
    assert.equal(init.headers['content-type'], 'application/json')
    assert.deepEqual(JSON.parse(init.body), { sessionId: 's-1' })
    return { json: async () => ({ ok: true, value: payload }) }
  }
  assert.deepEqual(await requestSessionExport('s-1'), payload)
})

test('session export rejects failed or malformed responses before downloading', async (t) => {
  const previousFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = previousFetch })
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, message: 'Session not found' }) })
  await assert.rejects(requestSessionExport('missing'), /Session not found/)
  for (const value of [undefined, null, {}, { filename: 'x.md' }, { filename: '', markdown: '' }]) {
    globalThis.fetch = async () => ({ json: async () => ({ ok: true, value }) })
    await assert.rejects(requestSessionExport('s-1'), /Invalid session export response/)
  }
})

test('Markdown download preserves UTF-8 content and releases its URL after starting', async () => {
  let blob
  let release
  const calls = []
  downloadSessionMarkdown(payload, {
    createObjectURL: (value) => {
      blob = value
      return 'blob:session'
    },
    startDownload: (filename, url) => { calls.push(['download', filename, url]) },
    revokeObjectURL: (url) => { calls.push(['revoke', url]) },
    scheduleRelease: (callback) => { release = callback },
  })
  assert.equal(blob.type, 'text/markdown;charset=utf-8')
  assert.equal(await blob.text(), payload.markdown)
  assert.deepEqual(calls, [['download', '会话.md', 'blob:session']])
  release()
  assert.deepEqual(calls.at(-1), ['revoke', 'blob:session'])
})

test('a download failure immediately releases its URL and propagates the error', () => {
  const revoked = []
  assert.throws(() => downloadSessionMarkdown(payload, {
    createObjectURL: () => 'blob:failed',
    startDownload: () => { throw new Error('download unavailable') },
    revokeObjectURL: (url) => { revoked.push(url) },
    scheduleRelease: () => assert.fail('no delayed release after failure'),
  }), /download unavailable/)
  assert.deepEqual(revoked, ['blob:failed'])
})

test('overlapping clicks for one session request and download only once', async () => {
  let resolve
  const requests = []
  const downloads = []
  const exporter = createSessionExporter({
    request: (id) => {
      requests.push(id)
      return new Promise((done) => { resolve = done })
    },
    download: (value) => { downloads.push(value) },
  })
  const states = []
  const stop = exporter.subscribe(() => { states.push([...exporter.getPending()]) })
  const initial = exporter.getPending()
  const first = exporter.run('s-1')
  assert.notEqual(exporter.getPending(), initial)
  assert.equal(exporter.getPending(), exporter.getPending(), 'snapshot stays stable without a change')
  assert.equal(await exporter.run('s-1'), false)
  resolve(payload)
  assert.equal(await first, true)
  assert.deepEqual(requests, ['s-1'])
  assert.deepEqual(downloads, [payload])
  assert.deepEqual(states, [['s-1'], []])
  stop()
  const again = exporter.run('s-1')
  resolve(payload)
  assert.equal(await again, true)
  assert.deepEqual(states, [['s-1'], []], 'unsubscribed listeners are not called')
})

test('different sessions export independently and remain pending through download', async () => {
  const finish = new Map()
  const exporter = createSessionExporter({
    request: async (id) => ({ ...payload, filename: `${id}.md` }),
    download: (value) => new Promise((done) => { finish.set(value.filename, done) }),
  })
  const first = exporter.run('s-1')
  const second = exporter.run('s-2')
  await Promise.resolve()
  assert.deepEqual([...exporter.getPending()], ['s-1', 's-2'])
  assert.equal(await exporter.run('s-1'), false)
  finish.get('s-2.md')()
  assert.equal(await second, true)
  assert.deepEqual([...exporter.getPending()], ['s-1'])
  finish.get('s-1.md')()
  assert.equal(await first, true)
  assert.equal(exporter.getPending().size, 0)
})

test('request and download failures clear the pending session and permit retry', async () => {
  for (const failingStage of ['request', 'download']) {
    let shouldFail = true
    let downloads = 0
    const exporter = createSessionExporter({
      request: async () => {
        if (shouldFail && failingStage === 'request') throw new Error('request failed')
        return payload
      },
      download: () => {
        if (shouldFail && failingStage === 'download') throw new Error('download failed')
        downloads += 1
      },
    })
    await assert.rejects(exporter.run('s-1'), /failed/)
    assert.equal(exporter.getPending().size, 0)
    shouldFail = false
    assert.equal(await exporter.run('s-1'), true)
    assert.equal(downloads, 1)
  }
})
