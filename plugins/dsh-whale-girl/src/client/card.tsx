import { useCallback, useState, useSyncExternalStore } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { DEFAULTS, type WhaleGirlConfig } from '../shared/config.ts'
import { ensureCardStyles } from './styles.ts'

ensureCardStyles()

export interface PetCardProps {
  t: (key: string) => string
  scope: SettingsScope<WhaleGirlConfig>
}

function ChevronIcon(props: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={'dsh-wg-chevron' + (props.open ? ' dsh-wg-chevron-open' : '')}
    >
      <path
        d="M3.5 5.25 7 8.75l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function GateField(props: {
  id: string
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  onEdit: (enabled: boolean) => void
}) {
  return (
    <div className="dsh-wg-field">
      <div className="dsh-wg-field-head">
        <label className="dsh-wg-label" htmlFor={props.id}>{props.label}</label>
        <input
          id={props.id}
          type="checkbox"
          role="switch"
          className="dsh-wg-switch"
          checked={props.checked}
          disabled={props.disabled}
          onChange={(e) => props.onEdit(e.target.checked)}
        />
      </div>
      <p className="dsh-wg-hint">{props.hint}</p>
    </div>
  )
}

function NumberField(props: {
  id: string
  label: string
  hint: string
  value: number
  min: number
  max: number
  step?: number
  disabled: boolean
  onEdit: (value: number) => void
}) {
  return (
    <div className="dsh-wg-field">
      <div className="dsh-wg-field-head">
        <label className="dsh-wg-label" htmlFor={props.id}>{props.label}</label>
        <input
          id={props.id}
          type="number"
          className="dsh-wg-number"
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          value={props.value}
          disabled={props.disabled}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) props.onEdit(n)
          }}
        />
      </div>
      <p className="dsh-wg-hint">{props.hint}</p>
    </div>
  )
}

export function PetCard(props: PetCardProps) {
  const { t, scope } = props
  const subscribe = useCallback((cb: () => void) => scope.subscribe(cb), [scope])
  const getSnapshot = useCallback(() => scope.getSnapshot(), [scope])
  const snap = useSyncExternalStore(subscribe, getSnapshot)

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<WhaleGirlConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  if (snap.status === 'unavailable') return null

  const committed: WhaleGirlConfig = {
    ...DEFAULTS,
    ...(snap.value ?? {}),
    walk: { ...DEFAULTS.walk, ...(snap.value?.walk ?? {}) },
    replies: snap.value?.replies ?? { feed: [...DEFAULTS.replies.feed], play: [...DEFAULTS.replies.play] },
  }
  const staged = draft ?? committed
  const dirty = draft !== null && (
    draft.enabled !== committed.enabled
    || draft.size !== committed.size
    || draft.opacity !== committed.opacity
    || draft.walk.enabled !== committed.walk.enabled
    || draft.sleepAfterMs !== committed.sleepAfterMs
  )
  const writable = snap.status === 'ready' && snap.writable
  const disabled = !writable || saving

  const edit = (patch: Partial<WhaleGirlConfig>): void => {
    setDraft({ ...staged, ...patch, walk: { ...staged.walk, ...(patch.walk ?? {}) } })
  }

  const save = (): void => {
    if (!dirty || draft === null) return
    setSaving(true)
    setFailed(false)
    void Promise.all([
      scope.set('enabled', staged.enabled),
      scope.set('size', staged.size),
      scope.set('opacity', staged.opacity),
      scope.set('sleepAfterMs', staged.sleepAfterMs),
      scope.set('walk.enabled' as never, staged.walk.enabled),
    ])
      .then(() => { setDraft(null) })
      .catch(() => { setFailed(true) })
      .finally(() => { setSaving(false) })
  }

  const title = t('card.title')
  return (
    <li className={'dsh-wg-card' + (open ? ' dsh-wg-card-open' : '')}>
      <button
        type="button"
        className="dsh-wg-header"
        aria-expanded={open}
        aria-label={`${t(open ? 'card.collapse' : 'card.expand')}: ${title}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className="dsh-wg-headtext">
          <span className="dsh-wg-name">{title}</span>
          <span className="dsh-wg-description">{t('card.description')}</span>
        </span>
        {dirty ? <span className="dsh-wg-pending">{t('card.unsaved')}</span> : null}
        <ChevronIcon open={open} />
      </button>
      {open
        ? (
          <div className="dsh-wg-body">
            {!writable ? <p className="dsh-wg-readonly" role="status">{t('card.readOnly')}</p> : null}
            <GateField
              id="plugin-config-whale-girl-enabled"
              label={t('gate.enabled')}
              hint={t('gate.enabledHint')}
              checked={staged.enabled}
              disabled={disabled}
              onEdit={(enabled) => { edit({ enabled }) }}
            />
            <GateField
              id="plugin-config-whale-girl-walk"
              label={t('gate.walk')}
              hint={t('gate.walkHint')}
              checked={staged.walk.enabled}
              disabled={disabled}
              onEdit={(enabled) => { edit({ walk: { ...staged.walk, enabled } }) }}
            />
            <NumberField
              id="plugin-config-whale-girl-size"
              label={t('field.size')}
              hint={t('field.sizeHint')}
              value={staged.size}
              min={64}
              max={160}
              disabled={disabled}
              onEdit={(size) => { edit({ size }) }}
            />
            <NumberField
              id="plugin-config-whale-girl-opacity"
              label={t('field.opacity')}
              hint={t('field.opacityHint')}
              value={staged.opacity}
              min={0.2}
              max={1}
              step={0.05}
              disabled={disabled}
              onEdit={(opacity) => { edit({ opacity }) }}
            />
            <NumberField
              id="plugin-config-whale-girl-sleep"
              label={t('field.sleep')}
              hint={t('field.sleepHint')}
              value={Math.round(staged.sleepAfterMs / 1000)}
              min={5}
              max={600}
              disabled={disabled}
              onEdit={(seconds) => { edit({ sleepAfterMs: seconds * 1000 }) }}
            />
            <div className="dsh-wg-footer">
              {failed ? <p className="dsh-wg-failed" role="status">{t('card.saveFailed')}</p> : null}
              <button
                type="button"
                className="dsh-wg-discard"
                disabled={!dirty || saving}
                onClick={() => { setDraft(null) }}
              >
                {t('card.discard')}
              </button>
              <button
                type="button"
                className="dsh-wg-save"
                disabled={!dirty || saving}
                onClick={save}
              >
                {t(saving ? 'card.saving' : 'card.save')}
              </button>
            </div>
          </div>
        )
        : null}
    </li>
  )
}
