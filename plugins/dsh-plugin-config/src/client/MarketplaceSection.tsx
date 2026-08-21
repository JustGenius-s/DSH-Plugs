import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  IconChevronDownOutline14,
  IconCopyOutline16,
  IconDownloadOutline16,
  IconFolderOpenOutline16,
  Menu,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  CommandRow,
  ExpandableRow,
  FailureRow,
  IconButton,
  InlineNotice,
  RowList,
  StatusText,
  Tag,
  Tree,
  TreeGroup,
  TreeIndent,
  TreeSubName,
} from '@just-genius/dsh-plugin-ui'
import {
  AWESOME_SOURCE,
  type Catalog,
  type CatalogPlugin,
  type InstallMethod,
  type InstallMethodKind,
  type InstallOutcome,
} from '../market/types.ts'
import { isInstalled, methodsOf, type InventoryEntry } from './match.ts'
import type { PluginsKey } from './locales.ts'
import styles from './PluginsTab.module.css'

export interface MarketplaceSectionInjected {
  loadCatalog: () => Promise<Catalog>
  listInstalled: () => Promise<InventoryEntry[]>
  installPlugin: (spec: string) => Promise<InstallOutcome>
  getLocale: () => 'zh' | 'en'
}

type Translate = (key: PluginsKey) => string

interface CategoryGroup {
  id: string
  label: string
  plugins: CatalogPlugin[]
}

interface SourceGroup {
  id: string
  label: string
  href: string | null
  categories: CategoryGroup[]
  count: number
}

function sourceHref(id: string, catalog: Catalog): string | null {
  if (id === AWESOME_SOURCE) return catalog.url || 'https://awesome-dsh-plugin.com/'
  return null
}

function sourceOrder(catalog: Catalog): string[] {
  const ids = Object.keys(catalog.sources)
  const preferred = [AWESOME_SOURCE]
  return [
    ...preferred.filter((id) => ids.includes(id)),
    ...ids.filter((id) => !preferred.includes(id)),
  ]
}

function groupPlugins(
  catalog: Catalog,
  plugins: CatalogPlugin[],
  locale: 'zh' | 'en',
): SourceGroup[] {
  const bySource = new Map<string, CatalogPlugin[]>()
  for (const plugin of plugins) {
    const list = bySource.get(plugin.source) ?? []
    list.push(plugin)
    bySource.set(plugin.source, list)
  }
  const groups: SourceGroup[] = []
  for (const sourceId of sourceOrder(catalog)) {
    const items = bySource.get(sourceId)
    if (items === undefined || items.length === 0) continue
    const byCategory = new Map<string, CatalogPlugin[]>()
    for (const plugin of items) {
      const list = byCategory.get(plugin.category) ?? []
      list.push(plugin)
      byCategory.set(plugin.category, list)
    }
    const categoryIds = [
      ...Object.keys(catalog.categories).filter((id) => byCategory.has(id)),
      ...[...byCategory.keys()].filter((id) => catalog.categories[id] === undefined),
    ]
    const sourceLabel = catalog.sources[sourceId]
    groups.push({
      id: sourceId,
      label: locale === 'zh' ? (sourceLabel?.zh ?? sourceId) : (sourceLabel?.en ?? sourceId),
      href: sourceHref(sourceId, catalog),
      count: items.length,
      categories: categoryIds.map((id) => {
        const labels = catalog.categories[id]
        return {
          id,
          label: locale === 'zh' ? (labels?.zh ?? id) : (labels?.en ?? id),
          plugins: byCategory.get(id) ?? [],
        }
      }),
    })
  }
  return groups
}

function pluginKey(plugin: CatalogPlugin): string {
  return `${plugin.source}:${plugin.owner}/${plugin.name}`
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

function IconRightUpOutline16() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.35 12.75 12.45 3.65"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="square"
      />
      <path
        d="M6.55 2.95h6.6v6.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  )
}

