import {
  ALL_OFFICIAL_PACKAGES,
  BROWSER_PROVIDER_PACKAGES,
  CARD_PACKAGES,
  COMPUTER_PROVIDER_PACKAGES,
  EMPTY_DESIRED,
  IDS,
  MANAGED_IDS,
  PACKAGES,
  TARGET_RELEASE,
  type CapabilityCard,
  type ComputerDraft,
  type DesiredState,
  type PatchEntry,
  type UnmanagedEntry,
} from './shared.ts'

export function packageSpec(name: string): string {
  return `${name}@${TARGET_RELEASE}`
}

export function requiredPackages(desired: DesiredState): string[] {
  const names: string[] = []
  if (desired.browser.enabled) {
    names.push(PACKAGES.browserUse, PACKAGES.playwright)
  }
  if (desired.computer.enabled) {
    names.push(PACKAGES.computerUse)
    names.push(desired.computer.provider === 'cua-native' ? PACKAGES.cuaNative : PACKAGES.cuaMcp)
  }
  return unique(names)
}

export function missingPackages(
  desired: DesiredState,
  dependencies: Readonly<Record<string, string>>,
): string[] {
  return requiredPackages(desired).filter((name) => !(name in dependencies))
}

/**
 * Packages to install for one card: only what that card's current draft needs
 * and the profile lacks. The host re-derives this from the same whitelist, so a
 * caller can never widen it.
 */
export function installPlan(
  card: CapabilityCard,
  desired: DesiredState,
  dependencies: Readonly<Record<string, string>>,
): string[] {
  const allowed = new Set<string>(CARD_PACKAGES[card])
  return requiredPackages(desired).filter((name) => allowed.has(name) && !(name in dependencies))
}

export function formatInstallCommand(dshBin: string, packages: readonly string[]): string {
  if (packages.length === 0) return ''
  const specs = packages.map(packageSpec).join(' \\\n  ')
  return `${quote(dshBin)} plugin --profile web add \\\n  ${specs}`
}

export function capabilityOfPackage(name: string): 'browser' | 'computer' | null {
  if (name === PACKAGES.browserUse || BROWSER_PROVIDER_PACKAGES.has(name)) return 'browser'
  if (name === PACKAGES.computerUse || COMPUTER_PROVIDER_PACKAGES.has(name)) return 'computer'
  return null
}

export function unmanagedOfficial(entries: readonly PatchEntry[]): UnmanagedEntry[] {
  const found: UnmanagedEntry[] = []
  for (const entry of entries) {
    if (!ALL_OFFICIAL_PACKAGES.has(entry.name)) continue
    const capability = capabilityOfPackage(entry.name)
    if (capability === null) continue
    if (isManagedId(entry.id)) continue
    found.push({ id: entry.id, name: entry.name, capability })
  }
  return found
}

export function blockingUnmanaged(
  unmanaged: readonly UnmanagedEntry[],
  desired: DesiredState,
): UnmanagedEntry[] {
  return unmanaged.filter((entry) =>
    (entry.capability === 'browser' && desired.browser.enabled)
    || (entry.capability === 'computer' && desired.computer.enabled)
  )
}

export function isManagedId(id: string): boolean {
  return MANAGED_IDS.has(id)
}

export function draftsEqual(left: DesiredState, right: DesiredState): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function validateBrowser(draft: DesiredState['browser']): string | null {
  if (!draft.enabled) return null
  if (draft.provider !== 'playwright-mcp') return 'unsupported browser provider'
  if (draft.mode === 'attach' && draft.endpoint.trim() === '') {
    return 'attach mode needs an endpoint'
  }
  return null
}

export function validateComputer(draft: DesiredState['computer']): string | null {
  if (!draft.enabled) return null
  if (draft.provider === 'cua-mcp' && draft.command.trim() === '') return 'MCP command is required'
  return null
}

export function validateDesired(desired: DesiredState): string | null {
  return validateBrowser(desired.browser) ?? validateComputer(desired.computer)
}

/** Short display name for a package, e.g. `@deepseek-ai/dsh-browser-use` → `dsh-browser-use`. */
export function shortPackageName(name: string): string {
  const slash = name.lastIndexOf('/')
  return slash >= 0 ? name.slice(slash + 1) : name
}

export function inferDesired(entries: readonly PatchEntry[]): DesiredState {
  const next: DesiredState = {
    browser: { enabled: false },
    computer: { enabled: false },
  }
  const playwright = entries.find((entry) => entry.name === PACKAGES.playwright || entry.id === IDS.playwright)
  if (playwright) {
    next.browser = {
      enabled: true,
      provider: 'playwright-mcp',
      mode: playwright.config.mode === 'attach' ? 'attach' : 'launch',
      headless: playwright.config.headless === true,
      executablePath: stringOf(playwright.config.executablePath),
      endpoint: stringOf(playwright.config.endpoint),
    }
  }
  const native = entries.find((entry) => entry.name === PACKAGES.cuaNative || entry.id === IDS.cuaNative)
  const mcp = entries.find((entry) => entry.name === PACKAGES.cuaMcp || entry.id === IDS.cuaMcp)
  if (native) {
    next.computer = { enabled: true, provider: 'cua-native' }
  } else if (mcp) {
    next.computer = {
      enabled: true,
      provider: 'cua-mcp',
      command: stringOf(mcp.config.command) || 'cua-driver',
      args: argsOf(mcp.config.args),
    }
  }
  return next
}

