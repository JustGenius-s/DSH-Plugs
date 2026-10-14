import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { Script } from 'node:vm'
import { patchOfficialEditor } from './patch-official-editor.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const executable = process.env.DSH_DESKTOP_EXECUTABLE
if (!executable) throw new Error('Set DSH_DESKTOP_EXECUTABLE to the installed DeepSeek Harness executable.')
const output = join(root, 'lib/desktop')
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Desktop build command failed: ' + result.status)
}
run(executable, [join(root, 'scripts/extract-desktop-runtime.cjs'), join(root, 'lib/desktop-runtime')], { ...process.env, ELECTRON_RUN_AS_NODE: '1' })
const pkgPath = fileURLToPath(import.meta.resolve('tsdown/package.json'))
const tool = JSON.parse(await readFile(pkgPath, 'utf8'))
run(process.execPath, [join(dirname(pkgPath), typeof tool.bin === 'string' ? tool.bin : tool.bin.tsdown), '-c', 'tsdown.desktop.config.ts'])
const source = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const upstreamRoot = join(root, 'lib/desktop-runtime/dsh-client-ui-settings-models')
const upstream = JSON.parse(await readFile(join(upstreamRoot, 'package.json'), 'utf8'))
const officialClient = await readFile(join(upstreamRoot, 'lib/client.js'), 'utf8')
const extraClient = await readFile(join(root, 'lib/desktop-build/editor.js'), 'utf8')
const client = patchOfficialEditor(officialClient, extraClient, source.name)
new Script(client, { filename: 'model-custom-ex-client.js' })
await writeFile(join(output, 'client.js'), client)
await writeFile(join(output, 'UPSTREAM.json'), JSON.stringify({ package: upstream.name, version: upstream.version, sha256: createHash('sha256').update(officialClient).digest('hex') }, null, 2) + '\n')
const manifest = { name: source.name, version: source.version, description: 'Official Models editor with inline reasoning controls and capacity presets.', type: 'module', main: 'index.js',
  exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' },
  files: ['index.js', 'client.js', 'cordis.patch.yml', 'README.md', 'UPSTREAM.json', 'THIRD_PARTY_NOTICES.txt'], engines: { node: '>=22.19.0' },
  dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: [...new Set([...upstream.dsh.client.inject, '@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-client-ui-primitives'])] } } }
await writeFile(join(output, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
await copyFile(join(root, 'cordis.desktop.patch.yml'), join(output, 'cordis.patch.yml'))
await copyFile(join(root, 'README.desktop.md'), join(output, 'README.md'))
const notices = []
for (const name of ['schemastery', 'cosmokit', 'dsh-client-ui-settings-models']) {
  const directory = join(root, 'lib/desktop-runtime', name)
  const dependency = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  notices.push(dependency.name + ' ' + dependency.version + '\n' + await readFile(join(directory, 'LICENSE'), 'utf8'))
}
await writeFile(join(output, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n\n'))
const host = await readFile(join(output, 'index.js'), 'utf8')
if (host.includes('from "@deepseek-ai/') || host.includes('from "@just-genius/')) throw new Error('Desktop host still has unresolved runtime imports')
console.log('Standalone desktop package: ' + output)
