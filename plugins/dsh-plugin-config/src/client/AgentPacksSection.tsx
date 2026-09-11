import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Field, FieldHead, Input, Modal } from '@just-genius/dsh-plugin-ui'
import {
  ExpandableRow,
  FailureRow,
  InlineNotice,
  RowList,
  StatusText,
  Switch,
  Tag,
  Tree,
  TreeGroup,
  TreeIndent,
  TreeSubName,
} from '@just-genius/dsh-plugin-ui'
import type {
  AgentCatalogEntry,
  AgentConnectionStatus,
  AgentInstalledEntry,
  AgentVariableView,
} from '@just-genius/dsh-agent-plugin'
import type { AgentOpResult } from '../agent/types.ts'
import { PackBrandIcon } from './brand-icons.tsx'
import type { PluginsKey } from './locales.ts'
import styles from './PluginsTab.module.css'

export type { AgentCatalogEntry, AgentInstalledEntry }

export interface AgentPacksSectionInjected {
  loadAgentCatalog: () => Promise<AgentCatalogEntry[]>
  loadAgentInstalled: () => Promise<AgentInstalledEntry[]>
  installAgentPack: (pluginId: string) => Promise<AgentOpResult>
  runAgentAction: (
    action: 'enable' | 'disable' | 'uninstall',
    pluginId: string,
  ) => Promise<AgentOpResult>
  configureAgentPack: (
    pluginId: string,
    variables: Record<string, string | boolean | number>,
  ) => Promise<AgentOpResult>
  setAgentAuth: (payload: {
    pluginId: string
    token?: string
    secrets?: Record<string, string>
    logout?: boolean
  }) => Promise<AgentOpResult>
  startAgentOAuth: (pluginId: string) => Promise<{ ok: boolean; authorizeUrl?: string; error?: string }>
  pollAgentOAuth: (pluginId: string) => Promise<{ ok: boolean; status: 'idle' | 'pending' | 'ok' | 'error'; error?: string }>
  getLocale: () => 'zh' | 'en'
}

type Translate = (key: PluginsKey) => string

