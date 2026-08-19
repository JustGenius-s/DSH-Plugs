// Build-time half of the monorepo's CSS convention: *.module.css imports are
// compiled with Lightning CSS (css-modules, [hash]_[local] class names,
// minified) and inlined as a self-injecting <style data-plugin-css> tag —
// the same contract the runtime injectStyles() helper uses, so HMR stripping
// and watch-mode rebuilds behave identically for both kinds of stylesheet.

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve, sep } from 'node:path'
import { transform } from 'lightningcss'

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

// dts bundling imports the emitted lib/types/*.d.ts, whose relative module.css
// paths only exist back under src/.
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolve(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = sep + 'lib' + sep + 'types' + sep
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolve(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}

/** The subset of the rolldown plugin context this plugin uses. */
interface WatchContext {
  addWatchFile: (id: string) => void
}

/**
 * The rolldown plugin every client bundle in this monorepo uses to inline
 * CSS modules. `id` is the owning package name, stamped onto the injected
 * tag's data-plugin attribute so the HMR receiver can strip it.
 */
export function dshCssModules(id: string) {
  return {
    name: 'dsh-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
      return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(this: WatchContext, virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
      const tagId = id + '/' + basename(fileId)
      return [
        'const css = ' + JSON.stringify(code.toString()) + ';',
        'const tagId = ' + JSON.stringify(tagId) + ';',
        "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
        "  const tag = document.createElement('style');",
        '  tag.dataset.plugin = ' + JSON.stringify(id) + ';',
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        'export default ' + JSON.stringify(classMap) + ';',
      ].join('\n')
    },
  }
}
