import { useEffect, useMemo, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  ExpandableRow,
  FailureRow,
  InlineNotice,
  RowList,
  StatusText,
  Tree,
  TreeGroup,
  TreeIndent,
} from '@just-genius/dsh-plugin-ui'
import type { OutdatedSnapshot, PluginUpdate, UpdateOutcome } from '../types.ts'
import type { PluginsKey } from './locales.ts'
import styles from './PluginsTab.module.css'

export interface UpdatesSectionInjected {
  loadOutdated: () => Promise<OutdatedSnapshot>
  updatePackage: (packageName: string) => Promise<UpdateOutcome>
}

type Translate = (key: PluginsKey) => string

export function UpdatesSection(props: UpdatesSectionInjected & {
  query: string
  refreshKey: number
  onUpdated: () => void
  t: Translate
}) {
  const { loadOutdated, updatePackage, query, refreshKey, onUpdated, t } = props
  const [open, setOpen] = useState(true)
  const [request, setRequest] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const [notices, setNotices] = useState<Record<string, { kind: 'ok' | 'error'; text: string }>>({})
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; detail?: string }
    | { status: 'ready'; snapshot: OutdatedSnapshot }
  >({ status: 'loading' })

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    Promise.resolve()
      .then(() => loadOutdated())
      .then((snapshot) => {
        if (current) setState({ status: 'ready', snapshot })
      }, (error) => {
        if (current) setState({ status: 'error', detail: String(error) })
      })
    return () => {
      current = false
    }
  }, [loadOutdated, request, refreshKey])

  const matched = useMemo(() => {
    if (state.status !== 'ready') return []
    const needle = query.trim().toLocaleLowerCase()
    if (needle === '') return state.snapshot.updates
    return state.snapshot.updates.filter((item) => [
      item.shortName,
      item.packageName,
      item.current,
      item.latest,
    ].some((value) => value.toLocaleLowerCase().includes(needle)))
  }, [query, state])

  useEffect(() => {
    if (expanded === null) return
    if (!matched.some((item) => item.packageName === expanded)) setExpanded(null)
  }, [expanded, matched])

  const searching = query.trim() !== ''
  const sectionOpen = open || searching
  const count = state.status === 'ready' ? matched.length : undefined

  const onUpdate = async (item: PluginUpdate) => {
    const key = item.packageName
    setUpdating(key)
    setNotices((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    try {
      const result = await updatePackage(item.packageName)
      if (!result.ok) {
        const text = [result.error, result.detail].filter(Boolean).join('\n')
        setNotices((current) => ({
          ...current,
          [key]: { kind: 'error', text: text || t('updateFail') },
        }))
        return
      }
      setNotices((current) => ({
        ...current,
        [key]: {
          kind: 'ok',
          text: result.needsRestart ? t('updateOk') : (result.detail ?? t('updateOk')),
        },
      }))
      onUpdated()
      setRequest((value) => value + 1)
    } catch (error) {
      setNotices((current) => ({
        ...current,
        [key]: { kind: 'error', text: String(error) },
      }))
    } finally {
      setUpdating(null)
    }
  }

  return (
    <Tree>
      <TreeGroup
        title={t('updates')}
        count={count}
        open={sectionOpen}
        onToggle={() => setOpen((current) => !current)}
        toggleLabel={`${sectionOpen ? t('collapse') : t('expand')}: ${t('updates')}`}
        actions={(
          <Button
            size="sm"
            variant="ghost"
            disabled={state.status === 'loading' || updating !== null}
            onClick={() => {
              if (!open) setOpen(true)
              setRequest((value) => value + 1)
            }}
          >
            {state.status === 'loading' ? t('loadingUpdates') : t('checkUpdates')}
          </Button>
        )}
      >
        {sectionOpen ? (
          <TreeIndent>
            {state.status === 'loading' ? <StatusText>{t('loadingUpdates')}</StatusText> : null}
            {state.status === 'error' ? (
              <FailureRow>
                <p role="alert">{t('errorUpdates')}</p>
                <Button size="sm" variant="outline" onClick={() => setRequest((value) => value + 1)}>
                  {t('retry')}
                </Button>
              </FailureRow>
            ) : null}
            {state.status === 'ready' ? (
              <>
                {state.snapshot.updates.length === 0 ? (
                  <StatusText>{t('emptyUpdates')}</StatusText>
                ) : null}
                {state.snapshot.updates.length > 0 && matched.length === 0 ? (
                  <StatusText>{t('emptySearchUpdates')}</StatusText>
                ) : null}
                {matched.length > 0 ? (
                  <RowList>
                    {matched.map((item) => (
                      <UpdateRow
                        key={item.packageName}
                        item={item}
                        open={expanded === item.packageName}
                        updating={updating === item.packageName}
                        notice={notices[item.packageName]}
                        t={t}
                        onToggle={() => setExpanded((current) => (
                          current === item.packageName ? null : item.packageName
                        ))}
                        onUpdate={() => void onUpdate(item)}
                      />
                    ))}
                  </RowList>
                ) : null}
              </>
            ) : null}
          </TreeIndent>
        ) : null}
      </TreeGroup>
    </Tree>
  )
}

function UpdateRow(props: {
  item: PluginUpdate
  open: boolean
  updating: boolean
  notice?: { kind: 'ok' | 'error'; text: string }
  t: Translate
  onToggle: () => void
  onUpdate: () => void
}) {
  const { item, open, updating, notice, t, onToggle, onUpdate } = props
  const range = `${item.current} → ${item.latest}`
  return (
    <ExpandableRow
      open={open}
      onToggle={onToggle}
      toggleLabel={`${open ? t('collapse') : t('expand')}: ${item.shortName}`}
      name={item.shortName}
      nameTitle={item.packageName}
      summary={range}
      meta={(
        <Button
          size="sm"
          variant="primary"
          disabled={updating}
          onClick={onUpdate}
        >
          {updating ? t('updating') : t('update')}
        </Button>
      )}
    >
      <InlineNotice>{t('updateRestartHint')}</InlineNotice>
      <dl className={styles.details}>
        <dt>{t('package')}</dt>
        <dd><code>{item.packageName}</code></dd>
        <dt>{t('currentVersion')}</dt>
        <dd><code>{item.current}</code></dd>
        <dt>{t('latestVersion')}</dt>
        <dd><code>{item.latest}</code></dd>
        {item.wanted !== item.latest ? (
          <>
            <dt>{t('wantedVersion')}</dt>
            <dd><code>{item.wanted}</code></dd>
          </>
        ) : null}
      </dl>
      {notice ? <InlineNotice kind={notice.kind}>{notice.text}</InlineNotice> : null}
    </ExpandableRow>
  )
}