export function AgentPacksSection(props: AgentPacksSectionInjected & {
  query: string
  refreshKey: number
  t: Translate
}) {
  const {
    loadAgentCatalog,
    loadAgentInstalled,
    installAgentPack,
    runAgentAction,
    configureAgentPack,
    setAgentAuth,
    startAgentOAuth,
    pollAgentOAuth,
    getLocale,
    query,
    refreshKey,
    t,
  } = props

  const [request, setRequest] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [catalog, setCatalog] = useState<AgentCatalogEntry[]>([])
  const [installed, setInstalled] = useState<AgentInstalledEntry[]>([])
  const [open, setOpen] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notices, setNotices] = useState<Record<string, { kind: 'ok' | 'error'; text: string }>>({})
  const [deleteTarget, setDeleteTarget] = useState<AgentInstalledEntry | null>(null)
  const [authDraft, setAuthDraft] = useState<Record<string, string>>({})
  const [varDraft, setVarDraft] = useState<Record<string, string>>({})
  const [oauthPhase, setOauthPhase] = useState<Record<string, 'idle' | 'opening' | 'waiting'>>({})
  const [oauthLinks, setOauthLinks] = useState<Record<string, string>>({})
  const locale = getLocale()
  const needle = query.trim().toLocaleLowerCase()
  const sectionOpen = open || needle !== ''
  const seen = useRef(false)

  useEffect(() => {
    let current = true
    if (!seen.current) setStatus('loading')
    Promise.all([loadAgentCatalog(), loadAgentInstalled()])
      .then(([nextCatalog, nextInstalled]) => {
        if (!current) return
        seen.current = true
        setCatalog(nextCatalog)
        setInstalled(nextInstalled)
        setStatus('ready')
      }, () => {
        if (current && !seen.current) setStatus('error')
      })
    return () => {
      current = false
    }
  }, [loadAgentCatalog, loadAgentInstalled, request, refreshKey])

  const matchedInstalled = useMemo(
    () => installed.filter((item) => matchesPack(item, needle, locale)),
    [installed, locale, needle],
  )
  const matchedCatalog = useMemo(
    () => catalog.filter((item) => !item.installed && matchesPack(item, needle, locale)),
    [catalog, locale, needle],
  )

  const refresh = () => {
    setRequest((value) => value + 1)
  }

  const flash = (id: string, kind: 'ok' | 'error', text: string) => {
    setNotices((current) => ({ ...current, [id]: { kind, text } }))
  }

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key)
    try {
      await work()
      refresh()
    } finally {
      setBusy(null)
    }
  }

  const uninstalling = busy?.startsWith('uninstall:') === true

  return (
    <>
      <Tree>
        <TreeGroup
          title={t('agentPacks')}
          count={status === 'ready' ? matchedInstalled.length : undefined}
          open={sectionOpen}
          onToggle={() => setOpen((current) => !current)}
          toggleLabel={`${sectionOpen ? t('collapse') : t('expand')}: ${t('agentPacks')}`}
        >
          {sectionOpen ? (
            <TreeIndent>
              {status === 'loading' ? <StatusText>{t('loadingAgentPacks')}</StatusText> : null}
              {status === 'error' ? (
                <FailureRow>
                  <p role="alert">{t('errorAgentPacks')}</p>
                  <Button size="sm" variant="outline" onClick={() => setRequest((value) => value + 1)}>
                    {t('retry')}
                  </Button>
                </FailureRow>
              ) : null}
              {status === 'ready' ? (
                <>
                  {matchedInstalled.length > 0 ? (
                    <div className={styles.category}>
                      <TreeSubName>{t('agentInstalled')}</TreeSubName>
                      <RowList>
                        {matchedInstalled.map((pack) => (
                          <InstalledAgentRow
                            key={pack.name}
                            pack={pack}
                            open={expanded === `installed:${pack.name}`}
                            busy={busy}
                            notice={notices[pack.name]}
                            authDraft={authDraft}
                            varDraft={varDraft}
                            oauthPhase={oauthPhase[pack.name] ?? 'idle'}
                            oauthUrl={oauthLinks[pack.name]}
                            locale={locale}
                            t={t}
                            onToggle={() => setExpanded((current) => (
                              current === `installed:${pack.name}` ? null : `installed:${pack.name}`
                            ))}
                            onAuthDraft={(key, value) => {
                              setAuthDraft((current) => ({ ...current, [key]: value }))
                            }}
                            onVarDraft={(key, value) => {
                              setVarDraft((current) => ({ ...current, [key]: value }))
                            }}
                            onEnable={() => void run(`enable:${pack.name}`, async () => {
                              const result = await runAgentAction('enable', pack.name)
                              flash(pack.name, result.ok ? 'ok' : 'error', result.error ?? t('agentEnabled'))
                            })}
                            onDisable={() => void run(`disable:${pack.name}`, async () => {
                              const result = await runAgentAction('disable', pack.name)
                              flash(pack.name, result.ok ? 'ok' : 'error', result.error ?? t('agentDisabled'))
                            })}
                            onSaveAuth={() => void run(`auth:${pack.name}`, async () => {
                              const result = await setAgentAuth({
                                pluginId: pack.name,
                                secrets: Object.fromEntries(
                                  Object.entries(authDraft)
                                    .filter(([key]) => key.startsWith(`${pack.name}:`))
                                    .map(([key, value]) => [key.slice(pack.name.length + 1), value]),
                                ),
                              })
                              flash(pack.name, result.ok ? 'ok' : 'error', result.error ?? t('agentAuthSaved'))
                            })}
                            onLogout={() => void run(`logout:${pack.name}`, async () => {
                              const result = await setAgentAuth({ pluginId: pack.name, logout: true })
                              setOauthPhase((current) => ({ ...current, [pack.name]: 'idle' }))
                              setOauthLinks((current) => {
                                const next = { ...current }
                                delete next[pack.name]
                                return next
                              })
                              flash(pack.name, result.ok ? 'ok' : 'error', result.error ?? t('agentLoggedOut'))
                            })}
                            onBrowserLogin={() => {
                              void (async () => {
                                setOauthPhase((current) => ({ ...current, [pack.name]: 'opening' }))
                                const started = await startAgentOAuth(pack.name)
                                if (!started.ok || !started.authorizeUrl) {
                                  setOauthPhase((current) => ({ ...current, [pack.name]: 'idle' }))
                                  flash(pack.name, 'error', started.error ?? t('agentOauthFailed'))
                                  return
                                }
                                setOauthLinks((current) => ({ ...current, [pack.name]: started.authorizeUrl! }))
                                window.open(started.authorizeUrl, '_blank', 'noopener,noreferrer')
                                setOauthPhase((current) => ({ ...current, [pack.name]: 'waiting' }))
                                const deadline = Date.now() + 10 * 60 * 1000
                                while (Date.now() < deadline) {
                                  await new Promise((resolve) => setTimeout(resolve, 1500))
                                  const status = await pollAgentOAuth(pack.name)
                                  if (status.status === 'ok') {
                                    setOauthPhase((current) => ({ ...current, [pack.name]: 'idle' }))
                                    flash(pack.name, 'ok', t('agentOauthDone'))
                                    refresh()
                                    return
                                  }
                                  if (status.status === 'error') {
                                    setOauthPhase((current) => ({ ...current, [pack.name]: 'idle' }))
                                    flash(pack.name, 'error', status.error ?? t('agentOauthFailed'))
                                    return
                                  }
                                }
                                setOauthPhase((current) => ({ ...current, [pack.name]: 'idle' }))
                                flash(pack.name, 'error', t('agentOauthFailed'))
                              })()
                            }}
                            onSaveVars={() => void run(`vars:${pack.name}`, async () => {
                              const variables: Record<string, string | boolean | number> = { ...pack.variables }
                              for (const [key, spec] of Object.entries(pack.variableSpecs ?? {})) {
                                if (spec.type === 'boolean') continue
                                const draft = varDraft[`${pack.name}:${key}`]
                                if (draft === undefined) continue
                                if (spec.type === 'number') variables[key] = Number(draft)
                                else variables[key] = draft
                              }
                              const result = await configureAgentPack(pack.name, variables)
                              flash(pack.name, result.ok ? 'ok' : 'error', result.error ?? t('agentConfigured'))
                            })}
                            onToggleVar={(name, value) => void run(`vars:${pack.name}`, async () => {
                              const result = await configureAgentPack(pack.name, { ...pack.variables, [name]: value })
                              flash(pack.name, result.ok ? 'ok' : 'error', result.error ?? t('agentConfigured'))
                            })}
                            onAskUninstall={() => setDeleteTarget(pack)}
                          />
                        ))}
                      </RowList>
                    </div>
                  ) : null}
                  <div className={styles.category}>
                    {matchedCatalog.length === 0 ? (
                      matchedInstalled.length === 0 || needle ? (
                        <StatusText>
                          {needle ? t('emptySearchAgentCatalog') : t('emptyAgentCatalog')}
                        </StatusText>
                      ) : null
                    ) : (
                      <>
                        <TreeSubName>{t('agentCatalog')}</TreeSubName>
                        <RowList>
                        {matchedCatalog.map((pack) => (
                          <CatalogAgentRow
                            key={pack.name}
                            pack={pack}
                            open={expanded === `catalog:${pack.name}`}
                            busy={busy}
                            notice={notices[`catalog:${pack.name}`]}
                            locale={locale}
                            t={t}
                            onToggle={() => setExpanded((current) => (
                              current === `catalog:${pack.name}` ? null : `catalog:${pack.name}`
                            ))}
                            onInstall={() => void run(`install:${pack.name}`, async () => {
                              const result = await installAgentPack(pack.name)
                              if (result.ok) setExpanded(`installed:${pack.name}`)
                              flash(
                                result.ok ? pack.name : `catalog:${pack.name}`,
                                result.ok ? 'ok' : 'error',
                                result.error ?? t('agentInstallOk'),
                              )
                            })}
                          />
                        ))}
                      </RowList>
                      </>
                    )}
                  </div>
                </>
              ) : null}
            </TreeIndent>
          ) : null}
        </TreeGroup>
      </Tree>

      <Modal
        open={deleteTarget !== null}
        onClose={() => {
          if (uninstalling) return
          setDeleteTarget(null)
        }}
        title={deleteTarget ? t('agentUninstallTitle').replace('{plugin}', packLabel(deleteTarget, locale)) : ''}
        closeLabel={t('close')}
        description={t('agentUninstallDescription')}
        className={styles.deleteDialog}
        footer={(
          <>
            <Button variant="outline" autoFocus disabled={uninstalling} onClick={() => setDeleteTarget(null)}>
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              className={styles.deleteConfirm}
              disabled={uninstalling || deleteTarget === null}
              onClick={() => {
                if (deleteTarget === null) return
                void run(`uninstall:${deleteTarget.name}`, async () => {
                  const result = await runAgentAction('uninstall', deleteTarget.name)
                  if (!result.ok) {
                    flash(deleteTarget.name, 'error', result.detail ?? result.error ?? t('actionFail'))
                    return
                  }
                  setDeleteTarget(null)
                  flash(deleteTarget.name, 'ok', t('agentUninstalled'))
                })
              }}
            >
              {t('uninstall')}
            </Button>
          </>
        )}
      />
    </>
  )
}

