import { readFile, readdir } from 'node:fs/promises'

const errors = []
const platformSeeds = new Set(['react', 'react-dom'])
const plugins = await readdir(new URL('../plugins/', import.meta.url), { withFileTypes: true })

for (const entry of plugins) {
  if (!entry.isDirectory()) continue
  const root = new URL(`../plugins/${entry.name}/`, import.meta.url)
  let manifest
  let bundle
  try {
    manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
    bundle = await readFile(new URL('lib/client.js', root), 'utf8')
  } catch {
    continue
  }

  const injected = new Set((manifest.dsh?.client?.inject ?? []).map(packageNameOf))
  const required = new Set([...bundle.matchAll(/\brequire\("([^"]+)"\)/g)].map(match => match[1]))
  for (const specifier of required) {
    const packageName = packageNameOf(specifier)
    if (packageName.startsWith('@just-genius/dsh-plugin-')) {
      errors.push(`${manifest.name}: shared package leaked into client require("${specifier}")`)
    } else if (!platformSeeds.has(packageName) && !injected.has(packageName)) {
      errors.push(`${manifest.name}: require("${specifier}") is not a declared DSH client injection`)
    }
  }

  if (required.has('@deepseek-ai/dsh-client-ui-primitives')
    || required.has('@deepseek-ai/dsh-client-ui-primitives/client')) {
    errors.push(`${manifest.name}: official primitives must be replaced by @just-genius/dsh-plugin-ui`)
  }
}

if (errors.length > 0) {
  console.error('Client module-table check failed:\n' + errors.map(line => `- ${line}`).join('\n'))
  process.exitCode = 1
} else {
  console.log('Client module-table contracts OK')
}

function packageNameOf(specifier) {
  if (!specifier.startsWith('@')) return specifier.split('/')[0]
  return specifier.split('/').slice(0, 2).join('/')
}
