import { useEffect, useRef, useState } from 'react'
import { PENDING_PATH, type MemoryHttpResult, type MemoryPending } from '../shared.ts'

const POLL_MS = 500

/** Poll the host for a live memory_propose wait on this session. */
export function usePendingMemory(sessionId: string): MemoryPending | null {
  const [pending, setPending] = useState<MemoryPending | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    let timer: number | undefined

    const pull = async () => {
      try {
        const response = await fetch(`${PENDING_PATH}?sessionId=${encodeURIComponent(sessionId)}`, {
          method: 'GET',
          headers: { accept: 'application/json' },
          cache: 'no-store',
        })
        const value = await response.json() as MemoryHttpResult<MemoryPending | null>
        if (!aliveRef.current) return
        if (value.ok) setPending(value.value)
      } catch {
        // keep last snapshot; retry next tick
      }
    }

    void pull()
    timer = window.setInterval(() => {
      void pull()
    }, POLL_MS)

    return () => {
      aliveRef.current = false
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [sessionId])

  return pending
}
