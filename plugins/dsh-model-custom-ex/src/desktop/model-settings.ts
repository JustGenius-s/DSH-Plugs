import { DEFAULTS_NAMESPACE } from '../shared.ts'

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export const CONTEXT_PRESETS = ['32K', '64K', '128K', '256K', '272K', '373K', '512K', '1M', '2M'] as const
export const OUTPUT_PRESETS = ['4K', '8K', '16K', '32K', '64K', '128K'] as const
export type RecordValue = Record<string, unknown>
export type Efforts = Record<string, string | null>
export interface Namespace { ns: string; revision: number; value: RecordValue; user?: RecordValue }
export interface CatalogModel { id: string; name?: string; reasoning?: { efforts: { id: string; name?: string }[]; defaultEffort?: string } }
export interface ModelRow { id: string; name: string; path: string[]; config: RecordValue; catalog?: CatalogModel }
export interface Draft { contextWindow: string; maxTokens: string; mode: 'inherit' | 'custom' | 'disabled'; efforts: Efforts; defaultEffort: string }
export type PathOp = { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }
export type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: { code?: string; message: string } }
export interface DesktopRemote {
  settings: { describe(): Promise<RemoteResult<{ writable: boolean; namespaces: Namespace[] }>>; mutate(ns: string, ops: PathOp[], revision: number): Promise<RemoteResult<Namespace>> }
  session: { modelCatalog(): Promise<RemoteResult<{ groups: { id: string; models: CatalogModel[] }[]; failures?: { id: string; message: string }[] }>> }
  $on(event: string, listener: () => void): () => void
}
export function record(value: unknown): RecordValue { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : {} }
export function parseCapacity(text: string): number | undefined {
  const value = text.trim()
  if (!value) return undefined
  const match = /^([0-9]+(?:[.][0-9]+)?)([km])?$/i.exec(value)
  if (!match) throw new Error('请输入正整数容量，或使用 K / M，例如 256K、1M。')
  const count = Number(match[1]) * (match[2]?.toLowerCase() === 'k' ? 1000 : match[2]?.toLowerCase() === 'm' ? 1000000 : 1)
  const rounded = Math.round(count)
  if (!Number.isSafeInteger(rounded) || rounded <= 0 || Math.abs(count - rounded) > 0.000001) throw new Error('容量必须是正整数。')
  return rounded
}
export function formatCapacity(value: unknown): string {
  if (typeof value !== 'number') return ''
  if (value % 1000000 === 0) return `${value / 1000000}M`
  if (value % 1000 === 0) return `${value / 1000}K`
  return String(value)
}
/** Address individual fields; never replace an entire provider or its model array. */
export function modelRows(namespace: Namespace, provider: string, catalog: CatalogModel[]): ModelRow[] {
  const profile = record(record(namespace.value.providers)[provider])
  const declared = Array.isArray(profile.models) ? profile.models.map(record) : []
  const overrides = record(profile.modelOverrides)
  const metas = new Map(catalog.map(model => [model.id, model]))
  const rows = declared.length > 0 ? declared : [...new Set([...catalog.map(model => model.id), ...Object.keys(overrides)])].map(id => ({ id }))
  return rows.flatMap((model, index) => {
    const id = model.id
    if (typeof id !== 'string' || !id) return []
    const config: RecordValue = { ...model, ...record(overrides[id]) }
    return [{ id, name: typeof config.name === 'string' ? config.name : metas.get(id)?.name ?? id, config, catalog: metas.get(id),
      path: ['providers', provider, ...(declared.length > 0 && !Object.hasOwn(overrides, id) ? ['models', String(index)] : ['modelOverrides', id])] }]
  })
}
export function draftFor(row: ModelRow, defaults: Namespace | undefined, provider: string): Draft {
  const value = row.config.reasoningEfforts
  const saved = record(record(defaults?.value.defaults)[provider])[row.id]
  return { contextWindow: formatCapacity(row.config.contextWindow), maxTokens: formatCapacity(row.config.maxTokens),
    mode: value === false ? 'disabled' : value && typeof value === 'object' ? 'custom' : 'inherit',
    efforts: { ...record(value) } as Efforts, defaultEffort: typeof saved === 'string' ? saved : '' }
}
export function offeredEfforts(row: ModelRow, draft: Draft): string[] {
  return draft.mode === 'disabled' ? [] : draft.mode === 'custom' ? THINKING_LEVELS.filter(level => Object.hasOwn(draft.efforts, level)) : (row.catalog?.reasoning?.efforts ?? []).map(e => e.id)
}
export function toggleEffort(efforts: Efforts, level: string): Efforts {
  if (!THINKING_LEVELS.includes(level as typeof THINKING_LEVELS[number])) throw new Error('Unsupported reasoning level')
  const next = { ...efforts }
  if (Object.hasOwn(next, level)) delete next[level]
  else next[level] = level === 'off' ? null : level
  return next
}
export function changes(row: ModelRow, original: Draft, next: Draft, provider: string): { profile: PathOp[]; defaults: PathOp[] } {
  const profile: PathOp[] = []
  const defaults: PathOp[] = []
  for (const field of ['contextWindow', 'maxTokens'] as const) {
    if (next[field] === original[field]) continue
    const value = parseCapacity(next[field])
    profile.push(value === undefined ? { op: 'unset', path: [...row.path, field] } : { op: 'set', path: [...row.path, field], value })
  }
  if (next.mode !== original.mode || JSON.stringify(next.efforts) !== JSON.stringify(original.efforts)) {
    if (next.mode === 'custom') {
      if (!Object.keys(next.efforts).length) throw new Error('请至少选择一个思考等级，或选择“不支持思考”。')
      for (const [key, value] of Object.entries(next.efforts)) {
        if (!THINKING_LEVELS.includes(key as typeof THINKING_LEVELS[number]) || (value === null ? key !== 'off' : typeof value !== 'string' || !value.trim())) throw new Error('思考等级的协议值无效。')
      }
    }
    profile.push(next.mode === 'inherit' ? { op: 'unset', path: [...row.path, 'reasoningEfforts'] } : { op: 'set', path: [...row.path, 'reasoningEfforts'], value: next.mode === 'disabled' ? false : next.efforts })
  }
  if (next.defaultEffort && !offeredEfforts(row, next).includes(next.defaultEffort)) throw new Error('默认强度必须属于当前启用的思考等级。')
  if (next.defaultEffort !== original.defaultEffort) {
    const path = ['defaults', provider, row.id]
    defaults.push(next.defaultEffort ? { op: 'set', path, value: next.defaultEffort } : { op: 'unset', path })
  }
  return { profile, defaults }
}
/** Surface a partial write explicitly, retaining the successful revision for retry. */
export async function saveChanges(remote: DesktopRemote, ns: Namespace, defaults: Namespace, ops: ReturnType<typeof changes>) {
  let profile = ns
  let savedDefaults = defaults
  let profileWritten = false
  try {
    if (ops.profile.length) {
      const result = await remote.settings.mutate(ns.ns, ops.profile, ns.revision)
      if (!result.ok) throw new Error(result.error.message)
      profile = result.value
      profileWritten = true
    }
    if (ops.defaults.length) {
      const result = await remote.settings.mutate(DEFAULTS_NAMESPACE, ops.defaults, defaults.revision)
      if (!result.ok) throw new Error(result.error.message)
      savedDefaults = result.value
    }
    return { ok: true as const, profile, defaults: savedDefaults, profileWritten }
  } catch (error) {
    return { ok: false as const, profile, defaults: savedDefaults, profileWritten, error: `${profileWritten ? '模型参数已保存，但默认强度未保存：' : ''}${error instanceof Error ? error.message : String(error)}` }
  }
}
