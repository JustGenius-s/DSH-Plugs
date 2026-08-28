import { readFile, readdir } from 'node:fs/promises'

const DSH_LATEST = '0.1.1-rc.2'
const VERSION_EXCEPTIONS = new Map([
  // This legacy package has not published in the 0.1.1 line. New code should
  // use SettingsSchemaService from dsh-client-ui-settings instead.
  ['@deepseek-ai/dsh-client-schema-form', '0.1.0-rc.7'],
])
const errors = []

for (const path of await discoverManifests('plugins')) {
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  if (manifest.dependencies?.['@just-genius/dsh-plugin-runtime'] !== 'workspace:*') {
    errors.push(`${path}: plugins must depend on @just-genius/dsh-plugin-runtime as workspace:*`)
  }
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      if (name.startsWith('@deepseek-ai/')) {
        errors.push(`${path}: ${section}.${name} must be owned by packages/runtime, not a plugin`)
      }
    }
  }
}

for (const path of await discoverManifests('packages')) {
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (!name.startsWith('@deepseek-ai/dsh-')) continue
      const wanted = VERSION_EXCEPTIONS.get(name) ?? DSH_LATEST
      if (version !== wanted) {
        errors.push(`${path}: ${section}.${name} must be exactly ${wanted}, found ${version}`)
      }
    }
  }
}

for (const path of await discoverSourceFiles('plugins')) {
  const source = await readFile(path, 'utf8')
  const directOfficialImport = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*|\bdeclare\s+module\s*)['"]@deepseek-ai\//
  if (directOfficialImport.test(source)) {
    errors.push(`${path}: plugin source must import or augment the shared runtime/UI boundary`)
  }
}

if (errors.length > 0) {
  console.error('DSH dependency contract check failed:\n' + errors.map(line => `- ${line}`).join('\n'))
  process.exitCode = 1
} else {
  console.log('DSH dependency contracts OK (plugins isolated; shared packages pinned to latest APIs)')
}

async function discoverManifests(root) {
  const paths = []
  const entries = await readdir(new URL(`../${root}/`, import.meta.url), { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) paths.push(`${root}/${entry.name}/package.json`)
  }
  return paths
}

async function discoverSourceFiles(root) {
  const base = new URL(`../${root}/`, import.meta.url)
  const entries = await readdir(base, { recursive: true, withFileTypes: true })
  return entries
    .filter(entry => entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name))
    .map(entry => `${entry.parentPath}/${entry.name}`)
    .filter(path => !path.includes('/lib/') && !path.includes('/node_modules/'))
}
