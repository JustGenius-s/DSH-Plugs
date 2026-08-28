import { useCallback, useState, useSyncExternalStore } from 'react'
import type { SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import {
  CardFooter,
  DiscardButton,
  NumberField,
  PendingBadge,
  SaveButton,
  SettingsCard,
  SwitchField,
} from '@just-genius/dsh-plugin-ui'
import { DEFAULTS, type WhaleGirlConfig } from '../shared/config.ts'
import { ensureCardStyles } from './styles.ts'

ensureCardStyles()

export interface PetCardProps {
  t: (key: string) => string
  scope: SettingsScope<WhaleGirlConfig>
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
    <SettingsCard
      title={title}
      description={t('card.description')}
      open={open}
      onToggle={() => { setOpen(!open) }}
      toggleLabel={`${t(open ? 'card.collapse' : 'card.expand')}: ${title}`}
      pending={dirty ? <PendingBadge>{t('card.unsaved')}</PendingBadge> : undefined}
    >
      {!writable ? <p className="dsh-wg-readonly" role="status">{t('card.readOnly')}</p> : null}
      <SwitchField
        id="plugin-config-whale-girl-enabled"
        label={t('gate.enabled')}
        hint={t('gate.enabledHint')}
        checked={staged.enabled}
        disabled={disabled}
        onChange={(enabled) => { edit({ enabled }) }}
      />
      <SwitchField
        id="plugin-config-whale-girl-walk"
        label={t('gate.walk')}
        hint={t('gate.walkHint')}
        checked={staged.walk.enabled}
        disabled={disabled}
        onChange={(enabled) => { edit({ walk: { ...staged.walk, enabled } }) }}
      />
      <NumberField
        id="plugin-config-whale-girl-size"
        label={t('field.size')}
        hint={t('field.sizeHint')}
        value={staged.size}
        min={64}
        max={160}
        disabled={disabled}
        onChange={(size) => { edit({ size }) }}
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
        onChange={(opacity) => { edit({ opacity }) }}
      />
      <NumberField
        id="plugin-config-whale-girl-sleep"
        label={t('field.sleep')}
        hint={t('field.sleepHint')}
        value={Math.round(staged.sleepAfterMs / 1000)}
        min={5}
        max={600}
        disabled={disabled}
        onChange={(seconds) => { edit({ sleepAfterMs: seconds * 1000 }) }}
      />
      <CardFooter>
        {failed ? <p className="dsh-wg-failed" role="status">{t('card.saveFailed')}</p> : null}
        <DiscardButton disabled={!dirty || saving} onClick={() => { setDraft(null) }}>
          {t('card.discard')}
        </DiscardButton>
        <SaveButton disabled={!dirty || saving} onClick={save}>
          {t(saving ? 'card.saving' : 'card.save')}
        </SaveButton>
      </CardFooter>
    </SettingsCard>
  )
}
