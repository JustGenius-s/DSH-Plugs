/** Same-origin marketplace routes (hosted by dsh-plugin-config). */
export const CATALOG_PATH = '/dsh-plugin-config/catalog'
export const INSTALL_PATH = '/dsh-plugin-config/install'

/** Public registry published by https://awesome-dsh-plugin.com */
export const CATALOG_URL = 'https://awesome-dsh-plugin.com/plugins.json'

export const AWESOME_SOURCE = 'awesome'

/** `dsh plugin add github:owner/repo` or a monorepo `#path:` spec. */
export const GITHUB_SPEC = /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#[A-Za-z0-9._/&=:-]+)?$/

/** Bare npm package name (optionally scoped). */
export const NPM_SPEC = /^(?:@[A-Za-z0-9-~][A-Za-z0-9-._~]*\/)?[A-Za-z0-9-~][A-Za-z0-9-._~]*$/

/** Direct tarball / package URL accepted by pnpm. */
export const TARBALL_SPEC = /^https?:\/\/\S+$/i

export type InstallMethodKind = 'npm' | 'github' | 'local' | 'tarball'

export interface InstallMethod {
  kind: InstallMethodKind
  /** Argument passed to `dsh plugin --profile web add`. */
  spec: string
  /** Full CLI command shown for copy. */
  command: string
}

export interface LocalizedText {
  en: string
  zh: string
}

export interface ProfilePatch {
  id: string
  disabled?: boolean
}

export interface CatalogPlugin {
  name: string
  packageName?: string
  owner: string
  url: string
  category: string
  description: LocalizedText
  /** Preferred install command (matches `spec`). */
  install: string
  /** Preferred install target (first of `methods` by priority). */
  spec: string
  /** All install targets the catalog exposes for this plugin. */
  methods: InstallMethod[]
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

export interface InstallOutcome {
  ok: boolean
  spec?: string
  needsRestart?: boolean
  error?: string
  detail?: string
}
