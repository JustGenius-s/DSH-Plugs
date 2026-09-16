import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, MarkdownText } from '@just-genius/dsh-plugin-ui'
import type { PropsLocale, PropsRuntime } from '@just-genius/dsh-plugin-runtime/client'
import type { DebugKey } from './locales.ts'
import { useDebugState } from './useDebugState.ts'
import { debugDockOpen, debugLogCardOpen } from '../view.ts'
import type { DebugHypothesis } from '../hypotheses.ts'
import type { DebugLogEntry, DebugReproAction } from '../shared.ts'
import type { DebugRunSummary } from '../types.ts'
import styles from './DebugDock.module.css'

export interface DebugDockInjected {
  sessionId: string
  resolveRepro: (action: DebugReproAction, notes: string) => Promise<string | null>
  clearLogs: () => Promise<string | null>
}

export type DebugDockProps = PropsRuntime<'conversation.input.dock'>
  & DebugDockInjected
  & PropsLocale<'debug'>

export function DebugDock({ sessionId, useInput, inputActions, resolveRepro, clearLogs, t }: DebugDockProps) {
  const debug = useDebugState(sessionId)
  const facts = {
    active: debug.active,
    logCount: debug.logs.length,
    runCount: debug.runs.length,
    hypothesisCount: debug.hypotheses.length,
    waiting: debug.wait !== null,
  }
  const on = debugDockOpen(facts)
  const showLogs = debugLogCardOpen(facts)
  if (!on) return null

  return (
    <div className={styles.dock}>
      {showLogs && (
      <LogCard
        logs={debug.logs}
        runId={debug.runId}
        runs={debug.runs}
        hypotheses={debug.hypotheses}
        clearLogs={clearLogs}
        t={t}
      />
      )}
      {debug.wait !== null && (
        <ReproCard
          waitId={debug.wait.id}
          steps={debug.wait.steps}
          useInput={useInput}
          inputActions={inputActions}
          resolveRepro={resolveRepro}
          t={t}
        />
      )}
    </div>
  )
}