function matchesPack(pack: AgentCatalogEntry, needle: string, locale: 'zh' | 'en'): boolean {
  if (needle === '') return true
  const hay = [
    pack.name,
    pack.description,
    pack.displayName.en,
    pack.displayName.zh,
    pack.auth,
    ...pack.keywords,
    packLabel(pack, locale),
  ].join(' ').toLocaleLowerCase()
  return hay.includes(needle)
}

function packLabel(pack: AgentCatalogEntry, locale: 'zh' | 'en'): string {
  return locale === 'zh' ? pack.displayName.zh : pack.displayName.en
}

function packTitle(pack: AgentCatalogEntry, locale: 'zh' | 'en') {
  return (
    <span className={styles.packName}>
      <PackBrandIcon id={pack.name} />
      <span className={styles.packNameText}>{packLabel(pack, locale)}</span>
    </span>
  )
}

function variableLabel(spec: AgentVariableView, locale: 'zh' | 'en'): string {
  return locale === 'zh' ? spec.label.zh : spec.label.en
}

function connectionLabel(status: AgentConnectionStatus | null, t: Translate): string {
  if (status === 'connected') return t('agentConnected')
  if (status === 'needs_auth') return t('agentNeedsAuth')
  if (status === 'error') return t('agentConnectionError')
  return t('agentNotConnected')
}

