import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import {
  AUTH_LOGOUT_PATH,
  AUTH_POLL_PATH,
  AUTH_START_PATH,
  CONFIG_PATH,
  PULL_PATH,
  PUSH_PATH,
  STATUS_PATH,
  type DevicePollResult,
  type DeviceStart,
  type PullResult,
  type PushResult,
  type SyncHttpResult,
  type SyncStatus,
} from '../shared.ts'
import type { SyncKey } from './locales.ts'
import styles from './SyncSection.module.css'

export interface SyncSectionInjected {
  t: (key: SyncKey) => string
}

export type SyncSectionProps = Partial<InjectFace<SyncSectionInjected>>

interface AuthSession {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string | null
  interval: number
}

interface SyncProgress {
  mode: 'push' | 'pull'
  percent: number
  label: string
  detail: string | null
  done: boolean
}

function FieldRow(props: { label: string; children: ReactNode }) {
  return (
    <div className={styles.fieldRow}>
      <span className={styles.fieldLabel}>{props.label}</span>
      {props.children}
    </div>
  )
}

function Group(props: { title: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      <h3 className={styles.groupTitle}>{props.title}</h3>
      {props.children}
    </section>
  )
}

export function SyncSection({ t }: SyncSectionProps) {
  const translate = t ?? ((key: SyncKey) => key)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [draftClientId, setDraftClientId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [auth, setAuth] = useState<AuthSession | null>(null)
  const [copied, setCopied] = useState(false)
  const [conflict, setConflict] = useState<PullResult | null>(null)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const cancelled = useRef(false)

  const stopProgressTicker = () => {
    if (progressTimer.current !== null) {
      clearInterval(progressTimer.current)
      progressTimer.current = null
    }
  }

  const startProgress = (mode: 'push' | 'pull', label: string) => {
    stopProgressTicker()
    setProgress({
      mode,
      percent: 8,
      label,
      detail: null,
      done: false,
    })
    progressTimer.current = setInterval(() => {
      setProgress((prev) => {
        if (prev === null || prev.done) return prev
        const cap = mode === 'push' ? 88 : 92
        if (prev.percent >= cap) return prev
        const step = prev.percent < 40 ? 6 : prev.percent < 70 ? 3 : 1
        return { ...prev, percent: Math.min(cap, prev.percent + step) }
      })
    }, 420)
  }

  const finishProgress = (label: string, detail: string | null) => {
    stopProgressTicker()
    setProgress((prev) => ({
      mode: prev?.mode ?? 'push',
      percent: 100,
      label,
      detail,
      done: true,
    }))
  }

  const clearProgress = () => {
    stopProgressTicker()
    setProgress(null)
  }

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await getJson<SyncStatus>(STATUS_PATH)
      setStatus(next)
      setDraftClientId(next.clientId)
    } catch (err) {
      setError(err instanceof Error ? err.message : translate('loading'))
    } finally {
      setLoading(false)
    }
  }, [translate])

  useEffect(() => {
    cancelled.current = false
    void reload()
    return () => {
      cancelled.current = true
      if (pollTimer.current !== null) clearTimeout(pollTimer.current)
      stopProgressTicker()
    }
  }, [reload])

  const stopPolling = () => {
    if (pollTimer.current !== null) {
      clearTimeout(pollTimer.current)
      pollTimer.current = null
    }
    setAuth(null)
  }

  const saveClientId = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const next = await postJson<SyncStatus>(CONFIG_PATH, { clientId: draftClientId.trim() })
      setStatus(next)
      setDraftClientId(next.clientId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const schedulePoll = (session: AuthSession, intervalSec: number) => {
    if (pollTimer.current !== null) clearTimeout(pollTimer.current)
    pollTimer.current = setTimeout(() => {
      void pollOnce(session, intervalSec)
    }, Math.max(1, intervalSec) * 1000)
  }

  const pollOnce = async (session: AuthSession, intervalSec: number) => {
    if (cancelled.current) return
    try {
      const result = await postJson<DevicePollResult>(AUTH_POLL_PATH, {
        deviceCode: session.deviceCode,
      })
      if (result.status === 'pending') {
        schedulePoll(session, intervalSec)
        return
      }
      if (result.status === 'slow_down') {
        schedulePoll(session, result.interval || intervalSec + 5)
        return
      }
      if (result.status === 'success') {
        stopPolling()
        await reload()
        return
      }
      stopPolling()
      setError(result.message)
    } catch (err) {
      stopPolling()
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const startLogin = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    setConflict(null)
    clearProgress()
    try {
      if (draftClientId.trim() !== '' && draftClientId.trim() !== (status?.clientId ?? '')) {
        await postJson<SyncStatus>(CONFIG_PATH, { clientId: draftClientId.trim() })
      }
      const started = await postJson<DeviceStart>(AUTH_START_PATH, {})
      const session: AuthSession = {
        deviceCode: started.deviceCode,
        userCode: started.userCode,
        verificationUri: started.verificationUri,
        verificationUriComplete: started.verificationUriComplete,
        interval: started.interval,
      }
      setAuth(session)
      schedulePoll(session, started.interval)
      const openUrl = started.verificationUriComplete || started.verificationUri
      window.open(openUrl, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    stopPolling()
    clearProgress()
    try {
      const next = await postJson<SyncStatus>(AUTH_LOGOUT_PATH, {})
      setStatus(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const push = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    setConflict(null)
    startProgress('push', translate('progressCollect'))
    window.setTimeout(() => {
      setProgress((prev) => {
        if (prev === null || prev.done || prev.mode !== 'push') return prev
        return { ...prev, label: translate('progressUpload') }
      })
    }, 700)
    try {
      const result = await postJson<PushResult>(PUSH_PATH, {})
      const details = [
        formatTime(result.updatedAt, result.updatedAt),
        fill(translate('pluginCount'), { count: String(result.pluginCount) }),
      ]
      if (result.pluginsSkipped.length > 0) {
        details.push(
          `${translate('pluginsSkipped')}: ${result.pluginsSkipped.map((row) => row.name).join(', ')}`,
        )
      }
      finishProgress(translate('pushOk'), details.join(translate('detailSep')))
      await reload()
    } catch (err) {
      clearProgress()
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const pull = async (force = false) => {
    if (busy) return
    setBusy(true)
    setError(null)
    startProgress('pull', translate('progressDownload'))
    window.setTimeout(() => {
      setProgress((prev) => {
        if (prev === null || prev.done || prev.mode !== 'pull') return prev
        return { ...prev, label: translate('progressApply') }
      })
    }, 900)
    try {
      const result = await postJson<PullResult>(PULL_PATH, { force })
      if (result.conflict) {
        clearProgress()
        setConflict(result)
      } else {
        setConflict(null)
        finishProgress(translate('pullOk'), formatPullDetails(result, translate))
        await reload()
      }
    } catch (err) {
      clearProgress()
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const copyCode = async () => {
    if (auth === null) return
    try {
      await navigator.clipboard.writeText(auth.userCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      setError('clipboard unavailable')
    }
  }

  const loggedIn = status?.loggedIn === true
  const clientIdDirty = draftClientId.trim() !== (status?.clientId ?? '')

  return (
    <div className={styles.page} aria-busy={loading || busy || undefined}>
      <h2 className={styles.title}>{translate('title')}</h2>
      <p className={styles.description}>{translate('hint')}</p>
      {loading ? <p className={styles.muted}>{translate('loading')}</p> : null}
      {error !== null ? <p className={styles.error} role="alert">{error}</p> : null}

      <Group title={translate('groupAccount')}>
        <FieldRow label={translate('clientId')}>
          <div className={styles.inline}>
            <Input
              aria-label={translate('clientId')}
              placeholder={translate('clientIdPlaceholder')}
              value={draftClientId}
              disabled={busy}
              onChange={(event) => setDraftClientId(event.currentTarget.value)}
              style={{ width: 220 }}
            />
            <Button
              type="button"
              size="sm"
              variant="toolbar"
              disabled={busy || draftClientId.trim() === '' || !clientIdDirty}
              onClick={() => void saveClientId()}
            >
              {translate('saveClientId')}
            </Button>
          </div>
        </FieldRow>
        <p className={styles.hint}>{translate('clientIdHint')}</p>

        <div className={styles.fieldRow}>
          {loggedIn ? (
            <div className={styles.account}>
              {status?.avatarUrl ? (
                <img
                  className={styles.avatar}
                  src={status.avatarUrl}
                  alt=""
                  width={28}
                  height={28}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className={styles.avatarFallback} aria-hidden="true">
                  {(status?.login ?? '?').slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className={styles.accountMeta}>
                <span className={styles.accountName}>@{status?.login ?? ''}</span>
                <span className={styles.accountCaption}>{translate('loggedInAs')}</span>
              </span>
            </div>
          ) : (
            <span className={styles.fieldLabel}>{translate('notLoggedIn')}</span>
          )}
          {auth !== null ? (
            <div className={styles.inline}>
              <Button type="button" size="sm" variant="toolbar" onClick={() => void copyCode()}>
                {copied ? translate('copied') : translate('copyCode')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="primary"
                onClick={() => {
                  const url = auth.verificationUriComplete || auth.verificationUri
                  window.open(url, '_blank', 'noopener,noreferrer')
                }}
              >
                {translate('openGithub')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="toolbar"
                onClick={() => {
                  stopPolling()
                }}
              >
                {translate('cancelAuth')}
              </Button>
            </div>
          ) : loggedIn ? (
            <Button type="button" size="sm" variant="toolbar" disabled={busy} onClick={() => void logout()}>
              {translate('logout')}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={busy || draftClientId.trim() === ''}
              onClick={() => void startLogin()}
            >
              {translate('login')}
            </Button>
          )}
        </div>

        {auth !== null ? (
          <div className={styles.deviceBlock}>
            <div className={styles.fieldLabel}>{translate('deviceCode')}</div>
            <div className={styles.deviceCode}>{auth.userCode}</div>
            <p className={styles.muted}>{translate('waitingAuth')}</p>
          </div>
        ) : null}
      </Group>

      <Group title={translate('groupSync')}>
        <FieldRow label={translate('push')}>
          <div className={styles.inline}>
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={busy || !loggedIn || auth !== null}
              onClick={() => void push()}
            >
              {translate('push')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="toolbar"
              disabled={busy || !loggedIn || auth !== null}
              onClick={() => void pull(false)}
            >
              {translate('pull')}
            </Button>
          </div>
        </FieldRow>

        {progress !== null ? (
          <div
            className={styles.progressBlock}
            role="status"
            aria-live="polite"
            aria-busy={!progress.done || undefined}
          >
            <div className={styles.progressMeta}>
              <span className={styles.progressLabel}>{progress.label}</span>
              <span className={styles.progressPct}>{Math.round(progress.percent)}%</span>
            </div>
            <div className={styles.progressTrack}>
              <div
                className={`${styles.progressFill}${progress.done ? ` ${styles.progressFillDone}` : ''}`}
                style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }}
              />
            </div>
            {progress.detail !== null ? (
              <p className={styles.progressDetail}>{progress.detail}</p>
            ) : null}
          </div>
        ) : null}

        {conflict !== null ? (
          <div className={styles.conflict}>
            <div className={styles.conflictTitle}>{translate('conflictTitle')}</div>
            <p className={styles.hint}>{translate('conflictBody')}</p>
            <div className={styles.inline}>
              <Button type="button" size="sm" variant="toolbar" disabled={busy} onClick={() => setConflict(null)}>
                {translate('cancelAuth')}
              </Button>
              <Button type="button" size="sm" variant="primary" disabled={busy} onClick={() => void pull(true)}>
                {translate('forcePull')}
              </Button>
            </div>
          </div>
        ) : null}
      </Group>

      <Group title={translate('groupStatus')}>
        <FieldRow label={translate('gist')}>
          {status?.gistUrl ? (
            <a className={styles.link} href={status.gistUrl} target="_blank" rel="noreferrer">
              {status.gistId}
            </a>
          ) : (
            <span className={styles.muted}>{translate('none')}</span>
          )}
        </FieldRow>
        <FieldRow label={translate('lastSynced')}>
          <span className={styles.muted}>{formatTime(status?.lastSyncedAt, translate('none'))}</span>
        </FieldRow>
        <FieldRow label={translate('localUpdated')}>
          <span className={styles.muted}>{formatTime(status?.localUpdatedAt, translate('none'))}</span>
        </FieldRow>
        <FieldRow label={translate('plugins')}>
          <span className={styles.muted}>
            {status === null ? translate('none') : String(status.pluginCount)}
          </span>
        </FieldRow>
      </Group>
    </div>
  )
}

function formatTime(value: string | null | undefined, fallback: string): string {
  if (value === null || value === undefined || value === '') return fallback
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return value
  return new Date(ms).toLocaleString()
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '')
}

function shortPluginName(name: string): string {
  const slash = name.lastIndexOf('/')
  return slash >= 0 ? name.slice(slash + 1) : name
}

function joinNames(names: string[], sep: string): string {
  return names.map(shortPluginName).join(sep)
}

function formatPullDetails(
  result: PullResult,
  translate: (key: SyncKey) => string,
): string {
  const parts = [translate('pulledSettings')]
  const added = result.pluginsAdded ?? []
  const removed = result.pluginsRemoved ?? []
  const failed = result.pluginsFailed ?? []
  const hasPluginReport = result.pluginsAdded !== undefined
    || result.pluginsRemoved !== undefined
    || result.pluginsFailed !== undefined
  const listSep = translate('listSep')

  if (hasPluginReport) {
    if (added.length === 0 && removed.length === 0 && failed.length === 0) {
      parts.push(translate('pluginsUnchanged'))
    } else {
      if (added.length > 0) {
        parts.push(fill(translate('pluginsAdded'), { names: joinNames(added, listSep) }))
      }
      if (removed.length > 0) {
        parts.push(fill(translate('pluginsRemoved'), { names: joinNames(removed, listSep) }))
      }
      if (failed.length > 0) {
        const names = failed
          .map((row) => `${shortPluginName(row.name)} (${row.error})`)
          .join(listSep)
        parts.push(fill(translate('pluginsFailed'), { names }))
      }
    }
  }

  if (result.needsRestart === true) parts.push(translate('needsRestart'))
  return parts.join(translate('detailSep'))
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  const value = await response.json() as SyncHttpResult<T>
  if (!value.ok) throw new Error(value.message)
  return value.value
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const value = await response.json() as SyncHttpResult<T>
  if (!value.ok) throw new Error(value.message)
  return value.value
}
