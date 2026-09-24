import { IconCloseFill14, IconFlowOutline16 } from '@just-genius/dsh-plugin-ui'
import type { PropsLocale } from '@just-genius/dsh-plugin-runtime/client'
import { flowState } from './state.ts'
import { useFlowState } from './useFlowState.ts'
import styles from './FlowChip.module.css'

export type FlowChipProps = PropsLocale<'flow'> & { sessionId: string }

export function FlowChip({ sessionId, t }: FlowChipProps) {
  const state = useFlowState(sessionId)
  if (!state.mode && state.error === null) return null

  return (
    <span className={styles.wrap}>
      {state.mode && (
        <button type="button" className={styles.chip}
          aria-label={t('chip.on.aria')}
          title={t(state.modePending === true ? 'chip.pending.title' : 'chip.on.title')}
          disabled={state.changing}
          onClick={() => void flowState.setMode(sessionId, false)}>
          <IconFlowOutline16 size={12} />
          Flow
          <IconCloseFill14 size={12} />
        </button>
      )}
      {state.error !== null && (
        <span className={styles.error} role="status" title={state.error}>
          {t('chip.failed')}
        </span>
      )}
    </span>
  )
}
