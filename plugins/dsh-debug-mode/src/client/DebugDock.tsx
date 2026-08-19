import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DebugKey } from './locales.ts'
import type { DebugLogEntry, DebugReproAction } from '../shared.ts'
import type { DebugProjection } from '../types.ts'
import styles from './DebugDock.module.css'

export interface DebugDockInjected {
  resolveRepro: (action: DebugReproAction, notes: string) => Promise<string | null>
}

export type DebugDockProps = PropsRuntime<'conversation.input.dock'>
  & DebugDockInjected
  & PropsLocale<'debug'>

export function DebugDock({ useProjection, useInput, inputActions, resolveRepro, t }: DebugDockProps) {
  const debug = useProjection('debug') as DebugProjection | undefined
  if (debug === undefined) return null
  const on = debug.pending ? !debug.active : debug.active
  if (!on) return null

  return (
    <div className={styles.dock}>
      <LogCard logs={debug.logs} t={t} />
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
  t,
}: {
  logs: readonly DebugLogEntry[]
  t: (key: DebugKey) => string
}) {
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = scroller.current
    if (node === null) return
    node.scrollTop = node.scrollHeight
  }, [logs.length])

  return (
    <section className={styles.card} aria-label={t('logs.title')}>
      <header className={styles.logHeader}>
        <span className={styles.logGlyph} aria-hidden>
          <LogGlyph />
        </span>
        {t('logs.title')}
      </header>
      <div className={styles.logBody} ref={scroller}>
        {logs.length === 0 ? (
          <div className={styles.empty}>{t('logs.empty')}</div>
        ) : logs.map((entry) => (
          <div key={entry.id} className={styles.line}>
            <span className={styles.lineMeta}>{formatTime(entry.at)} · {t(sourceKey(entry.source))}</span>
            <span className={styles.lineText}>{entry.text}</span>
          </div>
        ))}
      </div>
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

function sourceKey(source: DebugLogEntry['source']): DebugKey {
  if (source === 'agent') return 'source.agent'
  if (source === 'ingest') return 'source.ingest'
  return 'source.user'
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
