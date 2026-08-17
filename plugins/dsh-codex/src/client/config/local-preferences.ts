import type { DshCodexConfig } from '../../shared/config'

type Field = keyof DshCodexConfig
type Overrides = Partial<DshCodexConfig>

const STORAGE_KEY = 'dsh-codex:settings-overrides'
const listeners = new Set<() => void>()
let overrides: Overrides = readOverrides()

export function getLocalOverrides(): Overrides {
  return overrides
}

export function subscribeLocalOverrides(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setLocalOverride<K extends Field>(field: K, value: DshCodexConfig[K]): void {
  overrides = { ...overrides, [field]: value }
  persist()
  emit()
}

export function clearLocalOverride(field: Field): void {
  if (!(field in overrides)) return
  const next = { ...overrides }
  delete next[field]
  overrides = next
  persist()
  emit()
}

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function persist(): void {
  try {
    if (Object.keys(overrides).length === 0) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // Private browsing or quota failures leave the in-memory override active.
  }
}

function readOverrides(): Overrides {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return {}
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    const candidate = value as Partial<DshCodexConfig>
    const next: Overrides = {}
    if (typeof candidate.navigatorEnabled === 'boolean') next.navigatorEnabled = candidate.navigatorEnabled
    if (typeof candidate.terminalEnabled === 'boolean') next.terminalEnabled = candidate.terminalEnabled
    if (typeof candidate.gitGraphEnabled === 'boolean') next.gitGraphEnabled = candidate.gitGraphEnabled
    if (candidate.terminalShell === 'auto' || candidate.terminalShell === 'bash' || candidate.terminalShell === 'zsh') next.terminalShell = candidate.terminalShell
    if (typeof candidate.terminalScrollback === 'number' && Number.isFinite(candidate.terminalScrollback)) next.terminalScrollback = candidate.terminalScrollback
    if (typeof candidate.terminalFontSize === 'number' && Number.isFinite(candidate.terminalFontSize)) next.terminalFontSize = candidate.terminalFontSize
    if (typeof candidate.panelDefaultWidth === 'number' && Number.isFinite(candidate.panelDefaultWidth)) next.panelDefaultWidth = candidate.panelDefaultWidth
    if (typeof candidate.panelMaxWidth === 'number' && Number.isFinite(candidate.panelMaxWidth)) next.panelMaxWidth = candidate.panelMaxWidth
    if (typeof candidate.panelRememberTabs === 'boolean') next.panelRememberTabs = candidate.panelRememberTabs
    return next
  } catch {
    return {}
  }
}