function LogCard({
  logs,
  runId,
  runs,
  hypotheses,
  clearLogs,
  t,
}: {
  logs: readonly DebugLogEntry[]
  runId: string | null
  runs: readonly DebugRunSummary[]
  hypotheses: readonly DebugHypothesis[]
  clearLogs: () => Promise<string | null>
  t: (key: DebugKey) => string
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const node = scroller.current
    if (node === null) return
    node.scrollTop = node.scrollHeight
  }, [logs.length])

  const clear = () => {
    if (busy || logs.length === 0) return
    setBusy(true)
    setError(null)
    clearLogs().then((failure) => {
      setBusy(false)
      if (failure !== null) setError(failure)
    }, (reason) => {
      setBusy(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <section className={styles.card} aria-label={t('logs.title')}>
      <header className={styles.logHeader}>
        <span className={styles.logGlyph} aria-hidden>
          <LogGlyph />
        </span>
        {t('logs.title')}
        {runId !== null && <span className={styles.runChip}>{runId}</span>}
        {runs.length > 0 && (
          <span className={styles.archived}>
            {runs.map(run => `${run.id} · ${run.logCount}`).join(' · ')}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className={styles.clear}
          disabled={busy || logs.length === 0}
          aria-label={t('logs.clear.aria')}
          title={t('logs.clear.aria')}
          onClick={clear}
        >
          {t('logs.clear')}
        </Button>
      </header>
      {hypotheses.length > 0 && (
        <div className={styles.hypotheses}>
          {hypotheses.map((item) => (
            <span key={item.id} className={styles.hypothesisChip + ' ' + styles[hypothesisClass(item.status)]}>
              {item.id}
              <span className={styles.hypothesisStatus}>{t(hypothesisKey(item.status))}</span>
            </span>
          ))}
        </div>
      )}
      <div className={styles.logBody} ref={scroller}>
        {logs.length === 0 ? (
          <div className={styles.empty}>{t('logs.empty')}</div>
        ) : logs.map((entry) => (
          <div key={entry.id} className={styles.line}>
            <span className={styles.lineTime}>
              <CalendarGlyph className={styles.lineIcon} />
              {formatTime(entry.at)}
            </span>
            <span className={styles.lineSource + ' ' + styles[sourceClass(entry.source)]}>
              {t(sourceKey(entry.source))}
            </span>
            {entry.hypothesisId !== undefined && (
              <span className={styles.lineHypothesis}>{entry.hypothesisId}</span>
            )}
            {entry.location !== undefined && (
              <span className={styles.lineLocation}>{entry.location}</span>
            )}
            {entry.count !== undefined && entry.count > 1 && (
              <span className={styles.lineCount}>×{entry.count}</span>
            )}
            <span className={styles.lineText}>{entry.text}</span>
          </div>
        ))}
      </div>
      {error !== null && <div className={styles.feedback} role="status">{error || t('logs.clear.failed')}</div>}
    </section>
  )
}

function ReproCard({
  waitId,
  steps,
  useInput,
  inputActions,
  resolveRepro,
  t,
}: {
  waitId: string
  steps: string
  useInput: DebugDockProps['useInput']
  inputActions: DebugDockProps['inputActions']
  resolveRepro: (action: DebugReproAction, notes: string) => Promise<string | null>
  t: (key: DebugKey) => string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const body = useMemo(() => stripLeadingHeading(steps), [steps])
  const draft = useInput((input) => input.draft)

  useEffect(() => {
    setBusy(false)
    setError(null)
  }, [waitId])

  const send = (action: DebugReproAction) => {
    if (busy) return
    const notes = draft.trim()
    setBusy(true)
    setError(null)
    resolveRepro(action, notes).then((failure) => {
      if (failure === null) {
        if (notes !== '') inputActions.setDraft('')
        return
      }
      setBusy(false)
      setError(failure)
    }, (reason) => {
      setBusy(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <section className={styles.repro} aria-label={t('repro.title')}>
      <header className={styles.reproHeader}>
        <span className={styles.flag} aria-hidden>
          <FlagGlyph />
        </span>
        {t('repro.title')}
      </header>
      <div className={styles.reproBody}>
        <MarkdownText text={body} />
      </div>
      <div className={styles.reproFooter}>
        <div className={styles.reproActions}>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => send('fixed')}>
            {t('repro.fixed')}
          </Button>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => send('proceed')}>
            {t('repro.proceed')}
            <kbd className={styles.kbd}>⏎</kbd>
          </Button>
        </div>
      </div>
      {error !== null && <div className={styles.feedback} role="status">{error}</div>}
    </section>
  )
}

function hypothesisKey(status: DebugHypothesis['status']): DebugKey {
  if (status === 'confirmed') return 'hypothesis.confirmed'
  if (status === 'rejected') return 'hypothesis.rejected'
  if (status === 'inconclusive') return 'hypothesis.inconclusive'
  return 'hypothesis.open'
}

function hypothesisClass(status: DebugHypothesis['status']): string {
  if (status === 'confirmed') return 'hypothesisConfirmed'
  if (status === 'rejected') return 'hypothesisRejected'
  if (status === 'inconclusive') return 'hypothesisInconclusive'
  return 'hypothesisOpen'
}

function sourceKey(source: DebugLogEntry['source']): DebugKey {
  if (source === 'agent') return 'source.agent'
  if (source === 'ingest') return 'source.ingest'
  return 'source.user'
}

/** Chip colour per source (logcat-style colour coding). */
function sourceClass(source: DebugLogEntry['source']): string {
  if (source === 'agent') return 'sourceAgent'
  if (source === 'ingest') return 'sourceIngest'
  return 'sourceUser'
}

function formatTime(at: number): string {
  const date = new Date(at)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function stripLeadingHeading(text: string): string {
  const lines = text.split('\n')
  if (lines[0] !== undefined && /^#{1,6}\s+/.test(lines[0])) {
    return lines.slice(1).join('\n').trim() || text
  }
  return text
}

/** Calendar mark leading the time chip; same 16-grid fill language as LogGlyph. */
function CalendarGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path
        fill="currentColor"
        d="M2.8 3.6h10.4v1.1H2.8zM2.8 12.3h10.4v1.1H2.8zM2.8 4.7h1.1v7.6H2.8zM12.1 4.7h1.1v7.6h-1.1zM3.9 6.4h8.2v1.1H3.9zM4.9 1.8h1.1v2.4H4.9zM10 1.8h1.1v2.4H10z"
      />
    </svg>
  )
}

function LogGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path
        fill="currentColor"
        d="M4.2 2.4h7.6A1.4 1.4 0 0 1 13.2 3.8v8.4a1.4 1.4 0 0 1-1.4 1.4H4.2A1.4 1.4 0 0 1 2.8 12.2V3.8A1.4 1.4 0 0 1 4.2 2.4Zm0 1.2a.2.2 0 0 0-.2.2v8.4c0 .11.09.2.2.2h7.6a.2.2 0 0 0 .2-.2V3.8a.2.2 0 0 0-.2-.2H4.2ZM5 5.2h6v1.1H5V5.2Zm0 2.3h6v1.1H5V7.5Zm0 2.3h4.2v1.1H5V9.8Z"
      />
    </svg>
  )
}

function FlagGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path
        fill="currentColor"
        d="M4.2 2.2a.6.6 0 0 1 .6.6v.4h6.3a.6.6 0 0 1 .48.96L10.4 6.8l1.18 1.64A.6.6 0 0 1 11.1 9.4H4.8v4a.6.6 0 1 1-1.2 0V2.8a.6.6 0 0 1 .6-.6Zm.6 2.2v3.8h5.35L9.4 6.8a.6.6 0 0 1 0-.72L10.15 4.4H4.8Z"
      />
    </svg>
  )
}