export function desiredEntries(desired: DesiredState): PatchEntry[] {
  const entries: PatchEntry[] = []
  if (desired.browser.enabled) {
    entries.push({ id: IDS.browserUse, name: PACKAGES.browserUse, config: {} })
    const config: Record<string, unknown> = {
      mode: desired.browser.mode,
      headless: desired.browser.headless,
    }
    if (desired.browser.mode === 'launch' && desired.browser.executablePath.trim() !== '') {
      config.executablePath = desired.browser.executablePath.trim()
    }
    if (desired.browser.mode === 'attach') {
      config.endpoint = desired.browser.endpoint.trim()
    }
    entries.push({ id: IDS.playwright, name: PACKAGES.playwright, config })
  }
  if (desired.computer.enabled) {
    entries.push({ id: IDS.computerUse, name: PACKAGES.computerUse, config: {} })
    if (desired.computer.provider === 'cua-native') {
      entries.push({ id: IDS.cuaNative, name: PACKAGES.cuaNative, config: {} })
    } else {
      entries.push({
        id: IDS.cuaMcp,
        name: PACKAGES.cuaMcp,
        config: {
          command: desired.computer.command.trim(),
          args: [...desired.computer.args],
        },
      })
    }
  }
  return entries
}

export function normalizeDesired(input: DesiredState | null | undefined): DesiredState {
  if (input == null) return { ...EMPTY_DESIRED }
  return {
    browser: normalizeBrowser(input.browser),
    computer: normalizeComputer(input.computer),
  }
}

function normalizeBrowser(draft: DesiredState['browser']): DesiredState['browser'] {
  if (draft.enabled !== true) return { enabled: false }
  return {
    enabled: true,
    provider: 'playwright-mcp',
    mode: draft.mode === 'attach' ? 'attach' : 'launch',
    headless: draft.headless === true,
    executablePath: stringOf(draft.executablePath),
    endpoint: stringOf(draft.endpoint),
  }
}

function normalizeComputer(draft: DesiredState['computer']): ComputerDraft {
  if (draft.enabled !== true) return { enabled: false }
  if (draft.provider === 'cua-mcp') {
    return {
      enabled: true,
      provider: 'cua-mcp',
      command: draft.command.trim(),
      args: draft.args.length === 0 ? ['mcp'] : [...draft.args],
    }
  }
  return { enabled: true, provider: 'cua-native' }
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function argsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item !== '')
  if (typeof value === 'string') return value.split(/\s+/).filter((item) => item !== '')
  return ['mcp']
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function quote(value: string): string {
  if (/^[\w./+-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function enabledCapabilities(desired: DesiredState): Set<'browser' | 'computer'> {
  const caps = new Set<'browser' | 'computer'>()
  if (desired.browser.enabled) caps.add('browser')
  if (desired.computer.enabled) caps.add('computer')
  return caps
}

export function parseDesired(value: unknown): DesiredState | null {
  if (value === null || typeof value !== 'object') return null
  const record = value as { browser?: unknown; computer?: unknown }
  const browser = parseBrowser(record.browser)
  const computer = parseComputer(record.computer)
  if (browser === null || computer === null) return null
  return { browser, computer }
}

function parseBrowser(value: unknown): DesiredState['browser'] | null {
  if (value === null || typeof value !== 'object') return { enabled: false }
  const record = value as Record<string, unknown>
  if (record.enabled !== true) return { enabled: false }
  return normalizeBrowser({
    enabled: true,
    provider: 'playwright-mcp',
    mode: record.mode === 'attach' ? 'attach' : 'launch',
    headless: record.headless === true,
    executablePath: stringOf(record.executablePath),
    endpoint: stringOf(record.endpoint),
  })
}

function parseComputer(value: unknown): ComputerDraft | null {
  if (value === null || typeof value !== 'object') return { enabled: false }
  const record = value as Record<string, unknown>
  if (record.enabled !== true) return { enabled: false }
  if (record.provider === 'cua-mcp') {
    return normalizeComputer({
      enabled: true,
      provider: 'cua-mcp',
      command: stringOf(record.command) || 'cua-driver',
      args: argsOf(record.args),
    })
  }
  if (record.provider === 'cua-native' || record.provider === undefined) {
    return { enabled: true, provider: 'cua-native' }
  }
  return null
}
