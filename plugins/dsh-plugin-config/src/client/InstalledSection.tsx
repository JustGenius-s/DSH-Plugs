import { useEffect, useMemo, useState } from 'react'
import { Button, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  ExpandableRow,
  FailureRow,
  IconButton,
  InlineNotice,
  RowList,
  StatusText,
  Switch,
  Tree,
  TreeGroup,
  TreeIndent,
  TreeSubName,
} from '@just-genius/dsh-plugin-ui'
import type {
  ActionResult,
  InventorySnapshot,
  ManagedPlugin,
  PluginAction,
  PluginOrigin,
} from '../types.ts'
import type { PluginsKey } from './locales.ts'
import styles from './PluginsTab.module.css'

export interface InstalledSectionInjected {
  loadInventory: () => Promise<InventorySnapshot>
  runAction: (action: PluginAction, plugin: ManagedPlugin) => Promise<ActionResult>
}

type Translate = (key: PluginsKey) => string
type OriginFilter = 'all' | PluginOrigin

interface OriginGroup {
  id: PluginOrigin
  label: string
  plugins: ManagedPlugin[]
}

const ORIGIN_ORDER: PluginOrigin[] = ['marketplace', 'external', 'builtin']

function pluginCopy(template: string, plugin: ManagedPlugin): string {
  return template.replaceAll('{plugin}', plugin.shortName)
}

