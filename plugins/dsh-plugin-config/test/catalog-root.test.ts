import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { builtinCatalogRoot, resolveCatalogRoot } from '../src/agent/catalog-root.ts'

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalog = join(pluginRoot, 'catalog')

describe('builtin catalog root', () => {
  it('finds catalog from the bundled lib/ location', () => {
    expect(resolveCatalogRoot(join(pluginRoot, 'lib'))).toBe(catalog)
  })

  it('finds catalog from the source agent/ location', () => {
    expect(resolveCatalogRoot(join(pluginRoot, 'src', 'agent'))).toBe(catalog)
  })

  it('resolves from this module URL', () => {
    expect(builtinCatalogRoot()).toBe(catalog)
  })
})
