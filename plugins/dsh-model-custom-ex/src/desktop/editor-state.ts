import { DEFAULTS_NAMESPACE } from '../shared.ts'
import { record, THINKING_LEVELS, toggleEffort } from './model-settings.ts'
import type { CatalogModel, DesktopRemote, Efforts, Namespace, PathOp, RecordValue } from './model-settings.ts'

export function selectedEfforts(model: RecordValue, catalog?: CatalogModel): string[] {
  if (model.reasoningEfforts === false) return []
  if (model.reasoningEfforts && typeof model.reasoningEfforts === 'object') return THINKING_LEVELS.filter(key => Object.hasOwn(record(model.reasoningEfforts), key))
  return (catalog?.reasoning?.efforts ?? []).map(item => item.id)
}
/** Preserve protocol mappings; an empty selection explicitly disables thinking. */
export function toggleModelEffort(model: RecordValue, level: string, catalog?: CatalogModel): RecordValue {
  const current = model.reasoningEfforts && typeof model.reasoningEfforts === 'object'
    ? record(model.reasoningEfforts) as Efforts
    : Object.fromEntries(selectedEfforts(model, catalog).map(key => [key, key === 'off' ? null : key]))
  const next = toggleEffort(current, level)
  return { ...model, reasoningEfforts: Object.keys(next).length ? next : false }
}
/** Draft lifetime matches the official editor; selections are written only on Save. */
export class DefaultEffortDraft {
  readonly pending = new Map<string, string>()
  namespace: Namespace
  readonly provider: string
  constructor(namespace: Namespace, provider: string) { this.namespace = namespace; this.provider = provider }
  get(model: string): string {
    if (this.pending.has(model)) return this.pending.get(model) ?? ''
    const value = record(record(this.namespace.value.defaults)[this.provider])[model]
    return typeof value === 'string' ? value : ''
  }
  set(model: string, value: string): void { this.pending.set(model, value) }
  operations(): PathOp[] {
    const stored = record(record(this.namespace.value.defaults)[this.provider])
    return [...this.pending].flatMap(([model, value]): PathOp[] => {
      if ((stored[model] ?? '') === value) return []
      const path = ['defaults', this.provider, model]
      return value ? [{ op: 'set', path, value }] : [{ op: 'unset', path }]
    })
  }
  async save(mutate: DesktopRemote['settings']['mutate']): Promise<string | undefined> {
    const ops = this.operations()
    if (!ops.length) return undefined
    try {
      const response = await mutate(DEFAULTS_NAMESPACE, ops, this.namespace.revision)
      if (!response.ok) return response.error.code === 'settings/conflict' ? '默认思考强度配置已变更，请关闭编辑器并重新打开后保存。' : response.error.message
      this.namespace = response.value
      this.pending.clear()
      return undefined
    } catch (error) { return error instanceof Error ? error.message : String(error) }
  }
}
export function createOperations(remote: DesktopRemote) {
  return { modelCustomEx: {
    async read(provider: string) {
      const [description, catalog] = await Promise.all([remote.settings.describe(), remote.session.modelCatalog()])
      if (!description.ok) throw new Error(description.error.message)
      const namespace = description.value.namespaces.find(item => item.ns === DEFAULTS_NAMESPACE)
      if (!namespace) throw new Error('默认思考强度配置尚未就绪，请重新打开编辑器。')
      return { defaults: new DefaultEffortDraft(namespace, provider), catalog: catalog.ok ? catalog.value.groups.find(group => group.id === provider)?.models ?? [] : [] }
    },
    mutate: (ns: string, ops: PathOp[], revision: number) => remote.settings.mutate(ns, ops, revision),
  } }
}
