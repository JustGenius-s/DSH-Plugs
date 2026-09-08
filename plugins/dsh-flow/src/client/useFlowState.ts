import { useEffect, useRef, useState } from 'react'
import { getResult } from '@just-genius/dsh-plugin-runtime/client'
import { STATE_PATH, type FlowStateResponse } from '../shared.ts'

/** Poll cadence. The graph changes on child settlements, not on keystrokes. */
const POLL_MS = 1200

const EMPTY: FlowStateResponse = {
  plan: null,
  mode: false,
  modePending: null,
  degraded: false,
  degradedReason: null,
}

/**
 * Poll the host-only flow projection.
 *
 * Polling rather than pushing is deliberate: the host half would otherwise need
 * a per-session push channel, while the browser already polls this shape for
 * other plugins' state. The last good snapshot is kept on a failed tick so a
 * transient error never blanks the canvas.
 */
export function useFlowState(sessionId: string): FlowStateResponse {
  const [state, setState] = useState<FlowStateResponse>(EMPTY)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    let timer: number | undefined

    const pull = async () => {
      try {
        const value = await getResult<FlowStateResponse>(
          `${STATE_PATH}?sessionId=${encodeURIComponent(sessionId)}`,
        )
        if (aliveRef.current) setState(value)
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
