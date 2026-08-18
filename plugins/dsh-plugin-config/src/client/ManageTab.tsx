import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  IconChevronRightOutline14,
  IconSearchOutline16,
  Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
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
    <div className={styles.section} aria-busy={state.status === 'loading'}>
      {state.status === 'loading' ? <p className={styles.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={styles.failure}>
          <p role="alert">{t('error')}</p>
          <Button size="sm" variant="outline" onClick={() => setRequest((value) => value + 1)}>
            {t('retry')}
          </Button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <>
          <p className={styles.hint}>{t('hint')}</p>
          <Input
            type="search"
            icon={<IconSearchOutline16 aria-hidden="true" />}
            value={query}
            placeholder={t('search')}
            aria-label={t('search')}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <div className={styles.filters} role="group" aria-label={t('originAll')}>
            <Chip active={origin === 'all'} onClick={() => setOrigin('all')}>{t('originAll')}</Chip>
            <Chip active={origin === 'marketplace'} onClick={() => setOrigin('marketplace')}>{t('originMarketplace')}</Chip>
            <Chip active={origin === 'external'} onClick={() => setOrigin('external')}>{t('originExternal')}</Chip>
            <Chip active={origin === 'builtin'} onClick={() => setOrigin('builtin')}>{t('originBuiltin')}</Chip>
          </div>
          <div className={styles.filters} role="group" aria-label={t('planeAll')}>
            <Chip active={plane === 'all'} onClick={() => setPlane('all')}>{t('planeAll')}</Chip>
            <Chip active={plane === 'global'} onClick={() => setPlane('global')}>{t('planeGlobal')}</Chip>
            <Chip active={plane === 'session'} onClick={() => setPlane('session')}>{t('planeSession')}</Chip>
          </div>
          {state.snapshot.plugins.length === 0 ? <p className={styles.status}>{t('empty')}</p> : null}
          {state.snapshot.plugins.length > 0 && filtered.length === 0 ? (
            <p className={styles.status}>{t('emptySearch')}</p>
          ) : null}
          {groups.length > 0 ? (
            <div className={styles.tree}>
              {groups.map((originGroup) => (
                <section key={originGroup.id} className={styles.origin}>
                  <div className={styles.originHead}>
                    <h3 className={styles.originTitle}>{t(originLabel(originGroup.id))}</h3>
                    <span className={styles.originCount}>{originGroup.count}</span>
                  </div>
                  {originGroup.planes.map((planeGroup) => (
                    <div key={planeGroup.id} className={styles.group}>
                      <h4 className={styles.groupName}>{t(planeLabel(planeGroup.id))}</h4>
                      <ul className={styles.rows}>
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
                      </ul>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function Chip(props: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" className={styles.chip} data-active={props.active ? 'true' : undefined} onClick={props.onClick}>
      {props.children}
    </button>
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
    <li
      className={styles.plugin}
      data-open={open ? 'true' : undefined}
      data-conflict={plugin.nameConflict ? 'true' : undefined}
    >
      <div className={styles.pluginHead}>
        <button
          type="button"
          className={styles.pluginMain}
          aria-expanded={open}
          aria-label={`${open ? t('collapse') : t('expand')}: ${plugin.shortName}`}
          onClick={props.onToggle}
        >
          <IconChevronRightOutline14
            className={open ? `${styles.pluginChevron} ${styles.pluginChevronOpen}` : styles.pluginChevron}
            aria-hidden="true"
          />
          <span className={styles.titleBlock}>
            <span className={styles.name} title={plugin.moduleName}>{plugin.shortName}</span>
            <span className={styles.summary}>{plugin.packageName ?? plugin.moduleName}</span>
          </span>
        </button>
        <div className={styles.pluginMeta}>
          {plugin.enabled ? (
            <span
              className={styles.statusDot}
              data-phase={plugin.fiberPhase ?? 'unobserved'}
              role="img"
              aria-label={status}
              title={status}
            />
          ) : null}
          <span className={styles.tag} data-enabled={plugin.enabled ? 'true' : 'false'}>
            {plugin.enabled ? t('enabledTag') : t('disabledTag')}
          </span>
        </div>
      </div>
      {open ? (
        <div className={styles.pluginBody}>
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
          {notice ? <p className={notice.kind === 'ok' ? styles.notice : styles.error}>{notice.text}</p> : null}
        </div>
      ) : null}
    </li>
  )
}
