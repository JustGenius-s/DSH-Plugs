import { useEffect, useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import css from './Toast.module.css'

/** Transient, non-interactive announcement banner. */
export function Toast({ text, icon, anchor, onDone }: {
  text: string
  icon?: ReactNode
  anchor?: HTMLElement | null
  onDone: () => void
}) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 4000)
    return () => window.clearTimeout(timer)
  }, [onDone])

  const [left, setLeft] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (anchor == null) return
    const measure = () => {
      const rect = anchor.getBoundingClientRect()
      setLeft(rect.left + rect.width / 2)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [anchor])

  return createPortal(
    <div className={css.toast} role="alert" style={left === null ? undefined : { left }}>
      {icon === undefined ? null : <span className={css.icon} aria-hidden>{icon}</span>}
      <span>{text}</span>
    </div>,
    document.body,
  )
}
