// Build-time half of the monorepo's CSS convention: *.module.css imports are
// compiled with Lightning CSS (css-modules, [hash]_[local] class names,
// minified) and inlined as a self-injecting <style data-plugin-css> tag —
// the same contract the runtime injectStyles() helper uses, so HMR stripping
// and watch-mode rebuilds behave identically for both kinds of stylesheet.

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
 * Lightning CSS derives a CSS module's class names from the file PATH, not
 * from its contents, so two builds of the same module emit the same names even
 * when the rules differ. Inside one app that is fine; in this monorepo it is
 * not: the shared UI kit is inlined into every plugin bundle, and the injected
 * <style> tag is created once per page — so an older plugin version still
 * installed in the profile would style the newer markup, and the newer bundle
 * would not even inject its sheet.
 *
 * Appending a hash of the compiled CSS to the class prefix makes a stale sheet
 * inert (its selectors no longer match), and the same revision versions the tag
 * id, so every build injects its own sheet.
 */
export function scopedByContent(
  css: string,
  cssExports: Record<string, { name: string }> | undefined,
): { css: string; classes: Record<string, string>; revision: string } {
  const revision = createHash('sha256').update(css).digest('hex').slice(0, 6)
  const entries = Object.entries(cssExports ?? {})
  const classes: Record<string, string> = {}
  for (const [local, entry] of entries) classes[local] = entry.name
  // A composed export's name is a space-separated list, so only a plain one
  // tells us the hash prefix; without it the tag revision still applies.
  const sample = entries.find(([local, entry]) => entry.name.endsWith(local) && entry.name.length > local.length)
  if (sample === undefined) return { css, classes, revision }
  const [local, entry] = sample
  const prefix = entry.name.slice(0, entry.name.length - local.length)
  const scoped = prefix + revision + '_'
  for (const [key, value] of entries) classes[key] = value.name.split(prefix).join(scoped)
  return { css: css.split(prefix).join(scoped), classes, revision }
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
      const { css, classes, revision } = scopedByContent(
        code.toString(),
        cssExports as Record<string, { name: string }> | undefined,
      )
      const tagId = id + '/' + basename(fileId) + '-' + revision
      return [
        'const css = ' + JSON.stringify(css) + ';',
        'const tagId = ' + JSON.stringify(tagId) + ';',
        "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
        "  const tag = document.createElement('style');",
        '  tag.dataset.plugin = ' + JSON.stringify(id) + ';',
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        'export default ' + JSON.stringify(classes) + ';',
      ].join('\n')
    },
  }
}
