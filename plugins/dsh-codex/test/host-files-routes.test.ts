import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { test } from 'vitest'
import { createDshCodexFilesServer } from '../src/host/files/server'
import { hostPlatform, revealSupported } from '../src/host/files/reveal'

/**
 * Boots the real files-server routes against a fake webServer/subprocess seam
 * and drives them over HTTP, so the wiring (method, path, status, payload) is
 * checked the way the browser will hit it.
 */

const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>()
let lastSpawn: { argv: readonly string[]; cwd: string } | undefined

const ctx = {
  webServer: {
    register: (spec: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) => {
      registered.set(spec.path, spec.handler)
      return () => { registered.delete(spec.path) }
    },
  },
  subprocess: {
    spawn: (spec: { argv: readonly string[]; cwd: string }) => {
      lastSpawn = { argv: spec.argv, cwd: spec.cwd }
      return { done: Promise.resolve({ exitCode: 0, signal: null, timedOut: false }) }
    },
    resolveExecutable: async (command: string) => `/usr/bin/${command}`,
  },
} as never

test('files host routes respond the way the browser expects', async () => {
  createDshCodexFilesServer(ctx)

  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/'
    const handler = registered.get(path)
    if (handler === undefined) {
      res.writeHead(404).end('{"ok":false}')
      return
    }
    handler(req, res)
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const base = `http://127.0.0.1:${port}`
  const results: string[] = []
  const check = (name: string, ok: boolean, detail = ''): void => {
    results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail}`)
  }

  // --- GET info -----------------------------------------------------------
  const infoRes = await fetch(`${base}/dsh-codex/files/info`)
  const infoBody = await infoRes.json() as Record<string, unknown>
  check('GET info -> 200', infoRes.status === 200, `got ${infoRes.status}`)
  check('GET info -> ok payload', infoBody.ok === true)
  check('GET info -> names a platform', typeof infoBody.platform === 'string')
  check('GET info -> reports reveal support', typeof infoBody.revealSupported === 'boolean')
  results.push(`     info body: ${JSON.stringify(infoBody)}`)

  // --- info method guard --------------------------------------------------
  const infoPost = await fetch(`${base}/dsh-codex/files/info`, { method: 'POST' })
  check('POST info -> 405', infoPost.status === 405, `got ${infoPost.status}`)

  // --- POST reveal --------------------------------------------------------
  const cwd = process.cwd()
  const revealRes = await fetch(`${base}/dsh-codex/files/reveal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cwd, path: 'package.json', kind: 'file' }),
  })
  const revealBody = await revealRes.json() as Record<string, unknown>
  check('POST reveal -> 200', revealRes.status === 200, `got ${revealRes.status}`)
  check('POST reveal -> ok payload', revealBody.ok === true, JSON.stringify(revealBody))
  check('POST reveal -> spawned a file manager', lastSpawn !== undefined)
  results.push(`     argv: ${JSON.stringify(lastSpawn?.argv)}`)

  // --- reveal: escape refused --------------------------------------------
  const escapeRes = await fetch(`${base}/dsh-codex/files/reveal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cwd, path: '../../etc/passwd', kind: 'file' }),
  })
  const escapeBody = await escapeRes.json() as Record<string, unknown>
  check('POST reveal (escape) -> 400', escapeRes.status === 400, `got ${escapeRes.status}`)
  check('POST reveal (escape) -> not ok', escapeBody.ok === false)
  results.push(`     escape body: ${JSON.stringify(escapeBody)}`)

  // --- reveal: malformed body --------------------------------------------
  const badRes = await fetch(`${base}/dsh-codex/files/reveal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'package.json' }),
  })
  check('POST reveal (no cwd) -> 400', badRes.status === 400, `got ${badRes.status}`)

  // --- reveal: method guard ----------------------------------------------
  const revealGet = await fetch(`${base}/dsh-codex/files/reveal`)
  check('GET reveal -> 405', revealGet.status === 405, `got ${revealGet.status}`)

  server.close()

  const failures = results.filter(line => line.startsWith('FAIL'))
  console.log(`\nplatform=${hostPlatform()} revealSupported=${revealSupported(hostPlatform())}`)
  console.log(results.join('\n'))
  if (failures.length > 0) throw new Error(`route checks failed:\n${failures.join('\n')}`)
})
