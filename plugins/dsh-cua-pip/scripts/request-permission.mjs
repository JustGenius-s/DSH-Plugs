import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') throw new Error('Native window capture requires macOS')
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const app = join(root, 'lib', 'DSH Window Capture.app')
// Launch through the same responsible-process boundary as production. A
// direct binary probe would misleadingly test the terminal/Codex permission.
execFileSync('/usr/bin/open', ['-n', '-g', '-a', app, '--args', '--request-permission'], { stdio: 'inherit' })
console.log('macOS permission request opened for DSH Window Capture. Grant permission in System Settings, then reopen the PiP.')
