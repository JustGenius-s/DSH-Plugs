import { describe, expect, it } from 'vitest'
import { FILE_ICON_SVG } from '../src/client/features/files/file-icons-data'
import { fileIconSvg } from '../src/client/features/files/file-icons'

/**
 * SVG `id` and `url(#id)` are DOCUMENT-global, and these icons are injected
 * with `dangerouslySetInnerHTML` into one live tree. The vscode-icons set
 * reuses bare ids (`a`, `b`, `c`, …), so an unscoped set lets the first icon to
 * paint own `id="a"` for the whole page.
 *
 * That shipped: `file_type_license` defines `a`…`bh`, and `file_type_vite`
 * references `a` (a mask) plus `b`/`c` (blur filters). A LICENSE row anywhere
 * above the vite rows turned every Vite glyph into a purple blob — reproduced
 * in headless Chrome, and the reason `scripts/gen-file-icons.mjs` rescopes ids.
 *
 * These tests pin the invariant, not the pixels.
 */

/** Distinct `id="…"` values one icon defines. */
function definedIds(svg: string): string[] {
  return [...new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]
}

/** Every id one icon references, across all three reference forms. */
function referencedIds(svg: string): string[] {
  return [
    ...new Set([
      ...[...svg.matchAll(/url\(#([^)"']+)\)/g)].map((m) => m[1]),
      ...[...svg.matchAll(/xlink:href="#([^"]+)"/g)].map((m) => m[1]),
      ...[...svg.matchAll(/(?<!xlink:)href="#([^"]+)"/g)].map((m) => m[1]),
    ]),
  ]
}

const icons = Object.entries(FILE_ICON_SVG)

describe('file icon id scoping', () => {
  it('ships a non-trivial icon set', () => {
    expect(icons.length).toBeGreaterThan(100)
  })

  it('never defines the same id in two icons', () => {
    const owners = new Map<string, string[]>()
    for (const [key, svg] of icons) {
      for (const id of definedIds(svg)) {
        const list = owners.get(id) ?? []
        list.push(key)
        owners.set(id, list)
      }
    }
    const shared = [...owners.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([id, list]) => `${id} (${list.length}): ${list.slice(0, 4).join(', ')}`)
    expect(shared).toEqual([])
  })

  it('keeps every icon self-contained, so scoping cannot orphan a reference', () => {
    const dangling: string[] = []
    for (const [key, svg] of icons) {
      const own = new Set(definedIds(svg))
      for (const ref of referencedIds(svg)) {
        if (!own.has(ref)) dangling.push(`${key} -> ${ref}`)
      }
    }
    expect(dangling).toEqual([])
  })

  it('scopes the ids of an icon that defines any, to its own key', () => {
    const unscoped: string[] = []
    for (const [key, svg] of icons) {
      const ids = definedIds(svg)
      if (ids.length === 0) continue
      for (const id of ids) if (!id.endsWith(`-${key}`)) unscoped.push(`${key}: ${id}`)
    }
    expect(unscoped).toEqual([])
  })

  it('gives every icon a viewBox, so it scales into the fixed 16px glyph slot', () => {
    // `.dsh-files-file-glyph svg{width:16px;height:16px}` overrides the svg's own
    // sizing. Without a viewBox the browser shows user space at 1:1 and clips
    // anything past 16 units — `file_type_dotenv`'s 32x32 art rendered as a solid
    // gold square instead of the ".env" glyph.
    const missing = icons.filter(([, svg]) => !/\sviewBox="/.test(svg)).map(([key]) => key)
    expect(missing).toEqual([])
  })
})

describe('the .env glyph specifically', () => {
  // `.env`, `.env.example` and friends all resolve to file_type_dotenv.
  it('resolves every dotenv variant to one icon', () => {
    const dotenv = fileIconSvg('.env')
    for (const name of ['.env', '.env.example', '.env.local', '.env.production', '.envrc']) {
      expect(fileIconSvg(name)).toBe(dotenv)
    }
  })

  it('keeps a viewBox rather than bare width/height', () => {
    const svg = fileIconSvg('.env')
    expect(svg).toMatch(/\sviewBox="0 0 32 32"/)
  })
})

describe('the vite glyph specifically', () => {
  // The regression that started this: vite depends on a mask plus blur filters,
  // and it shares those ids with dozens of other icons.
  const vite = fileIconSvg('vite.config.ts')

  it('resolves for every vite.config.* variant', () => {
    for (const name of [
      'vite.config.ts',
      'vite.config.cdn.ts',
      'vite.config.figma-plugin.ts',
      'vite.config.sdk.frame.ts',
      'vite.config.sdk.ts',
      'VITE.CONFIG.TS',
    ]) {
      expect(fileIconSvg(name)).toBe(vite)
    }
  })

  it('keeps its mask and filters pointing at ids it defines itself', () => {
    const own = new Set(definedIds(vite))
    expect(own.size).toBeGreaterThan(0)
    for (const ref of referencedIds(vite)) expect(own.has(ref)).toBe(true)
  })

  it('shares no id with the icons that used to hijack it', () => {
    const viteIds = new Set(definedIds(vite))
    for (const other of ['LICENSE', 'package.json', 'main.py', 'Cargo.toml', 'pom.xml', 'a.pdf']) {
      for (const id of definedIds(fileIconSvg(other))) {
        expect(viteIds.has(id)).toBe(false)
      }
    }
  })
})
