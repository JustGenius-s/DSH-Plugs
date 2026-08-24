import { getResult, postResult } from '@just-genius/dsh-plugin-runtime/client'
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
  type SyncStatus,
} from '../shared.ts'
import type { SyncKey } from './locales.ts'

export interface AuthSession {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string | null
  interval: number
}

export interface SyncProgress {
  mode: 'push' | 'pull'
  percent: number
  label: string
  detail: string | null
  done: boolean
}

export interface SyncControllerSnapshot {
  status: SyncStatus | null
  loading: boolean
  busy: boolean
  error: string | null
  auth: AuthSession | null
  conflict: PullResult | null
  progress: SyncProgress | null
}

export class SyncController {
  private snapshot: SyncControllerSnapshot = {
    status: null,
    loading: true,
    busy: false,
    error: null,
    auth: null,
    conflict: null,
    progress: null,
  }
  private readonly listeners = new Set<() => void>()
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private progressTimer: ReturnType<typeof setInterval> | null = null
  private disposed = false

  constructor(private readonly t: (key: SyncKey) => string) {}

  getSnapshot = (): SyncControllerSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async reload(): Promise<void> {
    this.publish({ loading: true, error: null })
    try {
      this.publish({ status: await getResult<SyncStatus>(STATUS_PATH) })
    } catch (error) {
      this.publish({ error: message(error) })
    } finally {
      this.publish({ loading: false })
    }
  }

  async saveClientId(clientId: string): Promise<void> {
    await this.busyRun(async () => {
      this.publish({ status: await postResult(CONFIG_PATH, { clientId: clientId.trim() }) })
    })
  }

  async startLogin(clientId: string): Promise<void> {
    await this.busyRun(async () => {
      this.stopProgress()
      this.publish({ conflict: null })
      if (clientId.trim() !== '' && clientId.trim() !== (this.snapshot.status?.clientId ?? '')) {
        await postResult<SyncStatus>(CONFIG_PATH, { clientId: clientId.trim() })
      }
      const started = await postResult<DeviceStart>(AUTH_START_PATH, {})
      const auth: AuthSession = { ...started }
      this.publish({ auth })
      this.schedulePoll(auth, started.interval)
      window.open(started.verificationUriComplete || started.verificationUri, '_blank', 'noopener,noreferrer')
    })
  }

  cancelAuth(): void {
    if (this.pollTimer !== null) clearTimeout(this.pollTimer)
    this.pollTimer = null
    this.publish({ auth: null })
  }

  async logout(): Promise<void> {
    await this.busyRun(async () => {
      this.cancelAuth()
      this.stopProgress()
      this.publish({ status: await postResult(AUTH_LOGOUT_PATH, {}) })
    })
  }

  async push(): Promise<void> {
    await this.busyRun(async () => {
      this.publish({ conflict: null })
      this.startProgress('push', this.t('progressCollect'))
      this.delayedProgressLabel('push', this.t('progressUpload'), 700)
      try {
        const result = await postResult<PushResult>(PUSH_PATH, {})
        const details = [
          formatTime(result.updatedAt, result.updatedAt),
          fill(this.t('pluginCount'), { count: String(result.pluginCount) }),
        ]
        if (result.pluginsSkipped.length > 0) {
          details.push(`${this.t('pluginsSkipped')}: ${result.pluginsSkipped.map(row => row.name).join(', ')}`)
        }
        this.finishProgress(this.t('pushOk'), details.join(this.t('detailSep')))
        await this.reload()
      } catch (error) {
        this.stopProgress()
        throw error
      }
    })
  }

  async pull(force = false): Promise<void> {
    await this.busyRun(async () => {
      this.startProgress('pull', this.t('progressDownload'))
      this.delayedProgressLabel('pull', this.t('progressApply'), 900)
      try {
        const result = await postResult<PullResult>(PULL_PATH, { force })
        if (result.conflict) {
          this.stopProgress()
          this.publish({ conflict: result })
        } else {
          this.publish({ conflict: null })
          this.finishProgress(this.t('pullOk'), formatPullDetails(result, this.t))
          await this.reload()
        }
      } catch (error) {
        this.stopProgress()
        throw error
      }
    })
  }

