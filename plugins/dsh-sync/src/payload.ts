import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import type { SyncPayloadV1, SyncPluginsSnapshot } from './shared.ts'
import { collectPlugins, profileContentMtimes } from './profile-sync.ts'
import {
  readTextIfExists,
  settingsYamlPath,
  writeText,
} from './sync-store.ts'

export function collectPayload(): SyncPayloadV1 {
  const settingsYaml = readTextIfExists(settingsYamlPath()) ?? ''
  const { snapshot } = collectPlugins()
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    settingsYaml,
    memory: null,
    plugins: snapshot,
  }
}

export function serializePayload(payload: SyncPayloadV1): string {
  return `${JSON.stringify(payload, null, 2)}\n`
}

export function parsePayload(raw: string): SyncPayloadV1 {
  let json: unknown
  try {
    json = JSON.parse(raw) as unknown
  } catch {
    throw new Error('Cloud config is not valid JSON')
  }
  if (json === null || typeof json !== 'object') {
    throw new Error('Cloud config has an invalid shape')
  }
  const row = json as Record<string, unknown>
  if (row.version !== 1) throw new Error('Unsupported sync payload version')
  if (typeof row.updatedAt !== 'string' || row.updatedAt === '') {
    throw new Error('Cloud config is missing updatedAt')
  }
  if (typeof row.settingsYaml !== 'string') {
    throw new Error('Cloud config is missing settingsYaml')
  }
  return {
    version: 1,
    updatedAt: row.updatedAt,
    settingsYaml: row.settingsYaml,
    // Memory sync is disabled for now; ignore any legacy cloud field.
    memory: null,
    plugins: normalizePlugins(row.plugins),
  }
}

export function applySettings(payload: SyncPayloadV1): void {
  writeText(settingsYamlPath(), payload.settingsYaml.endsWith('\n')
    ? payload.settingsYaml
    : `${payload.settingsYaml}\n`)
}

/** @deprecated use applySettings — kept name for call sites during transition */
export function applyPayload(payload: SyncPayloadV1): void {
  applySettings(payload)
}

export function localContentUpdatedAt(): string | null {
  const times: number[] = [...profileContentMtimes()]
  const settings = settingsYamlPath()
  if (existsSync(settings)) {
    try {
      times.push(statSync(settings).mtimeMs)
    } catch {
      // ignore
    }
  }
  if (times.length === 0) return null
  return new Date(Math.max(...times)).toISOString()
}

export function contentHash(payload: SyncPayloadV1): string {
  return createHash('sha256').update(serializePayload({
    ...payload,
    updatedAt: '',
  })).digest('hex').slice(0, 16)
}

function normalizePlugins(raw: unknown): SyncPluginsSnapshot | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object') {
    throw new Error('Cloud plugins snapshot is invalid')
  }
  const row = raw as Record<string, unknown>
  if (typeof row.cordisPatchYml !== 'string') {
    throw new Error('Cloud plugins snapshot is missing cordisPatchYml')
  }
  if (row.dependencies === null || typeof row.dependencies !== 'object') {
    throw new Error('Cloud plugins snapshot is missing dependencies')
  }
  const dependencies: Record<string, string> = {}
  for (const [key, value] of Object.entries(row.dependencies as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim() !== '') dependencies[key] = value.trim()
  }
  return {
    dependencies,
    cordisPatchYml: row.cordisPatchYml,
  }
}
