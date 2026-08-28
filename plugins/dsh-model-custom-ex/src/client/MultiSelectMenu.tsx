// A dropdown multi-select styled after the official ModelSelect trigger, built
// on the official Menu primitive (selectedIds -> trailing check, onSelect
// toggles without closing). Replaces the checkbox group in ModelListEditor.

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Menu, Pill, IconChevronDownOutline14 } from '@just-genius/dsh-plugin-ui'
import type { MenuEntry } from '@just-genius/dsh-plugin-ui'

/** How many selected tags to show before folding the rest into a "+N" chip. */
const MAX_TAGS = 2

/** One selectable option. */
export interface MultiSelectOption {
  value: string
  label: string
  /** Grey out the row and ignore clicks (e.g. the non-removable text floor). */
  disabled?: boolean
}

/** Props of {@link MultiSelectMenu}. */
export interface MultiSelectMenuProps {
  /** Field label rendered above the trigger. */
  label: string
  /** Selectable options in display order. */
  options: readonly MultiSelectOption[]
  /** Currently selected values. */
  selected: readonly string[]
  /** Toggle one value (the menu stays open for consecutive picks). */
  onToggle: (value: string) => void
  /** Disable the trigger (read-only deployment or pending write). */
  disabled: boolean
  /** Placeholder shown when nothing is selected (localized). */
  emptyLabel: string
}

/**
 * Render a labeled dropdown multi-select: a chip trigger (matching the
 * composer model-select trigger) that opens the official Menu with a check
 * beside each selected option. Picking toggles and keeps the menu open so
 * several levels can be chosen in one pass.
 */
export function MultiSelectMenu(props: MultiSelectMenuProps): ReactNode {
  const { label, options, selected, onToggle, disabled, emptyLabel } = props
  const [open, setOpen] = useState(false)

  const items: readonly MenuEntry[] = options.map(option => ({
    id: option.value,
    label: option.label,
    ...option.disabled === true ? { disabled: true } : {},
  }))

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          color: 'var(--dsw-alias-label-tertiary)',
          fontSize: 12,
          lineHeight: '18px',
        }}
      >
        {label}
      </span>
      <Menu
        open={open}
        items={items}
        onClose={() => { setOpen(false) }}
        selectedIds={[...selected]}
        onSelect={(value) => { onToggle(value) }}
        align="start"
        side="bottom"
        portal
        anchor={(
          <button
            type="button"
            disabled={disabled}
            onClick={() => { setOpen(current => !current) }}
            style={{
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              width: '100%',
              minHeight: 32,
              padding: '4px 8px',
              border: '1px solid var(--dsw-alias-border-l2)',
              borderRadius: 8,
              background: 'var(--dsw-alias-bg-layer-1)',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: 13,
              lineHeight: '20px',
              cursor: disabled ? 'default' : 'pointer',
            }}
          >
            <span
              style={{
                flex: 1,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 4,
                minWidth: 0,
              }}
            >
              {selected.length === 0
                ? <span style={{ color: 'var(--dsw-alias-label-dimmed)' }}>{emptyLabel}</span>
                : (
                  <>
                    {selected.slice(0, MAX_TAGS).map(value => (
                      <Pill key={value} active>
                        {options.find(o => o.value === value)?.label ?? value}
                      </Pill>
                    ))}
                    {selected.length > MAX_TAGS && (
                      <Pill>+{selected.length - MAX_TAGS}</Pill>
                    )}
                  </>
                )}
            </span>
            <span
              style={{
                display: 'inline-flex',
                flex: '0 0 auto',
                color: 'var(--dsw-alias-label-caption)',
                transform: open ? 'rotate(180deg)' : undefined,
                transition: 'transform 120ms ease',
              }}
            >
              <IconChevronDownOutline14 />
            </span>
          </button>
        )}
      />
    </label>
  )
}
