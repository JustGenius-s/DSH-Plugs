import {
  AWESOME_SOURCE,
  DSH_PLUGS_PLUGINS,
  DSH_PLUGS_SOURCE,
  DSH_PLUGS_URL,
  githubPathSpec,
  pluginUrl,
  type ProfilePatch,
} from './dsh-plugs.ts'

/** Public registry published by https://awesome-dsh-plugin.com */
export const CATALOG_URL = 'https://awesome-dsh-plugin.com/plugins.json'

/** Same-origin routes registered by the host half. */
export const CATALOG_PATH = '/dsh-plugin-marketplace/catalog'
export const INSTALL_PATH = '/dsh-plugin-marketplace/install'

/** `dsh plugin add github:owner/repo` or a monorepo `#path:` spec. */
export const GITHUB_SPEC = /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#[A-Za-z0-9._/&=:-]+)?$/

const CACHE_MS = 10 * 60 * 1000
const FETCH_MS = 15_000

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
  [DSH_PLUGS_SOURCE]: { en: 'DSH-Plugs', zh: 'DSH-Plugs' },
  [AWESOME_SOURCE]: { en: 'awesome-dsh-plugin', zh: 'awesome-dsh-plugin' },
}

export interface LocalizedText {
  en: string
  zh: string
}

export interface CatalogPlugin {
  name: string
  packageName?: string
  owner: string
  url: string
  category: string
  description: LocalizedText
  install: string
  spec: string
  source: string
  added: string
  installed?: boolean
  profilePatches?: ProfilePatch[]
}

export interface Catalog {
  name: string
  url: string
  source: string
  updated: string
  count: number
  categories: Record<string, LocalizedText>
  sources: Record<string, LocalizedText>
  plugins: CatalogPlugin[]
}

let remoteCache: { at: number; catalog: Catalog } | null = null

export function specFromInstall(install: string): string | null {
  const github = /github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#[^\s]+)?/.exec(install)
  if (github) return github[0]
  const absolute = /(?:^|\s)(\/[^\s]+)$/.exec(install)
  return absolute?.[1] ?? null
}

export function catalogHasSpec(catalog: Catalog, spec: string): boolean {
  return catalog.plugins.some((plugin) => plugin.spec === spec)
}

export function catalogEntry(catalog: Catalog, spec: string): CatalogPlugin | undefined {
  return catalog.plugins.find((plugin) => plugin.spec === spec)
}

/** GitHub `#path:` entries for this monorepo — used when the Host scan is unavailable. */
export function dshPlugsRemotePlugins(): CatalogPlugin[] {
  return DSH_PLUGS_PLUGINS.map((def) => {
    const spec = githubPathSpec(def.folder)
    return {
      name: def.folder,
      packageName: def.packageName,
      owner: 'Rory-X',
      url: pluginUrl(def.folder),
      category: def.category,
      description: def.description,
      install: `dsh plugin --profile web add ${spec}`,
      spec,
      source: DSH_PLUGS_SOURCE,
      added: '',
      profilePatches: def.profilePatches,
    }
  })
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
    const spec = typeof row.spec === 'string' && row.spec !== ''
      ? row.spec
      : specFromInstall(row.install) ?? ''
    if (spec === '') continue
    plugins.push({
      name: row.name,
      packageName: typeof row.packageName === 'string' ? row.packageName : undefined,
      owner: row.owner,
      url: row.url,
      category: typeof row.category === 'string' ? row.category : 'tools',
      description: { en: desc.en, zh: desc.zh },
      install: row.install,
      spec,
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
    name: typeof raw.name === 'string' ? raw.name : 'dsh-plugin-marketplace',
    url: typeof raw.url === 'string' ? raw.url : 'https://awesome-dsh-plugin.com',
    source: typeof raw.source === 'string' ? raw.source : DSH_PLUGS_URL,
    updated: typeof raw.updated === 'string' ? raw.updated : '',
    count: plugins.length,
    categories,
    sources: sourcesFromPlugins(plugins, overlay),
    plugins,
  }
}

/** Host-local entries win; otherwise attach this repo's GitHub `#path:` specs. */
export function ensureDshPlugs(catalog: Catalog): Catalog {
  if (catalog.plugins.some((plugin) => plugin.source === DSH_PLUGS_SOURCE)) return catalog
  return mergeCatalogs(dshPlugsRemotePlugins(), catalog)
}

export function emptyRemoteCatalog(): Catalog {
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

export function mergeCatalogs(local: CatalogPlugin[], remote: Catalog): Catalog {
  const seen = new Set<string>()
  const plugins: CatalogPlugin[] = []
  for (const plugin of [...local, ...remote.plugins]) {
    const key = (plugin.packageName ?? plugin.name).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    plugins.push(plugin)
  }
  const sources: Record<string, LocalizedText> = {}
  for (const plugin of plugins) {
    const label = SOURCE_LABELS[plugin.source] ?? { en: plugin.source, zh: plugin.source }
    sources[plugin.source] = label
  }
  return {
    name: 'dsh-plugin-marketplace',
    url: remote.url,
    source: DSH_PLUGS_URL,
    updated: remote.updated,
    count: plugins.length,
    categories: { ...CATEGORY_LABELS, ...remote.categories },
    sources,
    plugins,
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
