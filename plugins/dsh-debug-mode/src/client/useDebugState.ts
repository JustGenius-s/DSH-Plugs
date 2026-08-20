import { useEffect, useRef, useState } from 'react'
import { STATE_PATH, type DebugHttpResult } from '../shared.ts'
import type { DebugProjection } from '../types.ts'

const POLL_MS = 500

const EMPTY: DebugProjection = {
  active: false,
  pending: false,
  wait: null,
  logs: [],
}

/** Poll the host-only debug projection for one session (state is not persisted). */
export function useDebugState(sessionId: string): DebugProjection {
  const [state, setState] = useState<DebugProjection>(EMPTY)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    let timer: number | undefined

    const pull = async () => {
      try {
        const response = await fetch(`${STATE_PATH}?sessionId=${encodeURIComponent(sessionId)}`, {
          method: 'GET',
          headers: { accept: 'application/json' },
          cache: 'no-store',
        })
        const value = await response.json() as DebugHttpResult<DebugProjection>
        if (!aliveRef.current) return
        if (value.ok) setState(value.value)
      } catch {
        // Keep the last good snapshot; the next tick retries.
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

  return state
}