  dismissConflict(): void {
    this.publish({ conflict: null })
  }

  dispose(): void {
    this.disposed = true
    this.cancelAuth()
    this.stopProgress()
    this.listeners.clear()
  }

  private async busyRun(operation: () => Promise<void>): Promise<void> {
    if (this.snapshot.busy) return
    this.publish({ busy: true, error: null })
    try {
      await operation()
    } catch (error) {
      this.publish({ error: message(error) })
    } finally {
      this.publish({ busy: false })
    }
  }

  private schedulePoll(auth: AuthSession, intervalSec: number): void {
    if (this.pollTimer !== null) clearTimeout(this.pollTimer)
    this.pollTimer = setTimeout(() => void this.pollOnce(auth, intervalSec), Math.max(1, intervalSec) * 1000)
  }

  private async pollOnce(auth: AuthSession, intervalSec: number): Promise<void> {
    if (this.disposed) return
    try {
      const result = await postResult<DevicePollResult>(AUTH_POLL_PATH, { deviceCode: auth.deviceCode })
      if (result.status === 'pending') return this.schedulePoll(auth, intervalSec)
      if (result.status === 'slow_down') return this.schedulePoll(auth, result.interval || intervalSec + 5)
      if (result.status === 'success') {
        this.cancelAuth()
        await this.reload()
      } else {
        this.cancelAuth()
        this.publish({ error: result.message })
      }
    } catch (error) {
      this.cancelAuth()
      this.publish({ error: message(error) })
    }
  }

  private startProgress(mode: 'push' | 'pull', label: string): void {
    this.stopProgress()
    this.publish({ progress: { mode, percent: 8, label, detail: null, done: false } })
    this.progressTimer = setInterval(() => {
      const current = this.snapshot.progress
      if (current === null || current.done) return
      const cap = mode === 'push' ? 88 : 92
      const step = current.percent < 40 ? 6 : current.percent < 70 ? 3 : 1
      this.publish({ progress: { ...current, percent: Math.min(cap, current.percent + step) } })
    }, 420)
  }

  private delayedProgressLabel(mode: 'push' | 'pull', label: string, delay: number): void {
    window.setTimeout(() => {
      const current = this.snapshot.progress
      if (current !== null && !current.done && current.mode === mode) {
        this.publish({ progress: { ...current, label } })
      }
    }, delay)
  }

  private finishProgress(label: string, detail: string | null): void {
    if (this.progressTimer !== null) clearInterval(this.progressTimer)
    this.progressTimer = null
    this.publish({
      progress: { mode: this.snapshot.progress?.mode ?? 'push', percent: 100, label, detail, done: true },
    })
  }

  private stopProgress(): void {
    if (this.progressTimer !== null) clearInterval(this.progressTimer)
    this.progressTimer = null
    this.publish({ progress: null })
  }

  private publish(patch: Partial<SyncControllerSnapshot>): void {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatTime(value: string, fallback: string): string {
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? fallback : new Date(ms).toLocaleString()
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '')
}

function formatPullDetails(result: PullResult, t: (key: SyncKey) => string): string {
  const parts = [t('pulledSettings')]
  const added = result.pluginsAdded ?? []
  const removed = result.pluginsRemoved ?? []
  const failed = result.pluginsFailed ?? []
  const sep = t('listSep')
  const names = (items: string[]) => items.map(item => item.slice(item.lastIndexOf('/') + 1)).join(sep)
  if (result.pluginsAdded !== undefined || result.pluginsRemoved !== undefined || result.pluginsFailed !== undefined) {
    if (added.length === 0 && removed.length === 0 && failed.length === 0) parts.push(t('pluginsUnchanged'))
    if (added.length > 0) parts.push(fill(t('pluginsAdded'), { names: names(added) }))
    if (removed.length > 0) parts.push(fill(t('pluginsRemoved'), { names: names(removed) }))
    if (failed.length > 0) {
      parts.push(fill(t('pluginsFailed'), {
        names: failed.map(row => `${row.name.slice(row.name.lastIndexOf('/') + 1)} (${row.error})`).join(sep),
      }))
    }
  }
  if (result.needsRestart) parts.push(t('needsRestart'))
  return parts.join(t('detailSep'))
}
