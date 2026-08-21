import {
  AWESOME_SOURCE,
  CATALOG_URL,
  GITHUB_SPEC,
  NPM_SPEC,
  TARBALL_SPEC,
  type Catalog,
  type CatalogPlugin,
  type InstallMethod,
  type InstallMethodKind,
  type LocalizedText,
  type ProfilePatch,
} from './types.ts'

const CACHE_MS = 10 * 60 * 1000
const FETCH_MS = 15_000

const METHOD_PRIORITY: InstallMethodKind[] = ['npm', 'github', 'tarball', 'local']

export const CATEGORY_LABELS: Record<string, LocalizedText> = {
  ui: { en: 'UI Enhancements', zh: 'UI 增强' },
  session: { en: 'Sessions & Messages', zh: '会话与消息' },
  tools: { en: 'Tools & Capabilities', zh: '工具与能力' },
  workflow: { en: 'Workflow & Automation', zh: '工作流与自动化' },
  notify: { en: 'Notifications & Integrations', zh: '通知与集成' },
  dev: { en: 'Development & Runtime', zh: '开发与运行时' },
  fun: { en: 'Just for Fun', zh: '娱乐' },
}

export const SOURCE_LABELS: Record<string, LocalizedText> = {
  [AWESOME_SOURCE]: { en: 'awesome-dsh-plugin', zh: 'awesome-dsh-plugin' },
}

let remoteCache: { at: number; catalog: Catalog } | null = null

/** Pull the argument after `dsh plugin … add` from an install command. */
export function addArgFromInstall(install: string): string | null {
  const match = /\badd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/i.exec(install.trim())
  if (!match) return null
  return (match[1] ?? match[2] ?? match[3] ?? '').trim() || null
}

