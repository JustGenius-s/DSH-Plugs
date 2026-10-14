import { once } from 'node:events'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNativeCapture } from '../src/native-launch.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const helper = join(root, 'lib', 'DSH Window Capture.app', 'Contents', 'MacOS', 'dsh-window-capture')
const child = launchNativeCapture(helper, ['--probe'])
const exit = once(child, 'exit')
let data = ''
child.stdout.on('data', (chunk) => { data += chunk })
child.stderr.pipe(process.stderr)
const deadline = setTimeout(() => child.kill('SIGKILL'), 5000)
try {
  const [code, signal] = await exit
  if (signal || code !== 0) throw new Error(`Native probe stopped (${signal ?? code})`)
  console.log(JSON.stringify({ ...JSON.parse(data), launch: 'launchservices' }, null, 2))
} finally {
  clearTimeout(deadline)
}
