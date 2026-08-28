import { useEffect, useState } from 'react'
import { Button } from '@just-genius/dsh-plugin-ui'
import type { PropsLocale, PropsRuntime } from '@just-genius/dsh-plugin-runtime/client'
import type { MemoryKey } from './locales.ts'
import { usePendingMemory } from './usePendingMemory.ts'
import type { MemoryProposeAction } from '../shared.ts'
import styles from './MemoryDock.module.css'

export interface MemoryDockInjected {
  sessionId: string
  resolvePropose: (
    action: MemoryProposeAction,
    title: string,
    content: string,
  ) => Promise<string | null>
}

export type MemoryDockProps = PropsRuntime<'conversation.input.dock'>
  & MemoryDockInjected
  & PropsLocale<'memory'>

export function MemoryDock({ sessionId, resolvePropose, t }: MemoryDockProps) {
  const pending = usePendingMemory(sessionId)
  if (pending === null || !pending.waiting) return null

  return (
    <div className={styles.dock}>
      <ProposeCard
        key={pending.id}
        title={pending.title}
        content={pending.content}
        resolvePropose={resolvePropose}
        t={t}
      />
    </div>
  )
}

function ProposeCard({
  title: initialTitle,
  content: initialContent,
  resolvePropose,
  t,
}: {
  title: string
  content: string
  resolvePropose: MemoryDockInjected['resolvePropose']
  t: (key: MemoryKey) => string
}) {
  const [title, setTitle] = useState(initialTitle)
  const [content, setContent] = useState(initialContent)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setTitle(initialTitle)
    setContent(initialContent)
    setBusy(false)
    setError(null)
  }, [initialTitle, initialContent])

  const send = (action: MemoryProposeAction) => {
    if (busy) return
    setBusy(true)
    setError(null)
    resolvePropose(action, title, content).then((failure) => {
      if (failure === null) return
      setBusy(false)
      setError(failure)
    }, (reason) => {
      setBusy(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <section className={styles.card} aria-label={t('propose.title')}>
      <header className={styles.header}>{t('propose.title')}</header>
      <p className={styles.hint}>{t('propose.editHint')}</p>
      <div className={styles.fields}>
        <label className={styles.label} htmlFor="dsh-memory-propose-title">{t('title')}</label>
        <input
          id="dsh-memory-propose-title"
          className={styles.input}
          value={title}
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
        />
        <label className={styles.label} htmlFor="dsh-memory-propose-content">{t('content')}</label>
        <textarea
          id="dsh-memory-propose-content"
          className={styles.textarea}
          value={content}
          disabled={busy}
          onChange={(event) => setContent(event.target.value)}
        />
      </div>
      <div className={styles.footer}>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => send('reject')}>
          {t('propose.reject')}
        </Button>
        <Button variant="primary" size="sm" disabled={busy || title.trim() === '' || content.trim() === ''} onClick={() => send('accept')}>
          {t('propose.accept')}
        </Button>
      </div>
      {error !== null && <div className={styles.feedback} role="status">{error}</div>}
    </section>
  )
}
