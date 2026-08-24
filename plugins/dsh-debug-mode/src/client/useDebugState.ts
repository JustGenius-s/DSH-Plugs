import { useEffect, useRef, useState } from 'react'
import { STATE_PATH } from '../shared.ts'
import { getResult } from '@just-genius/dsh-plugin-runtime/client'
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
        const value = await getResult<DebugProjection>(`${STATE_PATH}?sessionId=${encodeURIComponent(sessionId)}`)
        if (!aliveRef.current) return
        setState(value)
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
