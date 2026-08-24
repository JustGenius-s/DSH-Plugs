import { readFile, readdir } from 'node:fs/promises'

const FOUNDATION = '0.1.0-rc.7'
const SHELL = '0.1.0-rc.6'

// DSH publishes nominally branded types across packages. Mixing releases in
// one contract family can make identical-looking values incompatible, so the
// monorepo pins the tested compatibility matrix instead of accepting ranges.
const expected = new Map([
  ...[
    'dsh-agent',
    'dsh-agent-default-model',
    'dsh-api-remotes',
    'dsh-client-connection',
    'dsh-client-locale',
    'dsh-client-runtime',
    'dsh-client-schema-form',
    'dsh-client-ui-primitives',
    'dsh-client-ui-settings',
    'dsh-client-ui-settings-plugins',
    'dsh-client-ui-slots',
    'dsh-commands',
    'dsh-host-webserver',
    'dsh-jobs',
    'dsh-llm',
    'dsh-session',
    'dsh-session-title',
    'dsh-settings',
    'dsh-storage-domain',
    'dsh-system-prompt',
    'dsh-tools',
  ].map((name) => [`@deepseek-ai/${name}`, FOUNDATION]),
  ...[
    'dsh-client-ui-conversation',
    'dsh-client-ui-input-trigger',
    'dsh-client-ui-layout',
    'dsh-client-ui-model-selection',
    'dsh-subprocess',
  ].map((name) => [`@deepseek-ai/${name}`, SHELL]),
])

const manifests = await discoverManifests()
const errors = []
for (const path of manifests) {
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (!name.startsWith('@deepseek-ai/dsh-')) continue
      const wanted = expected.get(name)
      if (wanted === undefined) {
        errors.push(`${path}: ${name} is not assigned to a tested contract family`)
      } else if (version !== wanted) {
        errors.push(`${path}: ${name} must be exactly ${wanted}, found ${version}`)
      }
    }
  }
}

if (errors.length > 0) {
  console.error('DSH dependency contract check failed:\n' + errors.map((line) => `- ${line}`).join('\n'))
  process.exitCode = 1
} else {
  console.log(`DSH dependency contracts OK (${manifests.length} manifests)`)
}

async function discoverManifests() {
  const paths = []
  for (const root of ['plugins', 'packages']) {
    const entries = await readdir(new URL(`../${root}/`, import.meta.url), { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) paths.push(`${root}/${entry.name}/package.json`)
    }
  }
  return paths
}
