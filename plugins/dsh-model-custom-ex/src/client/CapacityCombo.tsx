// Editable capacity field with a trailing DSH Menu of common K/M presets.
// Typing stays on the input; the chevron only opens the list.

import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { IconChevronDownOutline14, Menu } from '@just-genius/dsh-plugin-ui'
import styles from './ModelsSection.module.css'

/** Common context-window spellings, matching how this page stores K/M. */
export const CONTEXT_WINDOW_PRESETS = ['32K', '64K', '128K', '256K', '272K', '373K', '512K', '1M'] as const

/** Common max-output spellings. */
export const MAX_TOKEN_PRESETS = ['4K', '8K', '16K', '32K', '64K', '128K'] as const

/** Default max-output count written onto a new row (`32K` on this page's scale). */
export const DEFAULT_MAX_TOKENS = 32_000

/** Props of {@link CapacityCombo}. */
export interface CapacityComboProps {
  /** Field label rendered above the combo. */
  label: string
  /** Current field text (live keystrokes or the stored spelling). */
  value: string
  /** Placeholder when the field is empty. */
  placeholder: string
  /** Preset spellings offered in the trailing menu. */
  presets: readonly string[]
  /** Accessible name for the text input. */
  ariaLabel: string
  /** Disable typing and the menu (read-only deployment or pending write). */
  disabled: boolean
  /** Replace the field text (parent parses and stores). */
  onChange: (text: string) => void
}

/** Preset whose spelling matches the current text, ignoring case. */
function matchingPreset(value: string, presets: readonly string[]): string | undefined {
  const trimmed = value.trim().toLowerCase()
  if (trimmed.length === 0) return undefined
  return presets.find(preset => preset.toLowerCase() === trimmed)
}

/**
 * Labeled capacity combo: a typeable input plus a trailing chevron that
 * opens the official Menu on common K/M sizes.
 */
export function CapacityCombo(props: CapacityComboProps): ReactNode {
  const { label, value, placeholder, presets, ariaLabel, disabled, onChange } = props
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const selected = matchingPreset(value, presets)

  return (
    <label className={styles['modelField']}>
      <span className={styles['modelFieldLabel']}>{label}</span>
      <div ref={wrapRef} className={styles['capacityCombo']}>
        <input
          className={styles['capacityInput']}
          type="text"
          inputMode="numeric"
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          disabled={disabled}
          onChange={(event) => { onChange(event.target.value) }}
        />
        <Menu
          className={styles['capacityMenu']}
          open={open}
          items={presets.map(preset => ({ id: preset, label: preset }))}
          selectedId={selected}
          onClose={() => { setOpen(false) }}
          onSelect={(preset) => {
            onChange(preset)
            setOpen(false)
          }}
          align="end"
          side="bottom"
          portal
          compact
          getAnchorRect={() => wrapRef.current?.getBoundingClientRect() ?? null}
          anchor={(
            <button
              type="button"
              className={styles['capacityToggle']}
              aria-label={label}
              aria-haspopup="listbox"
              aria-expanded={open}
              disabled={disabled}
              onClick={() => { setOpen(current => !current) }}
            >
              <span
                className={styles['capacityChevron']}
                data-open={open ? 'true' : undefined}
              >
                <IconChevronDownOutline14 />
              </span>
            </button>
          )}
        />
      </div>
    </label>
  )
}