export function InstalledSection(props: InstalledSectionInjected & {
  query: string
  open: boolean
  onToggle: () => void
  refreshKey: number
  t: Translate
}) {
  const { loadInventory, runAction, query, open, onToggle, refreshKey, t } = props
  const [request, setRequest] = useState(0)
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ManagedPlugin | null>(null)
  const [deleteFailure, setDeleteFailure] = useState<string | undefined>(undefined)
  const [notices, setNotices] = useState<Record<string, { kind: 'ok' | 'error'; text: string }>>({})
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error' } | { status: 'ready'; snapshot: InventorySnapshot }
  >({ status: 'loading' })

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
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
  }, [loadInventory, request, refreshKey])

  const matched = useMemo(() => {
    if (state.status !== 'ready') return []
    const needle = query.trim().toLocaleLowerCase()
    if (needle.length === 0) return state.snapshot.plugins
    return state.snapshot.plugins.filter((plugin) => [
      plugin.shortName,
      plugin.moduleName,
      plugin.entryId,
      plugin.packageName ?? '',
      plugin.installSpec ?? '',
    ].some((value) => value.toLocaleLowerCase().includes(needle)))
  }, [query, state])

  const groups = useMemo(() => groupByOrigin(matched, t), [matched, t])

  useEffect(() => {
    if (originFilter === 'all') return
    if (!groups.some((group) => group.id === originFilter)) setOriginFilter('all')
  }, [groups, originFilter])

  useEffect(() => {
    if (expanded === null) return
    if (!matched.some((plugin) => plugin.entryId === expanded)) setExpanded(null)
  }, [expanded, matched])

  useEffect(() => {
    if (deleteTarget === null) return
    if (!matched.some((plugin) => plugin.entryId === deleteTarget.entryId)) {
      setDeleteTarget(null)
      setDeleteFailure(undefined)
    }
  }, [deleteTarget, matched])

  const total = state.status === 'ready' ? state.snapshot.plugins.length : 0
  const searching = query.trim() !== ''
  const sectionOpen = open || searching
  const visibleGroups = originFilter === 'all'
    ? groups
    : groups.filter((group) => group.id === originFilter)
  const visibleCount = visibleGroups.reduce((sum, group) => sum + group.plugins.length, 0)
  const uninstalling = busy?.startsWith('uninstall:') === true

  const onAction = async (action: PluginAction, plugin: ManagedPlugin) => {
    const key = plugin.entryId
    setBusy(`${action}:${key}`)
    try {
      const result = await runAction(action, plugin)
      if (!result.ok) {
        const text = result.detail
          ? `${result.error ?? t('actionFail')}\n${result.detail}`
          : (result.error ?? t('actionFail'))
        if (action === 'uninstall') {
          setDeleteFailure(text)
          return
        }
        setNotices((current) => ({
          ...current,
          [key]: { kind: 'error', text },
        }))
        return
      }
      if (action === 'uninstall') {
        setDeleteTarget(null)
        setDeleteFailure(undefined)
      }
      setNotices((current) => ({
        ...current,
        [key]: {
          kind: 'ok',
          text: result.needsRestart ? t('restartHint') : (result.detail ?? t('restartHint')),
        },
      }))
      setRequest((value) => value + 1)
    } catch (error) {
      const text = String(error)
      if (action === 'uninstall') {
        setDeleteFailure(text)
        return
      }
      setNotices((current) => ({ ...current, [key]: { kind: 'error', text } }))
    } finally {
      setBusy(null)
    }
  }

  const closeDelete = () => {
    if (uninstalling) return
    setDeleteTarget(null)
    setDeleteFailure(undefined)
  }

  const renderPlugin = (plugin: ManagedPlugin) => (
    <PluginRow
      key={plugin.entryId}
      plugin={plugin}
      open={expanded === plugin.entryId}
      busy={busy}
      notice={notices[plugin.entryId]}
      t={t}
      onToggle={() => setExpanded((current) => (
        current === plugin.entryId ? null : plugin.entryId
      ))}
      onDisable={() => void onAction('disable', plugin)}
      onEnable={() => void onAction('enable', plugin)}
      onAskUninstall={() => {
        setDeleteFailure(undefined)
        setDeleteTarget(plugin)
      }}
    />
  )

  return (
    <>
      <Tree>
        <TreeGroup
          title={t('installed')}
          count={state.status === 'ready' ? visibleCount : undefined}
          open={sectionOpen}
          onToggle={onToggle}
          toggleLabel={`${sectionOpen ? t('collapse') : t('expand')}: ${t('installed')}`}
          actions={state.status === 'ready' && groups.length > 1 ? (
            <OriginFilter
              label={`${t('filter')}: ${t('installed')}`}
              allLabel={t('originAll')}
              selected={originFilter}
              groups={groups}
              t={t}
              onSelect={(id) => {
                setOriginFilter(id)
                if (id !== 'all' && !open) onToggle()
              }}
            />
          ) : null}
        >
          {sectionOpen ? (
            <TreeIndent>
              {state.status === 'loading' ? <StatusText>{t('loadingInstalled')}</StatusText> : null}
              {state.status === 'error' ? (
                <FailureRow>
                  <p role="alert">{t('errorInstalled')}</p>
                  <Button size="sm" variant="outline" onClick={() => setRequest((value) => value + 1)}>
                    {t('retry')}
                  </Button>
                </FailureRow>
              ) : null}
              {state.status === 'ready' ? (
                <>
                  {total === 0 ? <StatusText>{t('emptyInstalled')}</StatusText> : null}
                  {total > 0 && groups.length === 0 ? (
                    <StatusText>{t('emptySearchInstalled')}</StatusText>
                  ) : null}
                  {visibleGroups.length > 0 ? (
                    originFilter !== 'all' ? (
                      <RowList>
                        {visibleGroups.flatMap((group) => group.plugins).map(renderPlugin)}
                      </RowList>
                    ) : (
                      visibleGroups.map((group) => (
                        <div key={group.id} className={styles.category}>
                          <TreeSubName>{group.label}</TreeSubName>
                          <RowList>
                            {group.plugins.map(renderPlugin)}
                          </RowList>
                        </div>
                      ))
                    )
                  ) : null}
                </>
              ) : null}
            </TreeIndent>
          ) : null}
        </TreeGroup>
      </Tree>
      <Modal
        open={deleteTarget !== null}
        onClose={closeDelete}
        title={deleteTarget === null ? '' : pluginCopy(t('uninstallTitle'), deleteTarget)}
        closeLabel={t('close')}
        description={deleteTarget === null ? '' : t('uninstallDescription')}
        className={styles.deleteDialog}
        footer={(
          <>
            <Button variant="outline" autoFocus disabled={uninstalling} onClick={closeDelete}>
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              className={styles.deleteConfirm}
              disabled={uninstalling || deleteTarget === null}
              onClick={() => {
                if (deleteTarget === null) return
                void onAction('uninstall', deleteTarget)
              }}
            >
              {deleteTarget === null
                ? ''
                : pluginCopy(uninstalling ? t('uninstalling') : t('uninstallConfirm'), deleteTarget)}
            </Button>
          </>
        )}
      >
        {deleteFailure === undefined ? null : <p className={styles.error}>{deleteFailure}</p>}
      </Modal>
    </>
  )
}