export function classifyInstallSpec(spec: string): InstallMethodKind | null {
  const trimmed = spec.trim()
  if (trimmed === '') return null
  if (GITHUB_SPEC.test(trimmed)) return 'github'
  if (trimmed.startsWith('/')) return 'local'
  if (/^https?:\/\//i.test(trimmed)) return TARBALL_SPEC.test(trimmed) ? 'tarball' : null
  if (NPM_SPEC.test(trimmed)) return 'npm'
  return null
}

export function commandForSpec(spec: string): string {
  const quoted = /[\s"]/.test(spec) ? `"${spec.replace(/"/g, '\\"')}"` : spec
  return `dsh plugin --profile web add ${quoted}`
}

/**
 * Collect every install target for one catalog row.
 * Priority for the default: npm → github → tarball → local.
 */
export function collectInstallMethods(row: {
  install: string
  npm?: string
  tarball?: string
  spec?: string
  owner?: string
  name?: string
  url?: string
}): InstallMethod[] {
  const bySpec = new Map<string, InstallMethod>()

  const push = (raw: string | undefined | null) => {
    if (raw === undefined || raw === null) return
    const spec = raw.trim()
    if (spec === '' || bySpec.has(spec)) return
    const kind = classifyInstallSpec(spec)
    if (kind === null) return
    bySpec.set(spec, { kind, spec, command: commandForSpec(spec) })
  }

  push(row.npm)
  push(row.spec)
  push(addArgFromInstall(row.install))
  push(row.tarball)

  // Offer github:owner/repo when the catalog points at a GitHub repo page,
  // even if the preferred install command is an npm package name.
  const githubFromUrl = githubSpecFromUrl(row.url)
  if (githubFromUrl) push(githubFromUrl)
  else if (row.owner && row.name) push(`github:${row.owner}/${row.name}`)

  const methods = [...bySpec.values()]
  methods.sort((left, right) => (
    METHOD_PRIORITY.indexOf(left.kind) - METHOD_PRIORITY.indexOf(right.kind)
  ))
  return methods
}

function githubSpecFromUrl(url: string | undefined): string | null {
  if (url === undefined || url === '') return null
  const match = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/|$)/i
    .exec(url.trim())
  if (!match) return null
  return `github:${match[1]}/${match[2]}`
}

/** @deprecated Prefer {@link collectInstallMethods}; kept for call sites that only need one. */
export function specFromInstall(install: string): string | null {
  return addArgFromInstall(install)
}

export function catalogHasSpec(catalog: Catalog, spec: string): boolean {
  return catalog.plugins.some((plugin) => pluginMethods(plugin).some((method) => method.spec === spec))
}

export function catalogEntry(catalog: Catalog, spec: string): CatalogPlugin | undefined {
  return catalog.plugins.find((plugin) => pluginMethods(plugin).some((method) => method.spec === spec))
}

function pluginMethods(plugin: CatalogPlugin): InstallMethod[] {
  if (plugin.methods.length > 0) return plugin.methods
  if (plugin.spec === '') return []
  const kind = classifyInstallSpec(plugin.spec) ?? 'npm'
  return [{ kind, spec: plugin.spec, command: plugin.install || commandForSpec(plugin.spec) }]
}

function sourcesFromPlugins(
  plugins: CatalogPlugin[],
  overlay: Record<string, LocalizedText> = {},
): Record<string, LocalizedText> {
  const sources: Record<string, LocalizedText> = {}
  for (const plugin of plugins) {
    sources[plugin.source] = overlay[plugin.source]
      ?? SOURCE_LABELS[plugin.source]
      ?? { en: plugin.source, zh: plugin.source }
  }
  return sources
}

export function parseCatalog(value: unknown): Catalog {
  if (value === null || typeof value !== 'object') throw new Error('catalog: expected an object')
  const raw = value as Record<string, unknown>
  if (!Array.isArray(raw.plugins)) throw new Error('catalog: missing plugins[]')
  const plugins: CatalogPlugin[] = []
  for (const item of raw.plugins) {
    if (item === null || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const description = row.description
    if (description === null || typeof description !== 'object') continue
    const desc = description as Record<string, unknown>
    if (typeof row.name !== 'string' || typeof row.owner !== 'string') continue
    if (typeof row.url !== 'string' || typeof row.install !== 'string') continue
    if (typeof desc.en !== 'string' || typeof desc.zh !== 'string') continue

    const methods = collectInstallMethods({
      install: row.install,
      npm: typeof row.npm === 'string' ? row.npm : undefined,
      tarball: typeof row.tarball === 'string' ? row.tarball : undefined,
      spec: typeof row.spec === 'string' ? row.spec : undefined,
      owner: row.owner,
      name: row.name,
      url: row.url,
    })
    if (methods.length === 0) continue

    // Prefer the install command's own target when it is one of the methods;
    // otherwise fall back to priority order (npm → github → tarball → local).
    const installArg = addArgFromInstall(row.install)
    const preferred = (installArg !== null
      ? methods.find((method) => method.spec === installArg)
      : undefined) ?? methods[0]!
    const packageName = typeof row.packageName === 'string'
      ? row.packageName
      : typeof row.npm === 'string'
        ? row.npm
        : preferred.kind === 'npm'
          ? preferred.spec
          : undefined

    plugins.push({
      name: row.name,
      packageName,
      owner: row.owner,
      url: row.url,
      category: typeof row.category === 'string' ? row.category : 'tools',
      description: { en: desc.en, zh: desc.zh },
      install: preferred.command,
      spec: preferred.spec,
      methods,
      source: typeof row.source === 'string' ? row.source : AWESOME_SOURCE,
      added: typeof row.added === 'string' ? row.added : '',
      installed: row.installed === true,
      profilePatches: parsePatches(row.profilePatches),
    })
  }
  const categories: Record<string, LocalizedText> = { ...CATEGORY_LABELS }
  if (raw.categories !== null && typeof raw.categories === 'object') {
    for (const [key, label] of Object.entries(raw.categories as Record<string, unknown>)) {
      const pair = asLocalized(label)
      if (pair) categories[key] = pair
    }
  }
  const overlay: Record<string, LocalizedText> = {}
  if (raw.sources !== null && typeof raw.sources === 'object') {
    for (const [key, label] of Object.entries(raw.sources as Record<string, unknown>)) {
      const pair = asLocalized(label)
      if (pair) overlay[key] = pair
    }
  }
  return {
    name: typeof raw.name === 'string' ? raw.name : 'awesome-dsh-plugin',
    url: typeof raw.url === 'string' ? raw.url : 'https://awesome-dsh-plugin.com',
    source: typeof raw.source === 'string'
      ? raw.source
      : 'https://github.com/awesome-dsh-plugin/awesome-dsh-plugin',
    updated: typeof raw.updated === 'string' ? raw.updated : '',
    count: plugins.length,
    categories,
    sources: sourcesFromPlugins(plugins, overlay),
    plugins,
  }
}

export function emptyCatalog(): Catalog {
  return {
    name: 'awesome-dsh-plugin',
    url: 'https://awesome-dsh-plugin.com',
    source: 'https://github.com/awesome-dsh-plugin/awesome-dsh-plugin',
    updated: '',
    count: 0,
    categories: { ...CATEGORY_LABELS },
    sources: { ...SOURCE_LABELS },
    plugins: [],
  }
}

export async function loadRemoteCatalog(force = false): Promise<Catalog> {
  const now = Date.now()
  if (!force && remoteCache && now - remoteCache.at < CACHE_MS) return remoteCache.catalog
  const catalog = parseCatalog(await fetchJson(CATALOG_URL))
  for (const plugin of catalog.plugins) {
    if (plugin.source === '') plugin.source = AWESOME_SOURCE
  }
  remoteCache = { at: now, catalog }
  return catalog
}

/** Package names from the remote catalog — used to classify inventory origin. */
export function catalogPackageNames(catalog: Catalog): Set<string> {
  const names = new Set<string>()
  for (const plugin of catalog.plugins) {
    if (plugin.packageName) names.add(plugin.packageName.toLowerCase())
    names.add(plugin.name.toLowerCase())
    for (const method of plugin.methods) {
      if (method.kind === 'npm') names.add(method.spec.toLowerCase())
    }
  }
  return names
}

function asLocalized(value: unknown): LocalizedText | null {
  if (value === null || typeof value !== 'object') return null
  const pair = value as Record<string, unknown>
  if (typeof pair.en !== 'string' || typeof pair.zh !== 'string') return null
  return { en: pair.en, zh: pair.zh }
}

function parsePatches(value: unknown): ProfilePatch[] | undefined {
  if (!Array.isArray(value)) return undefined
  const patches: ProfilePatch[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string') continue
    patches.push({
      id: row.id,
      disabled: row.disabled === true ? true : undefined,
    })
  }
  return patches.length > 0 ? patches : undefined
}

async function fetchJson(url: string): Promise<unknown> {
  const signal = AbortSignal.timeout(FETCH_MS)
  const response = await fetch(url, {
    signal,
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`catalog fetch failed: ${response.status}`)
  return await response.json()
}
