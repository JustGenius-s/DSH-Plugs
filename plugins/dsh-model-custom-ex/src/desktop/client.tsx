import { useEffect, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { createOperations, selectedEfforts, toggleModelEffort } from './editor-state.ts'
import { CONTEXT_PRESETS, OUTPUT_PRESETS, record, THINKING_LEVELS } from './model-settings.ts'
import type { CatalogModel, RecordValue } from './model-settings.ts'
export { createOperations }

type Operations = ReturnType<typeof createOperations>
type Snapshot = Awaited<ReturnType<Operations['modelCustomEx']['read']>>
export function useReasoningEditor(operations: Operations, provider: string, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [error, setError] = useState('')
  const [, changed] = useState(0)
  useEffect(() => {
    setSnapshot(undefined)
    setError('')
    if (!enabled) return
    let active = true
    operations.modelCustomEx.read(provider).then(value => { if (active) setSnapshot(value) }, reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { active = false }
  }, [operations, provider, enabled])
  return {
    enabled, ready: !!snapshot, error,
    catalog: snapshot?.catalog ?? [],
    defaultFor: (model: string) => snapshot?.defaults.get(model) ?? '',
    setDefault(model: string, value: string) { snapshot?.defaults.set(model, value); changed(value => value + 1) },
    async saveDefaults(profileWritten: boolean) {
      const failure = await snapshot?.defaults.save(operations.modelCustomEx.mutate)
      return failure ? (profileWritten ? '模型参数已保存，但默认思考强度未保存：' : '') + failure : undefined
    },
  }
}
type ReasoningState = ReturnType<typeof useReasoningEditor> & { overrides?: unknown; onOverride?(model: string, value: unknown): void }
interface RowProps { model: RecordValue; position: number; disabled: boolean; onChange(model: RecordValue): void; reasoning: ReasoningState }
interface CapacityProps { field: 'contextWindow' | 'maxTokens'; label: string; position: number; disabled: boolean; value: string; placeholder: string; onChange(text: string): void; onBlur?(): void }
interface OfficialPrimitives {
  Button: ComponentType<Record<string, unknown>>
  Input: ComponentType<Record<string, unknown>>
  Menu: ComponentType<Record<string, unknown>>
  Pill: ComponentType<Record<string, unknown>>
  IconChevronDownOutlineRegular: ComponentType<Record<string, unknown>>
}

/** Bind to official UI exports; no copied buttons, menus or component CSS. */
export function createControls(ui: OfficialPrimitives, styles: Record<string, string>) {
  const { Button, Input, Menu, Pill, IconChevronDownOutlineRegular: Chevron } = ui
  function Choice({ label, values, options, disabled, multiple, onSelect }: { label: string; values: string[]; options: { id: string; label: string }[]; disabled: boolean; multiple?: boolean; onSelect(value: string): void }): ReactNode {
    const [open, setOpen] = useState(false)
    const selected = options.filter(option => values.includes(option.id))
    return <Menu open={open} items={options} selectedIds={multiple ? values : undefined} selectedId={multiple ? undefined : values[0]} onClose={() => setOpen(false)} onSelect={(value: string) => { onSelect(value); if (!multiple) setOpen(false) }} portal compact align="start" side="bottom"
      anchor={<Button variant="outline" size="sm" disabled={disabled} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)} style={{ width: '100%', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>{selected.length ? selected.slice(0, 2).map(option => <Pill key={option.id} active>{option.label}</Pill>) : '未选择'}{selected.length > 2 && <Pill>{'+' + (selected.length - 2)}</Pill>}</span><Chevron size={14} />
      </Button>} />
  }
  function CapacityField(props: CapacityProps): ReactNode {
    const [open, setOpen] = useState(false)
    const label = props.label + ' ' + props.position
    const presets = props.field === 'contextWindow' ? CONTEXT_PRESETS : OUTPUT_PRESETS
    return <div className={styles['modelField']}>
      <span className={styles['modelFieldLabel']}>{props.label}</span>
      <Menu open={open} items={presets.map(id => ({ id, label: id }))} selectedId={props.value.toUpperCase()} onClose={() => setOpen(false)} onSelect={(value: string) => { props.onChange(value); setOpen(false) }} portal compact align="end" side="bottom"
        anchor={<div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ flex: 1, minWidth: 0 }}><Input type="text" inputMode="numeric" value={props.value} placeholder={props.placeholder} aria-label={label} disabled={props.disabled} onChange={(event: { target: { value: string } }) => props.onChange(event.target.value)} onBlur={props.onBlur} /></span>
          <Button variant="ghost" size="sm" disabled={props.disabled} aria-label={label + '预设'} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)} icon={<Chevron size={14} />} />
        </div>} />
    </div>
  }
  function ReasoningFields({ model, position, disabled, onChange, reasoning }: RowProps): ReactNode {
    const id = typeof model.id === 'string' ? model.id : ''
    const override = record(record(reasoning.overrides)[id])
    const effective = { ...model, ...override }
    const catalog: CatalogModel | undefined = reasoning.catalog.find(item => item.id === id)
    const values = selectedEfforts(effective, catalog)
    const saved = reasoning.defaultFor(id)
    const chosen = values.includes(saved) ? saved : ''
    const blocked = disabled || !reasoning.ready || !id.trim()
    return <>
      <div className={styles['modelField']}><span className={styles['modelFieldLabel']}>思考强度</span>
        <Choice label={'思考强度 ' + position} values={values} options={THINKING_LEVELS.map(id => ({ id, label: id }))} disabled={blocked} multiple onSelect={level => {
          const next = toggleModelEffort(effective, level, catalog)
          onChange({ ...model, reasoningEfforts: next.reasoningEfforts })
          if (Object.hasOwn(override, 'reasoningEfforts')) reasoning.onOverride?.(id, next.reasoningEfforts)
          if (saved && !selectedEfforts(next, catalog).includes(saved)) reasoning.setDefault(id, '')
        }} />
      </div>
      <div className={styles['modelField']}><span className={styles['modelFieldLabel']}>默认思考强度</span>
        <Choice label={'默认思考强度 ' + position} values={[chosen]} options={[{ id: '', label: '跟随模型推荐' }, ...values.map(id => ({ id, label: id }))]} disabled={blocked || values.length === 0} onSelect={value => reasoning.setDefault(id, value)} />
      </div>
    </>
  }
  return { CapacityField, ReasoningFields }
}
