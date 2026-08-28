import { Button } from './Button'
import { Modal } from './Modal'
import { IconWarningOutline16 } from '../icons/index.tsx'
import css from './RiskConfirmation.module.css'

export interface RiskConfirmationProps {
  open: boolean
  title: string
  description: string
  acknowledgeLabel: string
  cancelLabel: string
  confirmLabel: string
  acknowledged: boolean
  disabled?: boolean
  onAcknowledgedChange: (acknowledged: boolean) => void
  onCancel: () => void
  onConfirm: () => void
}

/** Confirmation dialog that gates a sensitive action behind acknowledgement. */
export function RiskConfirmation({
  open,
  title,
  description,
  acknowledgeLabel,
  cancelLabel,
  confirmLabel,
  acknowledged,
  disabled = false,
  onAcknowledgedChange,
  onCancel,
  onConfirm,
}: RiskConfirmationProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      className={css.confirmation}
      contentClassName={css.content}
      footer={(
        <>
          <Button variant="outline" className={css.action} onClick={onCancel}>{cancelLabel}</Button>
          <Button
            variant="primary"
            className={css.action}
            disabled={disabled || !acknowledged}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      )}
    >
      <div className={css.warning}>
        <IconWarningOutline16 size={18} className={css.warningIcon} />
        <p>{description}</p>
      </div>
      <label className={css.acknowledgement}>
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={disabled}
          autoFocus
          onChange={(event) => onAcknowledgedChange(event.currentTarget.checked)}
        />
        <span>{acknowledgeLabel}</span>
      </label>
    </Modal>
  )
}
