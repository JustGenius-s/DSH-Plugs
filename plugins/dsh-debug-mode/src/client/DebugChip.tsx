import { useEffect, useRef, useState } from 'react'
import { IconCloseFill14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DebugProjection } from '../types.ts'
import styles from './DebugChip.module.css'

export interface DebugChipInjected {
  exitDebugMode: () => Promise<string | null>
}

export type DebugChipProps = PropsRuntime<'conversation.input.left'>
  & DebugChipInjected
  & PropsLocale<'debug'>

export function DebugChip({ useProjection, exitDebugMode, t }: DebugChipProps) {
  const debug = useProjection('debug') as DebugProjection | undefined
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  if (debug === undefined) return null
  if (!(debug.pending ? !debug.active : debug.active)) return null

  const off = () => {
    setLeaving(true)
    setError(null)
    exitDebugMode().then((failure) => {
      if (!aliveRef.current) return
      setLeaving(false)
      setError(failure)
    }, (reason) => {
      if (!aliveRef.current) return
      setLeaving(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={styles.chip}
        aria-label={t('chip.on.aria')}
        title={t('chip.on.title')}
        disabled={leaving}
        onClick={off}
      >
        <BugGlyph />
        Debug
        <span className={styles.close} aria-hidden>
          <IconCloseFill14 size={12} />
        </span>
      </button>
      {error !== null && (
        <span className={styles.error} role="status" title={error}>
          {t('chip.failed')}
        </span>
      )}
    </span>
  )
}

function BugGlyph() {
  return (
    <svg className={styles.bug} width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path
        fill="currentColor"
        d="M8 3.2a2.1 2.1 0 0 1 2.1 2.1v.3h1.2a.6.6 0 0 1 0 1.2h-1.2v1.1h1.7l1.2-1.2a.6.6 0 1 1 .85.85L12.7 8.9l1.25 1.25a.6.6 0 1 1-.85.85L11.9 9.75H10.3v1.15h1.2a.6.6 0 0 1 0 1.2H10.3v.3A2.1 2.1 0 0 1 8 14.5a2.1 2.1 0 0 1-2.1-2.1v-.3H4.7a.6.6 0 0 1 0-1.2h1.2V9.75H4.1L2.85 11a.6.6 0 1 1-.85-.85L3.25 8.9 2 7.65a.6.6 0 1 1 .85-.85l1.2 1.2h1.65V6.8H4.5a.6.6 0 0 1 0-1.2h1.2v-.3A2.1 2.1 0 0 1 8 3.2Zm0 1.2a.9.9 0 0 0-.9.9v6.1a.9.9 0 1 0 1.8 0V5.3A.9.9 0 0 0 8 4.4Z"
      />
    </svg>
  )
}
