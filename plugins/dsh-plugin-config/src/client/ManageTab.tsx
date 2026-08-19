import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Input,
  IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  ExpandableRow,
  FailureRow,
  FilterChip,
  FilterChips,
  InlineNotice,
  RowList,
  SettingsSection,
  StatusText,
  Tag,
  Tree,
  TreeGroup,
  TreeIndent,
  TreeSubName,
} from '@just-genius/dsh-plugin-ui'
import type { ActionResult, InventorySnapshot, ManagedPlugin, PluginAction, PluginOrigin, PluginPlane } from '../types.ts'
import type { ConfigKey } from './locales.ts'
import styles from './ManageTab.module.css'

export interface ManageTabInjected {
  loadInventory: () => Promise<InventorySnapshot>
  runAction: (action: PluginAction, plugin: ManagedPlugin) => Promise<ActionResult>
}

type Translate = (key: ConfigKey) => string
type OriginFilter = 'all' | PluginOrigin
type PlaneFilter = 'all' | PluginPlane

const ORIGIN_ORDER: PluginOrigin[] = ['marketplace', 'external', 'builtin']
const PLANE_ORDER: PluginPlane[] = ['global', 'session']

const PHASE_KEYS: Record<Exclude<ManagedPlugin['fiberPhase'], null>, ConfigKey> = {
  pending: 'pending',
  loading: 'loadingPhase',
  active: 'mounted',
  failed: 'failed',
  unloading: 'unloading',
}

