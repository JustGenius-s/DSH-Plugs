import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  IconCopyOutline16,
  IconSearchOutline16,
  Input,
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
  SettingsSection,
  StatusText,
  Tag,
  Tree,
  TreeGroup,
  TreeIndent,
  TreeSubName,
} from '@just-genius/dsh-plugin-ui'
import type { Catalog, CatalogPlugin } from '../catalog.ts'
import { AWESOME_SOURCE, DSH_PLUGS_SOURCE, DSH_PLUGS_URL } from '../dsh-plugs.ts'
import type { MarketplaceKey } from './locales.ts'
import { isInstalled, specOf, type InventoryEntry } from './match.ts'
import styles from './MarketplaceTab.module.css'

export interface InstallOutcome {
  ok: boolean
  spec?: string
  needsRestart?: boolean
  error?: string
  detail?: string
}

export interface MarketplaceTabInjected {
  loadCatalog: () => Promise<Catalog>
  listInstalled: () => Promise<InventoryEntry[]>
  installPlugin: (spec: string) => Promise<InstallOutcome>
  getLocale: () => 'zh' | 'en'
}

type Translate = (key: MarketplaceKey) => string

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
  if (id === DSH_PLUGS_SOURCE) return DSH_PLUGS_URL
  if (id === AWESOME_SOURCE) return catalog.url || 'https://awesome-dsh-plugin.com/'
  return null
}

function sourceOrder(catalog: Catalog): string[] {
  const ids = Object.keys(catalog.sources)
  const preferred = [DSH_PLUGS_SOURCE, AWESOME_SOURCE]
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

/** Matched 16px pair: same canvas, ~2px inset, ~1.4px filled-outline weight. */
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

export function MarketplaceTab(props: MarketplaceTabInjected & { t: Translate }) {
  const { loadCatalog, listInstalled, installPlugin, getLocale, t } = props
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [entries, setEntries] = useState<InventoryEntry[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [openSources, setOpenSources] = useState<Record<string, boolean>>({})
  const [sourceFilters, setSourceFilters] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
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
  }, [loadCatalog, listInstalled, request])

  useEffect(() => {
    if (!catalog) return
    setOpenSources((current) => {
      if (Object.keys(current).length > 0) return current
      const ids = sourceOrder(catalog)
      const next: Record<string, boolean> = {}
      const preferred = ids.includes(DSH_PLUGS_SOURCE) ? DSH_PLUGS_SOURCE : ids[0]
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

  const onInstall = async (plugin: CatalogPlugin) => {
    const spec = specOf(plugin)
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
      } else {
        const text = [result.error, result.detail].filter(Boolean).join('\n')
        setNotice((current) => ({ ...current, [spec]: { kind: 'error', text: text || t('installFail') } }))
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
    const spec = specOf(plugin)
    const key = pluginKey(plugin)
    const installed = isInstalled(plugin, entries)
    const waiting = spec !== '' && pending[spec] === true
    return (
      <PluginRow
        key={key}
        plugin={plugin}
        locale={locale}
        open={expanded === key}
        installed={installed}
        pending={waiting}
        installing={spec !== '' && installing === spec}
        notice={spec !== '' ? notice[spec] : undefined}
        t={t}
        onToggle={() => setExpanded((current) => current === key ? null : key)}
        onInstall={() => void onInstall(plugin)}
      />
    )
  }

  return (
    <SettingsSection busy={status === 'loading'}>
      {status === 'loading' ? <StatusText>{t('loading')}</StatusText> : null}
      {status === 'error' ? (
        <FailureRow>
          <p role="alert">{t('error')}</p>
          <Button size="sm" variant="outline" onClick={() => setRequest((value) => value + 1)}>
            {t('retry')}
          </Button>
        </FailureRow>
      ) : null}
      {status === 'ready' && catalog ? (
        <div className={styles.catalog}>
          <Input
            type="search"
            icon={<IconSearchOutline16 aria-hidden="true" />}
            value={query}
            placeholder={t('search')}
            aria-label={t('search')}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {catalog.plugins.length === 0 ? <StatusText>{t('empty')}</StatusText> : null}
          {catalog.plugins.length > 0 && groups.length === 0 ? (
            <StatusText>{t('emptySearch')}</StatusText>
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
        </div>
      ) : null}
    </SettingsSection>
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

function PluginRow(props: {
  plugin: CatalogPlugin
  locale: 'zh' | 'en'
  open: boolean
  installed: boolean
  pending: boolean
  installing: boolean
  notice?: { kind: 'ok' | 'error'; text: string }
  t: Translate
  onToggle: () => void
  onInstall: () => void
}) {
  const { plugin, locale, open, installed, pending, installing, notice, t, onToggle, onInstall } = props
  const [copied, setCopied] = useState(false)
  const onCopy = useCallback(() => {
    void writeClipboard(plugin.install).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1000)
    })
  }, [plugin.install])
  const title = plugin.packageName ?? plugin.name
  const description = locale === 'zh' ? plugin.description.zh : plugin.description.en
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
          {installed ? <Tag variant="text">{t('installed')}</Tag> : null}
          {pending && !installed ? <Tag variant="text" tone="business">{t('pending')}</Tag> : null}
          {!installed && !pending ? (
            <Button
              size="sm"
              variant="primary"
              disabled={installing}
              onClick={onInstall}
            >
              {installing ? t('installing') : t('install')}
            </Button>
          ) : null}
        </>
      )}
    >
      <InlineNotice>{t('restartHint')}</InlineNotice>
      <CommandRow
        label={t('command')}
        command={plugin.install}
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
