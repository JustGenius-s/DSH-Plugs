// Standalone smoke test for the git-graph SSE watcher (not shipped).
// Creates a temp repo, runs handleWatch against mock req/res, then edits,
// stages, and commits a file, expecting a `change` event for each step.
import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleWatch } from '../src/host/git-graph/watch.ts'

const repo = mkdtempSync(join(tmpdir(), 'dsh-watch-'))
const git = (args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' })
git(['init'])
git(['config', 'user.email', 'test@test'])
git(['config', 'user.name', 'test'])
writeFileSync(join(repo, 'a.txt'), 'one\n')
git(['add', '.'])
git(['commit', '-m', 'init'])

const req = new EventEmitter()
let body = ''
const res = {
  writeHead(status, headers) {
    console.log('status:', status, '| content-type:', headers['content-type'])
  },
  write(chunk) {
    body += chunk
    if (body.includes('event: change')) {
      body = ''
      events += 1
      console.log(`>> change event #${events}`)
    }
  },
}
let events = 0

await handleWatch(req, res, repo)
console.log('stream opened, baseline fingerprint taken')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
await sleep(800)

console.log('step 1: edit worktree file')
writeFileSync(join(repo, 'a.txt'), 'two\n')
await sleep(1500)

console.log('step 2: stage it')
git(['add', 'a.txt'])
await sleep(1500)

console.log('step 3: commit')
git(['commit', '-m', 'second'])
await sleep(1500)

console.log('step 4: new untracked file')
writeFileSync(join(repo, 'b.txt'), 'new\n')
await sleep(1500)

req.emit('close')
console.log(events >= 3 ? `PASS (${events} events)` : `FAIL (only ${events} events)`)
process.exit(events >= 3 ? 0 : 1)
