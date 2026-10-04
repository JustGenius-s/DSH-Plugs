import { readFileSync, writeFileSync, renameSync, realpathSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const marker = '// DSH-Desktop legacy shell: use the web keyboard adapter when both native bridges are absent.'
const anchor = 'const environment = detectEnvironment(document, navigator);'

/** Patch only the known 0.2.0 startup contract; retain desktop chrome and native hosts. */
export function patchShortcuts(source) {
  if (source.includes(marker)) return source
  if (source.split(anchor).length !== 2 || !source.includes('Desktop keyboard bridge unavailable')) {
    throw new Error('Unrecognized shortcuts bundle; refusing to modify it')
  }
  return source.replace(anchor, `${anchor}\n\t\t\t\t${marker}
\t\t\t\tif (environment.runtime === "desktop" && window.dshDesktop?.keyboard === void 0 && window.dshDesktop?.shortcuts === void 0) environment.runtime = "web";`)
}

export function repairShortcuts(runtimeRoot = join(homedir(), '.dsh/runtime')) {
  const host = createRequire(realpathSync(join(runtimeRoot, 'node_modules/@deepseek-ai/dsh/package.json')))
  const manifest = host.resolve('@deepseek-ai/dsh-client-shortcuts/package.json')
  const { version } = JSON.parse(readFileSync(manifest, 'utf8'))
  if (version !== '0.2.0-rc.1') throw new Error(`Unsupported shortcuts version: ${version}`)
  const path = join(dirname(manifest), 'lib/client.js')
  const original = readFileSync(path, 'utf8')
  const patched = patchShortcuts(original)
  if (patched === original) return { path, changed: false }
  const backup = `${path}.before-desktop-compat`
  if (!existsSync(backup)) writeFileSync(backup, original, { flag: 'wx' })
  // Atomic replacement also avoids modifying a pnpm hardlink in its shared store.
  const temp = `${path}.desktop-compat-${process.pid}`
  writeFileSync(temp, patched, { flag: 'wx' })
  renameSync(temp, path)
  return { path, backup, changed: true }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(repairShortcuts(process.argv[2]), null, 2))
}
