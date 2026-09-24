import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import { Button } from '@just-genius/dsh-plugin-ui'
import type { SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import type { DshCodexConfig } from '../../shared/config'
import {
  CODE_FONT_FALLBACK,
  UI_FONT_FALLBACK,
  fontFamilyStack,
  type FontPreferenceKey,
} from '../../shared/fonts'
import { saveFontPreference } from '../features/fonts/controller'
import { createBrowserFontCatalog, type FontCatalog, type FontCatalogSnapshot, type LocalFontHost } from '../features/fonts/catalog'
import type { CodexKey } from '../locales'
import { FontPicker } from './FontPicker'

export function FontSettings(props: {
  scope: SettingsScope<DshCodexConfig>
  value: DshCodexConfig
  writable: boolean
  t: (key: CodexKey) => string
}) {
  const [catalog] = useState(() => createBrowserFontCatalog(window as LocalFontHost))
  const snapshot = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot)
  return <>
    {(['uiFontFamily', 'codeFontFamily'] as const).map(field => (
      <FontField
        key={field}
        field={field}
        value={props.value[field]}
        writable={props.writable}
        catalog={catalog}
        snapshot={snapshot}
        t={props.t}
        save={next => saveFontPreference(props.scope, field, next)}
      />
    ))}
  </>
}

function FontField(props: {
  field: FontPreferenceKey
  value: string
  writable: boolean
  catalog: FontCatalog
  snapshot: FontCatalogSnapshot
  t: (key: CodexKey) => string
  save: (next: string) => Promise<void>
}) {
  const { field, value, writable, t, save } = props
  const id = useId()
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => { setDraft(value) }, [value])
  const dirty = draft.trim() !== value
  const disabled = !writable || saving
  const apply = async (next: string): Promise<void> => {
    if (disabled) return
    setSaving(true)
    setFailed(false)
    try {
      await save(next)
      setDraft(next.trim())
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return <div style={{ display: 'grid', gap: 8, padding: '8px 0' }}>
    <label htmlFor={id}>{t(field)}</label>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <FontPicker
        id={id}
        field={field}
        value={draft}
        disabled={disabled}
        catalog={props.catalog}
        snapshot={props.snapshot}
        t={t}
        onChange={next => { setDraft(next); setFailed(false) }}
        onApply={() => { if (dirty) void apply(draft) }}
      />
      <Button size="sm" variant="primary" disabled={disabled || !dirty} onClick={() => { void apply(draft) }}>
        {t(saving ? 'fonts.saving' : 'fonts.apply')}
      </Button>
      <Button size="sm" variant="outline" disabled={disabled || (value === '' && draft === '')} onClick={() => { void apply('') }}>
        {t('fonts.reset')}
      </Button>
    </div>
    <p id={`${id}-preview`} style={{
      margin: 0, padding: '10px 12px', borderRadius: 8,
      background: 'var(--dsw-alias-bg-layer-1)', overflowWrap: 'anywhere',
      fontFamily: fontFamilyStack(draft, field === 'uiFontFamily' ? UI_FONT_FALLBACK : CODE_FONT_FALLBACK),
      fontSize: 14, lineHeight: '22px',
    }}>{t(field === 'uiFontFamily' ? 'fonts.previewText' : 'fonts.previewCode')}</p>
    {failed ? <p role="alert" style={{ margin: 0, color: 'var(--dsw-alias-state-error-primary)' }}>{t('fonts.saveFailed')}</p> : null}
  </div>
}
