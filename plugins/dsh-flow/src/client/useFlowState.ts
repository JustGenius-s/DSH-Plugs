import { useCallback, useSyncExternalStore } from 'react'
import { flowState, type FlowClientState } from './state.ts'

export function useFlowState(sessionId: string): FlowClientState {
  return useSyncExternalStore(
    useCallback(listener => flowState.subscribe(sessionId, listener), [sessionId]),
    useCallback(() => flowState.getSnapshot(sessionId), [sessionId]),
  )
}
