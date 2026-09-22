// A labeled single-select on the official `Menu` primitive.
//
// Deliberately not a native <select>: the settings shell's other pickers are
// Menu-based, and a native control brings OS chrome, a different keyboard model,
// and no theming. The trigger is a bordered button showing the current value as
// plain text (no pill); the list carries the official card chrome and a trailing
// check on the selected row, exactly as Menu.tsx documents.

import { useState } from 'react'
import type { ReactNode } from 'react'
import { IconChevronDownOutline14, Menu } from '@just-genius/dsh-plugin-ui'
import type { MenuEntry } from '@just-genius/dsh-plugin-ui'
import styles from './SelectMenu.module.css'

export interface SelectOption {
  value: string
  label: string
}

/** Props of {@link SelectMenu}. */
export interface SelectMenuProps {
  /** Field label rendered above the trigger. */
  label: string
  options: readonly SelectOption[]
  value: string
  /** Replace the selected value and close the list. */
  onChange: (value: string) => void
  disabled: boolean
}

export function SelectMenu(props: SelectMenuProps): ReactNode {
  const { label, options, value, onChange, disabled } = props
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.value === value)

  const items: readonly MenuEntry[] = options.map((option) => ({
    id: option.value,
    label: option.label,
  }))

  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <Menu
        open={open}
        items={items}
        selectedId={value}
        onSelect={(next) => {
          onChange(next)
          setOpen(false)
        }}
        onClose={() => { setOpen(false) }}
        align="start"
        side="bottom"
        portal
        className={styles.root}
        anchor={(
          <button
            type="button"
            className={styles.trigger}
            disabled={disabled}
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={() => { setOpen((current) => !current) }}
          >
            <span className={styles.value}>{selected?.label ?? ''}</span>
            <span className={styles.chevron} data-open={open}>
              <IconChevronDownOutline14 />
            </span>
          </button>
        )}
      />
    </div>
  )
}
