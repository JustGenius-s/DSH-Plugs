import { createHash } from 'node:crypto'
import { settingsNamespace, type SettingsProvider } from '@just-genius/dsh-plugin-runtime/host'
import type { PluginProfileManager } from '@just-genius/dsh-plugin-runtime'
import type { SyncPayloadV2, SyncPluginsSnapshot } from './shared.ts'
import { collectPlugins } from './profile-sync.ts'

export interface ApplySettingsResult {
  applied: string[]
  skipped: string[]
}

export function collectPayload(
  settings: SettingsProvider,
  profile: PluginProfileManager,
): SyncPayloadV2 {
  const sections: Record<string, Record<string, unknown>> = {}
  for (const descriptor of settings.describe()) {
    sections[String(descriptor.ns)] = isRecord(descriptor.user) ? descriptor.user : {}
  }
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    settings: sections,
    memory: null,
    plugins: collectPlugins(profile).snapshot,
  }
}

export function serializePayload(payload: SyncPayloadV2): string {
  return `${JSON.stringify(payload, null, 2)}\n`
}

export function parsePayload(raw: string): SyncPayloadV2 {
  let json: unknown
  try {
    json = JSON.parse(raw) as unknown
  } catch {
    throw new Error('Cloud config is not valid JSON')
  }
  if (!isRecord(json)) throw new Error('Cloud config has an invalid shape')
  if (json.version === 1) {
    throw new Error('This Gist uses legacy settings.yaml sync. Push once from the upgraded device to migrate it.')
  }
  if (json.version !== 2) throw new Error('Unsupported sync payload version')
  if (typeof json.updatedAt !== 'string' || json.updatedAt === '') {
    throw new Error('Cloud config is missing updatedAt')
  }
  if (!isRecord(json.settings)) throw new Error('Cloud config is missing settings')

  const sections: Record<string, Record<string, unknown>> = {}
  for (const [namespace, section] of Object.entries(json.settings)) {
    if (!isRecord(section)) throw new Error(`Cloud settings section "${namespace}" is invalid`)
    sections[namespace] = section
  }
  return {
    version: 2,
    updatedAt: json.updatedAt,
    settings: sections,
    memory: null,
    plugins: normalizePlugins(json.plugins),
  }
}

export async function applySettings(
  settings: SettingsProvider,
  payload: SyncPayloadV2,
): Promise<ApplySettingsResult> {
  const registered = new Map(settings.describe().map(item => [String(item.ns), item]))
  const applied: string[] = []
  const skipped: string[] = []
  for (const [namespace, section] of Object.entries(payload.settings)) {
    const descriptor = registered.get(namespace)
    if (descriptor === undefined) {
      skipped.push(namespace)
      continue
    }
    await settings.replace(settingsNamespace(namespace), section, descriptor.revision)
    applied.push(namespace)
  }
  return { applied, skipped }
}

export function localContentUpdatedAt(
  profile: PluginProfileManager,
  settingsChangedAt: number | null,
): string | null {
  const profileTime = profile.snapshot().modifiedAt
  const latest = Math.max(profileTime ?? 0, settingsChangedAt ?? 0)
  return latest === 0 ? null : new Date(latest).toISOString()
}

export function contentHash(payload: SyncPayloadV2): string {
  return createHash('sha256').update(serializePayload({ ...payload, updatedAt: '' })).digest('hex').slice(0, 16)
}

function normalizePlugins(raw: unknown): SyncPluginsSnapshot | null {
  if (raw === null || raw === undefined) return null
  if (!isRecord(raw)) throw new Error('Cloud plugins snapshot is invalid')
  if (typeof raw.cordisPatchYml !== 'string') {
    throw new Error('Cloud plugins snapshot is missing cordisPatchYml')
  }
  if (!isRecord(raw.dependencies)) throw new Error('Cloud plugins snapshot is missing dependencies')
  const dependencies: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw.dependencies)) {
    if (typeof value === 'string' && value.trim() !== '') dependencies[key] = value.trim()
  }
  return { dependencies, cordisPatchYml: raw.cordisPatchYml }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
