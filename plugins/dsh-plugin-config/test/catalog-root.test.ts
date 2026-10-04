import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { listCatalogIds, loadCatalogPack } from '@just-genius/dsh-agent-plugin'
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

describe('builtin catalog packs', () => {
  it('parses every catalog pack', async () => {
    const ids = await listCatalogIds(catalog)
    expect(ids).toEqual(expect.arrayContaining(['cloudbase', 'cos', 'supabase']))
    expect(ids).not.toContain('tapd')
    for (const id of ids) {
      const pack = await loadCatalogPack(join(catalog, id))
      expect(pack.manifest.name).toBe(id)
      expect(Object.keys(pack.mcp).length).toBeGreaterThan(0)
    }
  })

})