export function MarketplaceSection(props: MarketplaceSectionInjected & {
  query: string
  refreshKey: number
  onInstalled: () => void
  t: Translate
}) {
  const { loadCatalog, listInstalled, installPlugin, getLocale, query, refreshKey, onInstalled, t } = props
  const [request, setRequest] = useState(0)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [entries, setEntries] = useState<InventoryEntry[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [openSources, setOpenSources] = useState<Record<string, boolean>>({})
  const [sourceFilters, setSourceFilters] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [methodByKey, setMethodByKey] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<Record<string, true>>({})
  const [installing, setInstalling] = useState<string | null>(null)
  const [notice, setNotice] = useState<Record<string, { kind: 'ok' | 'error'; text: string }>>({})
  const locale = getLocale()
  const searching = query.trim() !== ''

  useEffect(() => {
    let current = true
    setStatus('loading')
    Promise.all([loadCatalog(), listInstalled().catch(() => [] as InventoryEntry[])])
      .then(([nextCatalog, nextEntries]) => {
        if (!current) return
        setCatalog(nextCatalog)
        setEntries(nextEntries)
        setStatus('ready')
      }, () => {
        if (current) setStatus('error')
      })
    return () => {
      current = false
    }
  }, [loadCatalog, listInstalled, request, refreshKey])

  useEffect(() => {
    if (!catalog) return
    setOpenSources((current) => {
      if (Object.keys(current).length > 0) return current
      const ids = sourceOrder(catalog)
      const next: Record<string, boolean> = {}
      const preferred = ids.includes(AWESOME_SOURCE) ? AWESOME_SOURCE : ids[0]
      for (const id of ids) next[id] = id === preferred
      return next
    })
  }, [catalog])

  const matched = useMemo(() => {
    if (!catalog) return []
    const needle = query.trim().toLocaleLowerCase()
    if (needle === '') return catalog.plugins
    return catalog.plugins.filter((plugin) => {
      const hay = [
        plugin.name,
        plugin.packageName ?? '',
        plugin.owner,
        plugin.description.en,
        plugin.description.zh,
        plugin.install,
        plugin.source,
        ...methodsOf(plugin).flatMap((method) => [method.spec, method.command, method.kind]),
      ].join(' ').toLocaleLowerCase()
      return hay.includes(needle)
    })
  }, [catalog, query])

  const groups = useMemo(
    () => catalog ? groupPlugins(catalog, matched, locale) : [],
    [catalog, matched, locale],
  )

  useEffect(() => {
    setSourceFilters((current) => {
      let changed = false
      const next = { ...current }
      for (const [sourceId, categoryId] of Object.entries(current)) {
        if (categoryId === 'all') continue
        const group = groups.find((item) => item.id === sourceId)
        if (group === undefined || !group.categories.some((item) => item.id === categoryId)) {
          delete next[sourceId]
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [groups])

  useEffect(() => {
    if (expanded === null) return
    if (!matched.some((plugin) => pluginKey(plugin) === expanded)) setExpanded(null)
  }, [expanded, matched])

  const resolveMethod = (plugin: CatalogPlugin): InstallMethod | null => {
    const methods = methodsOf(plugin)
    if (methods.length === 0) return null
    const key = pluginKey(plugin)
    const selected = methodByKey[key]
    return methods.find((method) => method.spec === selected) ?? methods[0] ?? null
  }

  const onInstall = async (plugin: CatalogPlugin, method: InstallMethod) => {
    const spec = method.spec
    if (spec === '') return
    setInstalling(spec)
    setNotice((current) => {
      const next = { ...current }
      delete next[spec]
      return next
    })
    try {
      const result = await installPlugin(spec)
      if (result.ok) {
        setPending((current) => ({ ...current, [spec]: true }))
        setNotice((current) => ({ ...current, [spec]: { kind: 'ok', text: t('installOk') } }))
        onInstalled()
      } else {
        const text = [result.error, result.detail].filter(Boolean).join('\n')
        setNotice((current) => ({
          ...current,
          [spec]: { kind: 'error', text: text || t('installFail') },
        }))
      }
    } catch (error) {
      setNotice((current) => ({ ...current, [spec]: { kind: 'error', text: String(error) } }))
    } finally {
      setInstalling(null)
    }
  }

  const toggleSource = (id: string) => {
    setOpenSources((current) => ({ ...current, [id]: current[id] !== true }))
  }

  const setSourceFilter = (sourceId: string, categoryId: string) => {
    setSourceFilters((current) => {
      if (categoryId === 'all') {
        if (current[sourceId] === undefined) return current
        const next = { ...current }
        delete next[sourceId]
        return next
      }
      return { ...current, [sourceId]: categoryId }
    })
    if (categoryId !== 'all') {
      setOpenSources((current) => ({ ...current, [sourceId]: true }))
    }
  }

  const renderPlugin = (plugin: CatalogPlugin) => {
    const method = resolveMethod(plugin)
    const key = pluginKey(plugin)
    const spec = method?.spec ?? ''
    const installed = isInstalled(plugin, entries)
    const waiting = spec !== '' && pending[spec] === true
    return (
      <PluginRow
        key={key}
        plugin={plugin}
        method={method}
        methods={methodsOf(plugin)}
        locale={locale}
        open={expanded === key}
        installed={installed}
        pending={waiting}
        installing={spec !== '' && installing === spec}
        notice={spec !== '' ? notice[spec] : undefined}
        t={t}
        onToggle={() => setExpanded((current) => current === key ? null : key)}
        onSelectMethod={(next) => {
          setMethodByKey((current) => ({ ...current, [key]: next.spec }))
        }}
        onInstall={() => {
          if (method) void onInstall(plugin, method)
        }}
      />
    )
  }

  return (
    <div className={styles.market}>
      <h3 className={styles.sectionTitle}>{t('marketplace')}</h3>
      {status === 'loading' ? <StatusText>{t('loadingMarket')}</StatusText> : null}
      {status === 'error' ? (
        <FailureRow>
          <p role="alert">{t('errorMarket')}</p>
          <Button size="sm" variant="outline" onClick={() => setRequest((value) => value + 1)}>
            {t('retry')}
          </Button>
        </FailureRow>
      ) : null}
      {status === 'ready' && catalog ? (
        <>
          {catalog.plugins.length === 0 ? <StatusText>{t('emptyMarket')}</StatusText> : null}
          {catalog.plugins.length > 0 && groups.length === 0 ? (
            <StatusText>{t('emptySearchMarket')}</StatusText>
          ) : null}
          {groups.length > 0 ? (
            <Tree>
              {groups.map((group) => {
                const selectedCategory = sourceFilters[group.id] ?? 'all'
                const visibleCategories = selectedCategory === 'all'
                  ? group.categories
                  : group.categories.filter((item) => item.id === selectedCategory)
                const visibleCount = visibleCategories.reduce((sum, item) => sum + item.plugins.length, 0)
                const open = searching || openSources[group.id] === true
                return (
                  <TreeGroup
                    key={group.id}
                    title={group.label}
                    count={visibleCount}
                    open={open}
                    onToggle={() => toggleSource(group.id)}
                    toggleLabel={`${open ? t('collapse') : t('expand')}: ${group.label}`}
                    actions={(
                      <>
                        {group.categories.length > 1 ? (
                          <SourceCategoryFilter
                            label={`${t('filter')}: ${group.label}`}
                            allLabel={t('all')}
                            selected={selectedCategory}
                            categories={group.categories}
                            t={t}
                            onSelect={(id) => setSourceFilter(group.id, id)}
                          />
                        ) : null}
                        {group.href ? (
                          <IconButton
                            label={`${t('openSource')}: ${group.label}`}
                            onClick={() => window.open(group.href!, '_blank', 'noopener,noreferrer')}
                          >
                            <IconRightUpOutline16 />
                          </IconButton>
                        ) : null}
                      </>
                    )}
                  >
                    {open ? (
                      <TreeIndent>
                        {selectedCategory !== 'all' ? (
                          <RowList>
                            {visibleCategories.flatMap((item) => item.plugins).map(renderPlugin)}
                          </RowList>
                        ) : group.categories.map((categoryGroup) => (
                          <div key={categoryGroup.id} className={styles.category}>
                            <TreeSubName>{categoryGroup.label}</TreeSubName>
                            <RowList>
                              {categoryGroup.plugins.map(renderPlugin)}
                            </RowList>
                          </div>
                        ))}
                      </TreeIndent>
                    ) : null}
                  </TreeGroup>
                )
              })}
            </Tree>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function SourceCategoryFilter(props: {
  label: string
  allLabel: string
  selected: string
  categories: CategoryGroup[]
  t: Translate
  onSelect: (id: string) => void
}) {
  const { label, allLabel, selected, categories, t, onSelect } = props
  const [open, setOpen] = useState(false)
  const items: MenuEntry[] = [
    { id: 'all', label: `${allLabel} ${categories.reduce((sum, item) => sum + item.plugins.length, 0)}` },
    ...categories.map((item) => ({
      id: item.id,
      label: `${item.label} ${item.plugins.length}`,
    })),
  ]
  const active = selected !== 'all'
  return (
    <Menu
      open={open}
      items={items}
      selectedId={selected}
      onSelect={(id) => {
        onSelect(id)
        setOpen(false)
      }}
      onClose={() => setOpen(false)}
      align="end"
      side="bottom"
      portal
      compact
      className={styles.iconMenu}
      anchor={(
        <IconButton
          label={label}
          title={active ? (categories.find((item) => item.id === selected)?.label ?? t('filter')) : t('filter')}
          active={active}
          expanded={open}
          hasPopup
          onClick={() => setOpen((current) => !current)}
        >
          <IconFilterOutline16 />
        </IconButton>
      )}
    />
  )
}

function methodLabel(kind: InstallMethodKind, t: Translate): string {
  if (kind === 'npm') return t('methodNpm')
  if (kind === 'github') return t('methodGithub')
  if (kind === 'local') return t('methodLocal')
  return t('methodTarball')
}

function MethodIcon(props: { kind: InstallMethodKind; size?: number }) {
  const size = props.size ?? 14
  if (props.kind === 'npm') {
    // Official npm mark from Simple Icons (simpleicons.org/icons/npm).
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        role="img"
      >
        <path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z" />
      </svg>
    )
  }
  if (props.kind === 'github') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
      </svg>
    )
  }
  if (props.kind === 'local') {
    return <IconFolderOpenOutline16 size={size} aria-hidden="true" />
  }
  return <IconDownloadOutline16 size={size} aria-hidden="true" />
}

function InstallSplitButton(props: {
  methods: InstallMethod[]
  method: InstallMethod
  installing: boolean
  command: string
  t: Translate
  onInstall: () => void
  onSelectMethod: (method: InstallMethod) => void
}) {
  const { methods, method, installing, command, t, onInstall, onSelectMethod } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)
  const multi = methods.length > 1
  const methodTitle = `${t('installMethod')}: ${methodLabel(method.kind, t)}`
  const items: MenuEntry[] = methods.map((item) => ({
    id: item.spec,
    label: methodLabel(item.kind, t),
    icon: <MethodIcon kind={item.kind} />,
  }))

  return (
    // One flex child for row-meta: Menu's root span must not sit beside the
    // button (that adds the meta gap and shifts the right edge).
    <div className={styles.installSplitWrap}>
      <div className={styles.installSplit} title={command}>
        <button
          type="button"
          className={styles.installSplitMain}
          disabled={installing}
          onClick={onInstall}
        >
          {installing ? t('installing') : t('install')}
        </button>
        <button
          ref={moreRef}
          type="button"
          className={styles.installSplitMore}
          data-menu-open={menuOpen ? 'true' : undefined}
          disabled={installing || !multi}
          aria-label={multi ? t('chooseMethod') : methodTitle}
          aria-expanded={multi ? menuOpen : undefined}
          aria-haspopup={multi ? 'menu' : undefined}
          title={methodTitle}
          tabIndex={multi ? undefined : -1}
          onClick={() => {
            if (!multi) return
            setMenuOpen((open) => !open)
          }}
        >
          <span className={styles.installSplitIcon}>
            <span className={styles.installSplitMethodIcon}>
              <MethodIcon kind={method.kind} />
            </span>
            {multi ? (
              <span className={styles.installSplitChevron}>
                <IconChevronDownOutline14 size={12} aria-hidden="true" />
              </span>
            ) : null}
          </span>
        </button>
      </div>
      {multi ? (
        <Menu
          open={menuOpen}
          portal
          dense
          compact
          side="bottom"
          align="end"
          selectedId={method.spec}
          className={styles.installMenuRoot}
          anchor={<span className={styles.installMenuAnchor} aria-hidden="true" />}
          getAnchorRect={() => moreRef.current?.getBoundingClientRect() ?? null}
          items={items}
          onSelect={(id) => {
            const next = methods.find((item) => item.spec === id)
            if (next) onSelectMethod(next)
            setMenuOpen(false)
          }}
          onClose={() => setMenuOpen(false)}
        />
      ) : null}
    </div>
  )
}

function PluginRow(props: {
  plugin: CatalogPlugin
  method: InstallMethod | null
  methods: InstallMethod[]
  locale: 'zh' | 'en'
  open: boolean
  installed: boolean
  pending: boolean
  installing: boolean
  notice?: { kind: 'ok' | 'error'; text: string }
  t: Translate
  onToggle: () => void
  onSelectMethod: (method: InstallMethod) => void
  onInstall: () => void
}) {
  const {
    plugin,
    method,
    methods,
    locale,
    open,
    installed,
    pending,
    installing,
    notice,
    t,
    onToggle,
    onSelectMethod,
    onInstall,
  } = props
  const [copied, setCopied] = useState(false)
  const command = method?.command ?? plugin.install
  const onCopy = useCallback(() => {
    void writeClipboard(command).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1000)
    })
  }, [command])
  const title = plugin.packageName ?? plugin.name
  const description = locale === 'zh' ? plugin.description.zh : plugin.description.en
  const canInstall = method !== null && !installed && !pending
  return (
    <ExpandableRow
      open={open}
      onToggle={onToggle}
      toggleLabel={`${open ? t('collapse') : t('expand')}: ${title}`}
      name={title}
      summary={description || undefined}
      summaryLines={2}
      meta={(
        <>
          {installed ? <Tag variant="text">{t('installedTag')}</Tag> : null}
          {pending && !installed ? <Tag variant="text" tone="business">{t('pendingRestart')}</Tag> : null}
          {canInstall && method ? (
            <InstallSplitButton
              methods={methods}
              method={method}
              installing={installing}
              command={command}
              t={t}
              onInstall={onInstall}
              onSelectMethod={onSelectMethod}
            />
          ) : null}
        </>
      )}
    >
      <InlineNotice>{t('marketRestartHint')}</InlineNotice>
      {method ? (
        <StatusText>
          <span className={styles.methodStatus}>
            <MethodIcon kind={method.kind} />
            <span>{`${t('installMethod')}: ${methodLabel(method.kind, t)}`}</span>
          </span>
        </StatusText>
      ) : null}
      <CommandRow
        label={t('command')}
        command={command}
        action={(
          <Button
            size="sm"
            variant="ghost"
            icon={<IconCopyOutline16 aria-hidden="true" />}
            aria-label={copied ? t('copied') : t('copyCommand')}
            onClick={onCopy}
          />
        )}
      />
      <a className={styles.repo} href={plugin.url} target="_blank" rel="noreferrer">
        {t('repo')}
      </a>
      {notice ? <InlineNotice kind={notice.kind}>{notice.text}</InlineNotice> : null}
    </ExpandableRow>
  )
}