function InstalledAgentRow(props: {
  pack: AgentInstalledEntry
  open: boolean
  busy: string | null
  notice?: { kind: 'ok' | 'error'; text: string }
  authDraft: Record<string, string>
  varDraft: Record<string, string>
  locale: 'zh' | 'en'
  t: Translate
  onToggle: () => void
  onAuthDraft: (key: string, value: string) => void
  onVarDraft: (key: string, value: string) => void
  onEnable: () => void
  onDisable: () => void
  oauthPhase: 'idle' | 'opening' | 'waiting'
  oauthUrl?: string
  onSaveAuth: () => void
  onLogout: () => void
  onBrowserLogin: () => void
  onSaveVars: () => void
  onToggleVar: (name: string, value: boolean) => void
  onAskUninstall: () => void
}) {
  const { pack, open, busy, notice, authDraft, varDraft, locale, t, oauthPhase, oauthUrl } = props
  const working = busy?.endsWith(`:${pack.name}`) === true
  const oauthBusy = oauthPhase !== 'idle'
  const specs = Object.entries(pack.variableSpecs ?? {})
  const booleanVars = specs.filter(([, spec]) => spec.type === 'boolean')
  const textVars = specs.filter(([, spec]) => spec.type !== 'boolean')
  const secrets = pack.auth === 'headers' ? pack.headerSecrets ?? [] : []
  return (
    <ExpandableRow
      open={open}
      onToggle={props.onToggle}
      toggleLabel={`${open ? t('collapse') : t('expand')}: ${packLabel(pack, locale)}`}
      name={packTitle(pack, locale)}
      meta={(
        <div className={styles.rowMeta}>
          {pack.hasAuth ? (
            <Button size="sm" variant="ghost" disabled={working} onClick={props.onLogout}>
              {t('agentLogout')}
            </Button>
          ) : null}
          <button
            type="button"
            className={styles.dangerButton}
            disabled={working}
            onClick={props.onAskUninstall}
          >
            {t('uninstall')}
          </button>
          {pack.auth === 'oauth' && !pack.hasAuth ? (
            <Button size="sm" variant="primary" disabled={working || oauthBusy} onClick={props.onBrowserLogin}>
              {oauthPhase === 'opening' ? t('agentOauthOpening') : t('agentOauthLogin')}
            </Button>
          ) : null}
          <Switch
            label={pack.enabled ? t('disable') : t('enable')}
            checked={pack.enabled}
            disabled={working}
            onChange={(next) => {
              if (next === pack.enabled) return
              if (next) props.onEnable()
              else props.onDisable()
            }}
          />
        </div>
      )}
    >
      <dl className={styles.details}>
        <dt>{t('agentStatus')}</dt>
        <dd>{connectionLabel(pack.connectionStatus, t)}</dd>
        <dt>{t('agentAuth')}</dt>
        <dd>{pack.hasAuth ? t('agentAuthReady') : t('agentAuthMissing')}</dd>
        {pack.toolCount !== undefined ? (
          <>
            <dt>{t('agentTools')}</dt>
            <dd>{pack.toolCount}</dd>
          </>
        ) : null}
        {pack.connectionError ? (
          <>
            <dt>{t('agentError')}</dt>
            <dd>{pack.connectionError}</dd>
          </>
        ) : null}
        {booleanVars.map(([key, spec]) => (
          <Fragment key={key}>
            <dt>{variableLabel(spec, locale)}</dt>
            <dd>
              <Switch
                label={variableLabel(spec, locale)}
                checked={pack.variables[key] !== false}
                disabled={working}
                onChange={(next) => props.onToggleVar(key, next)}
              />
            </dd>
          </Fragment>
        ))}
      </dl>

      {pack.auth === 'oauth' && oauthPhase === 'waiting' ? (
        <div className={styles.agentForm}>
          <StatusText>{t('agentOauthWaiting')}</StatusText>
          {oauthUrl ? (
            <StatusText>
              <a href={oauthUrl} target="_blank" rel="noreferrer">{t('agentOauthOpenLink')}</a>
            </StatusText>
          ) : null}
        </div>
      ) : null}
      {secrets.length > 0 || textVars.length > 0 ? (
        <div className={styles.agentForm}>
          {secrets.map((secret) => (
            <Field key={secret}>
              <FieldHead htmlFor={`${pack.name}:${secret}`} label={secret} />
              <Input
                id={`${pack.name}:${secret}`}
                type="password"
                autoComplete="off"
                value={authDraft[`${pack.name}:${secret}`] ?? ''}
                onChange={(event) => props.onAuthDraft(`${pack.name}:${secret}`, event.currentTarget.value)}
              />
            </Field>
          ))}
          {secrets.length > 0 ? (
            <div className={styles.agentFormActions}>
              <Button size="sm" disabled={working} onClick={props.onSaveAuth}>{t('agentSaveAuth')}</Button>
            </div>
          ) : null}
          {textVars.map(([key, spec]) => (
            <Field key={key}>
              <FieldHead htmlFor={`${pack.name}:${key}`} label={variableLabel(spec, locale)} />
              <Input
                id={`${pack.name}:${key}`}
                value={varDraft[`${pack.name}:${key}`] ?? String(pack.variables[key] ?? '')}
                onChange={(event) => props.onVarDraft(`${pack.name}:${key}`, event.currentTarget.value)}
              />
            </Field>
          ))}
          {textVars.length > 0 ? (
            <div className={styles.agentFormActions}>
              <Button size="sm" disabled={working} onClick={props.onSaveVars}>{t('agentSaveVars')}</Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {notice ? <InlineNotice kind={notice.kind}>{notice.text}</InlineNotice> : null}
    </ExpandableRow>
  )
}

function CatalogAgentRow(props: {
  pack: AgentCatalogEntry
  open: boolean
  busy: string | null
  notice?: { kind: 'ok' | 'error'; text: string }
  locale: 'zh' | 'en'
  t: Translate
  onToggle: () => void
  onInstall: () => void
}) {
  const { pack, open, busy, notice, locale, t } = props
  const working = busy === `install:${pack.name}`
  return (
    <ExpandableRow
      open={open}
      onToggle={props.onToggle}
      toggleLabel={`${open ? t('collapse') : t('expand')}: ${packLabel(pack, locale)}`}
      name={packTitle(pack, locale)}
      meta={(
        <>
          {pack.comingSoon ? <Tag variant="text">{t('agentComingSoon')}</Tag> : (
            <Button size="sm" variant="primary" disabled={working} onClick={props.onInstall}>
              {working ? t('installing') : t('install')}
            </Button>
          )}
        </>
      )}
    >
      <StatusText>{`${t('agentAuth')}: ${pack.auth}`}</StatusText>
      {notice ? <InlineNotice kind={notice.kind}>{notice.text}</InlineNotice> : null}
    </ExpandableRow>
  )
}