function groupByOrigin(plugins: ManagedPlugin[], t: Translate): OriginGroup[] {
  return ORIGIN_ORDER.flatMap((origin) => {
    const items = plugins.filter((plugin) => plugin.origin === origin)
    if (items.length === 0) return []
    return [{
      id: origin,
      label: t(originLabel(origin)),
      plugins: items,
    }]
  })
}

function originLabel(origin: PluginOrigin): PluginsKey {
  if (origin === 'builtin') return 'originBuiltin'
  if (origin === 'marketplace') return 'originMarketplace'
  return 'originExternal'
}

function IconFilterOutline16() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2.12 2.08h11.76c.55 0 .88.62.56 1.06L9.92 8.52v4.18c0 .25-.13.48-.35.6l-2.62 1.48c-.48.27-1.05-.08-1.05-.6V8.52L1.56 3.14c-.32-.44.01-1.06.56-1.06Zm1.62 1.4 4.02 5.38c.15.2.24.45.24.7v3.92l1.2-.68V9.56c0-.25.09-.5.24-.7l4.02-5.38H3.74Z"
        fill="currentColor"
      />
    </svg>
  )
}

function OriginFilter(props: {
  label: string
  allLabel: string
  selected: OriginFilter
  groups: OriginGroup[]
  t: Translate
  onSelect: (id: OriginFilter) => void
}) {
  const { label, allLabel, selected, groups, t, onSelect } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const items: MenuEntry[] = [
    { id: 'all', label: `${allLabel} ${groups.reduce((sum, item) => sum + item.plugins.length, 0)}` },
    ...groups.map((item) => ({
      id: item.id,
      label: `${item.label} ${item.plugins.length}`,
    })),
  ]
  const active = selected !== 'all'
  return (
    <Menu
      open={menuOpen}
      items={items}
      selectedId={selected}
      onSelect={(id) => {
        onSelect(id as OriginFilter)
        setMenuOpen(false)
      }}
      onClose={() => setMenuOpen(false)}
      align="end"
      side="bottom"
      portal
      compact
      className={styles.iconMenu}
      anchor={(
        <IconButton
          label={label}
          title={active ? (groups.find((item) => item.id === selected)?.label ?? t('filter')) : t('filter')}
          active={active}
          expanded={menuOpen}
          hasPopup
          onClick={() => setMenuOpen((current) => !current)}
        >
          <IconFilterOutline16 />
        </IconButton>
      )}
    />
  )
}

function PluginRow(props: {
  plugin: ManagedPlugin
  open: boolean
  busy: string | null
  notice?: { kind: 'ok' | 'error'; text: string }
  t: Translate
  onToggle: () => void
  onDisable: () => void
  onEnable: () => void
  onAskUninstall: () => void
}) {
  const { plugin, open, busy, notice, t } = props
  const working = busy?.endsWith(`:${plugin.entryId}`) === true
  const canToggle = plugin.canDisable || plugin.canEnable
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
        <div className={styles.rowMeta}>
          {plugin.canUninstall ? (
            <button
              type="button"
              className={styles.dangerButton}
              aria-label={pluginCopy(t('uninstallPlugin'), plugin)}
              disabled={working}
              onClick={props.onAskUninstall}
            >
              {t('uninstall')}
            </button>
          ) : null}
          <Switch
            label={plugin.enabled ? t('disable') : t('enable')}
            checked={plugin.enabled}
            disabled={!canToggle || working}
            onChange={(next) => {
              if (next === plugin.enabled) return
              if (next) props.onEnable()
              else props.onDisable()
            }}
          />
        </div>
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
      {plugin.protectedReason === 'builtin' && !plugin.canUninstall ? (
        <p className={styles.protect}>{t('protectedBuiltin')}</p>
      ) : null}
      {notice ? <InlineNotice kind={notice.kind}>{notice.text}</InlineNotice> : null}
    </ExpandableRow>
  )
}
