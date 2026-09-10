import { useEffect, useRef, useState } from 'react'
import { IconCloseFill14 } from '@just-genius/dsh-plugin-ui'
import type { PropsLocale, PropsRuntime } from '@just-genius/dsh-plugin-runtime/client'
import { useDebugState } from './useDebugState.ts'
import styles from './DebugChip.module.css'

export interface DebugChipInjected {
  sessionId: string
  exitDebugMode: () => Promise<string | null>
}

export type DebugChipProps = PropsRuntime<'conversation.input.left'>
  & DebugChipInjected
  & PropsLocale<'debug'>

export function DebugChip({ sessionId, exitDebugMode, t }: DebugChipProps) {
  const debug = useDebugState(sessionId)
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

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

/**
 * Chip mark: Lucide `bug-play`, kept verbatim (24-grid stroke, round caps) at
 * the chip's 12px box, where the 2px stroke lands on ~1px.
 */
function BugGlyph() {
  return (
    <svg
      className={styles.bug}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10 19.655A6 6 0 0 1 6 14v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 3.97" />
      <path d="M14 15.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997a1 1 0 0 1-1.517-.86z" />
      <path d="M14.12 3.88 16 2" />
      <path d="M21 5a4 4 0 0 1-3.55 3.97" />
      <path d="M3 21a4 4 0 0 1 3.81-4" />
      <path d="M3 5a4 4 0 0 0 3.55 3.97" />
      <path d="M6 13H2" />
      <path d="m8 2 1.88 1.88" />
      <path d="M9 7.13V6a3 3 0 1 1 6 0v1.13" />
    </svg>
  )
}