export function ManageTab({ loadInventory, runAction, t }: ManageTabInjected & { t: Translate }) {
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [origin, setOrigin] = useState<OriginFilter>('all')
  const [plane, setPlane] = useState<PlaneFilter>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [notices, setNotices] = useState<Record<string, { kind: 'ok' | 'error'; text: string }>>({})
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error' } | { status: 'ready'; snapshot: InventorySnapshot }
  >({ status: 'loading' })

  useEffect(() => {
    let current = true
    Promise.resolve()
      .then(() => loadInventory())
      .then((snapshot) => {
        if (current) setState({ status: 'ready', snapshot })
      }, () => {
        if (current) setState({ status: 'error' })
      })
    return () => {
      current = false
    }
  }, [loadInventory, request])

  const filtered = useMemo(() => {
    if (state.status !== 'ready') return []
    const needle = query.trim().toLocaleLowerCase()
    return state.snapshot.plugins.filter((plugin) => {
      if (origin !== 'all' && plugin.origin !== origin) return false
      if (plane !== 'all' && plugin.plane !== plane) return false
      if (needle.length === 0) return true
      return [
        plugin.shortName,
        plugin.moduleName,
        plugin.entryId,
        plugin.packageName ?? '',
        plugin.installSpec ?? '',
      ].some((value) => value.toLocaleLowerCase().includes(needle))
    })
  }, [origin, plane, query, state])

  const groups = useMemo(() => groupPlugins(filtered), [filtered])

  const onAction = async (action: PluginAction, plugin: ManagedPlugin) => {
    const key = plugin.entryId
    setBusy(`${action}:${key}`)
    setConfirm(null)
    try {
      const result = await runAction(action, plugin)
      if (!result.ok) {
        setNotices((current) => ({
          ...current,
          [key]: { kind: 'error', text: result.detail ? `${result.error ?? t('actionFail')}\n${result.detail}` : (result.error ?? t('actionFail')) },
        }))
        return
      }
      setNotices((current) => ({
        ...current,
        [key]: { kind: 'ok', text: result.needsRestart ? t('restartHint') : (result.detail ?? t('restartHint')) },
      }))
      setRequest((value) => value + 1)
    } catch (error) {
      setNotices((current) => ({ ...current, [key]: { kind: 'error', text: String(error) } }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <SettingsSection busy={state.status === 'loading'}>
      {state.status === 'loading' ? <StatusText>{t('loading')}</StatusText> : null}
      {state.status === 'error' ? (
        <FailureRow>
          <p role="alert">{t('error')}</p>
          <Button size="sm" variant="outline" onClick={() => setRequest((value) => value + 1)}>
            {t('retry')}
          </Button>
        </FailureRow>
      ) : null}
      {state.status === 'ready' ? (
        <>
          <StatusText>{t('hint')}</StatusText>
          <Input
            type="search"
            icon={<IconSearchOutline16 aria-hidden="true" />}
            value={query}
            placeholder={t('search')}
            aria-label={t('search')}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <FilterChips label={t('originAll')}>
            <FilterChip active={origin === 'all'} onClick={() => setOrigin('all')}>{t('originAll')}</FilterChip>
            <FilterChip active={origin === 'marketplace'} onClick={() => setOrigin('marketplace')}>{t('originMarketplace')}</FilterChip>
            <FilterChip active={origin === 'external'} onClick={() => setOrigin('external')}>{t('originExternal')}</FilterChip>
            <FilterChip active={origin === 'builtin'} onClick={() => setOrigin('builtin')}>{t('originBuiltin')}</FilterChip>
          </FilterChips>
          <FilterChips label={t('planeAll')}>
            <FilterChip active={plane === 'all'} onClick={() => setPlane('all')}>{t('planeAll')}</FilterChip>
            <FilterChip active={plane === 'global'} onClick={() => setPlane('global')}>{t('planeGlobal')}</FilterChip>
            <FilterChip active={plane === 'session'} onClick={() => setPlane('session')}>{t('planeSession')}</FilterChip>
          </FilterChips>
          {state.snapshot.plugins.length === 0 ? <StatusText>{t('empty')}</StatusText> : null}
          {state.snapshot.plugins.length > 0 && filtered.length === 0 ? (
            <StatusText>{t('emptySearch')}</StatusText>
          ) : null}
          {groups.length > 0 ? (
            <Tree>
              {groups.map((originGroup) => (
                <TreeGroup
                  key={originGroup.id}
                  title={t(originLabel(originGroup.id))}
                  count={originGroup.count}
                >
                  {originGroup.planes.map((planeGroup) => (
                    <TreeIndent key={planeGroup.id}>
                      <TreeSubName>{t(planeLabel(planeGroup.id))}</TreeSubName>
                      <RowList>
                        {planeGroup.plugins.map((plugin) => (
                          <PluginRow
                            key={plugin.entryId}
                            plugin={plugin}
                            open={expanded === plugin.entryId}
                            busy={busy}
                            confirm={confirm === plugin.entryId}
                            notice={notices[plugin.entryId]}
                            t={t}
                            onToggle={() => setExpanded((current) => current === plugin.entryId ? null : plugin.entryId)}
                            onDisable={() => void onAction('disable', plugin)}
                            onEnable={() => void onAction('enable', plugin)}
                            onAskUninstall={() => setConfirm(plugin.entryId)}
                            onCancelUninstall={() => setConfirm(null)}
                            onUninstall={() => void onAction('uninstall', plugin)}
                          />
                        ))}
                      </RowList>
                    </TreeIndent>
                  ))}
                </TreeGroup>
              ))}
            </Tree>
          ) : null}
        </>
      ) : null}
    </SettingsSection>
  )
}

function originLabel(origin: PluginOrigin): ConfigKey {
  if (origin === 'builtin') return 'originBuiltin'
  if (origin === 'marketplace') return 'originMarketplace'
  return 'originExternal'
}

function planeLabel(plane: PluginPlane): ConfigKey {
  return plane === 'session' ? 'planeSession' : 'planeGlobal'
}

function groupPlugins(plugins: ManagedPlugin[]) {
  return ORIGIN_ORDER.flatMap((origin) => {
    const items = plugins.filter((plugin) => plugin.origin === origin)
    if (items.length === 0) return []
    return [{
      id: origin,
      count: items.length,
      planes: PLANE_ORDER.flatMap((plane) => {
        const rows = items.filter((plugin) => plugin.plane === plane)
        return rows.length === 0 ? [] : [{ id: plane, plugins: rows }]
      }),
    }]
  })
}

function phaseLabel(plugin: ManagedPlugin, t: Translate): string {
  if (!plugin.enabled) return t('unmounted')
  if (plugin.fiberPhase === null) return t('unmounted')
  return t(PHASE_KEYS[plugin.fiberPhase])
}

function PluginRow(props: {
  plugin: ManagedPlugin
  open: boolean
  busy: string | null
  confirm: boolean
  notice?: { kind: 'ok' | 'error'; text: string }
  t: Translate
  onToggle: () => void
  onDisable: () => void
  onEnable: () => void
  onAskUninstall: () => void
  onCancelUninstall: () => void
  onUninstall: () => void
}) {
  const { plugin, open, busy, confirm, notice, t } = props
  const status = phaseLabel(plugin, t)
  const working = busy?.endsWith(`:${plugin.entryId}`) === true
  const action = busy?.split(':')[0]
  return (
    <ExpandableRow
      open={open}
      onToggle={props.onToggle}
      toggleLabel={`${open ? t('collapse') : t('expand')}: ${plugin.shortName}`}
      name={plugin.shortName}
      nameTitle={plugin.moduleName}
      summary={plugin.packageName ?? plugin.moduleName}
      conflict={plugin.nameConflict}
      meta={(
        <>
          {plugin.enabled ? (
            <span
              className={styles.statusDot}
              data-phase={plugin.fiberPhase ?? 'unobserved'}
              role="img"
              aria-label={status}
              title={status}
            />
          ) : null}
          <Tag variant="text" tone={plugin.enabled ? 'strong' : undefined}>
            {plugin.enabled ? t('enabledTag') : t('disabledTag')}
          </Tag>
        </>
      )}
    >
      {plugin.nameConflict ? (
        <p className={styles.conflict}>
          {t('nameConflict')}
          {plugin.conflictWith ? `: ${plugin.conflictWith}` : ''}
        </p>
      ) : null}
      <dl className={styles.details}>
        <dt>{t('module')}</dt>
        <dd><code>{plugin.moduleName}</code></dd>
        <dt>{t('entry')}</dt>
        <dd><code>{plugin.entryId}</code></dd>
        {plugin.packageName ? (
          <>
            <dt>{t('package')}</dt>
            <dd><code>{plugin.packageName}</code></dd>
          </>
        ) : null}
        {plugin.installSpec ? (
          <>
            <dt>{t('spec')}</dt>
            <dd><code>{plugin.installSpec}</code></dd>
          </>
        ) : null}
      </dl>
      {plugin.protectedReason === 'core' ? <p className={styles.protect}>{t('protectedCore')}</p> : null}
      {plugin.protectedReason === 'session-owned' ? <p className={styles.protect}>{t('protectedSession')}</p> : null}
      {plugin.protectedReason === 'builtin' && !plugin.canUninstall ? <p className={styles.protect}>{t('protectedBuiltin')}</p> : null}
      <div className={styles.actions}>
        {plugin.canDisable ? (
          <Button size="sm" variant="outline" disabled={working} onClick={props.onDisable}>
            {working && action === 'disable' ? t('disabling') : t('disable')}
          </Button>
        ) : null}
        {plugin.canEnable ? (
          <Button size="sm" variant="primary" disabled={working} onClick={props.onEnable}>
            {working && action === 'enable' ? t('enabling') : t('enable')}
          </Button>
        ) : null}
        {plugin.canUninstall && !confirm ? (
          <Button size="sm" variant="outline" disabled={working} onClick={props.onAskUninstall}>
            {t('uninstall')}
          </Button>
        ) : null}
        {plugin.canUninstall && confirm ? (
          <>
            <span className={styles.protect}>{t('confirmUninstall')}</span>
            <Button size="sm" variant="primary" disabled={working} onClick={props.onUninstall}>
              {working && action === 'uninstall' ? t('uninstalling') : t('confirm')}
            </Button>
            <Button size="sm" variant="ghost" disabled={working} onClick={props.onCancelUninstall}>
              {t('cancel')}
            </Button>
          </>
        ) : null}
      </div>
      {notice ? <InlineNotice kind={notice.kind}>{notice.text}</InlineNotice> : null}
    </ExpandableRow>
  )
}
