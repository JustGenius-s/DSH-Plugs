/**
 * Side-chat sandbox permission chip: the same `/permission` surface as the
 * main InputBar's PermissionSelect (Read Only / Workspace Write / Full access,
 * shield glyphs, Full-access risk confirmation). Options come from the
 * session's `permissions` projection so the label tracks the live sandbox.
 */

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  Menu,
  RiskConfirmation,
  type MenuItem,
} from '@just-genius/dsh-plugin-ui'

/** Wire shape of the `permissions` session projection. */
export interface PermissionSelectValue {
  currentValue: string
  options: readonly {
    value: string
    name: string
    description?: string
  }[]
}

export interface PermissionProjectionFace {
  faceOf(key: string): {
    subscribe(fn: () => void): () => void
    getSnapshot(): unknown
  }
}

const FULL_ACCESS = 'danger-full-access'

const FALLBACK: PermissionSelectValue = {
  currentValue: 'workspace-write',
  options: [
    { value: 'read-only', name: 'read-only' },
    { value: 'workspace-write', name: 'workspace-write' },
    { value: FULL_ACCESS, name: FULL_ACCESS },
  ],
}

const shieldOutline = 'M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z'

function permissionGlyph(value: string): ReactNode {
  if (value === 'read-only') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d={shieldOutline} stroke="currentColor" strokeWidth="1.31831" strokeLinejoin="round" />
        <path
          d="M12.1654 5.7552L8.9447 9.41475C8.73044 9.65816 8.53628 9.8804 8.35774 10.0423C8.1713 10.2114 7.94235 10.3717 7.64016 10.4254C7.48207 10.4535 7.32 10.4552 7.16151 10.4294C6.85843 10.3801 6.62728 10.2223 6.43836 10.0559C6.25752 9.89653 6.06037 9.67732 5.84264 9.43705L4.72925 8.20897L5.63557 7.38707L6.74897 8.61594C6.98603 8.87755 7.12974 9.03533 7.24673 9.13839C7.31033 9.19443 7.34485 9.21476 7.35823 9.22122C7.38068 9.22484 7.40352 9.22515 7.42593 9.22122C7.40522 9.22502 7.42893 9.23294 7.53583 9.136C7.65132 9.03126 7.79316 8.87139 8.02643 8.60638L11.2479 4.94763L12.1654 5.7552Z"
          fill="currentColor"
        />
      </svg>
    )
  }
  if (value === 'workspace-write') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M8.08887 0.251709C8.20479 0.23085 8.32486 0.241168 8.43652 0.282959L15.0215 2.75171C15.2787 2.84819 15.4492 3.09414 15.4492 3.3689V7.0105C15.4492 7.10986 15.4441 7.2081 15.4414 7.30542C15.0285 7.07175 14.5905 6.87695 14.1309 6.73022V3.82495L8.20508 1.60327L2.2793 3.82495V7.0105C2.27936 9.7171 3.4745 11.5379 5.02734 12.7947C5.01025 12.9942 5 13.1962 5 13.4001C5.00001 13.7617 5.02722 14.1169 5.08008 14.4636C2.91555 13.0393 0.961014 10.752 0.960938 7.0105V3.3689C0.960938 3.09417 1.13146 2.84821 1.38867 2.75171L7.97461 0.282959L8.08887 0.251709Z"
          fill="currentColor"
        />
        <path d="M11.3525 5.64688V6.85688H5V5.64688H11.3525Z" fill="currentColor" />
        <path d="M9.5824 8.29376V9.50376H5V8.29376H9.5824Z" fill="currentColor" />
        <path
          d="M14.6647 15.6852H10.0338C10.3878 15.3751 10.7567 15.0517 11.0772 14.7706C11.2531 14.6164 11.4144 14.4746 11.5511 14.3547H14.6647V15.6852Z"
          fill="currentColor"
        />
        <path
          d="M8.14852 14.1308L7.33925 15.4976C7.22458 15.6912 7.42245 15.9194 7.63037 15.8333L9.09785 15.2254L15.0399 10.0719L14.0905 8.97733L8.14852 14.1308Z"
          fill="currentColor"
        />
      </svg>
    )
  }
  if (value === FULL_ACCESS) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d={shieldOutline} stroke="currentColor" strokeWidth="1.31831" strokeLinejoin="round" />
        <path d="M9.10094 4.5V8.75939H7.59888V4.5H9.10094Z" fill="currentColor" />
        <path d="M9.10094 9.8114V11.5H7.59888V9.8114H9.10094Z" fill="currentColor" />
      </svg>
    )
  }
  return undefined
}

function displayName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

function optionLabel(option: { value: string; name: string }): string {
  return option.value === FULL_ACCESS ? 'Full access' : displayName(option.name)
}

function readPermissions(snapshot: unknown): PermissionSelectValue | undefined {
  if (snapshot === null || typeof snapshot !== 'object') return undefined
  const value = snapshot as { currentValue?: unknown; options?: unknown }
  if (typeof value.currentValue !== 'string' || !Array.isArray(value.options)) return undefined
  return snapshot as PermissionSelectValue
}

export interface SideChatPermissionSelectProps {
  projections?: PermissionProjectionFace
  command?: ((line: string) => Promise<unknown>) | undefined
  t: (key: string) => string
  onError: (message: string) => void
}

/**
 * Render the sandbox-permission chip, or nothing when the session cannot
 * run slash commands (same gate as the main composer).
 */
export function SideChatPermissionSelect({
  projections,
  command,
  t,
  onError,
}: SideChatPermissionSelectProps) {
  const projected = useSyncExternalStore(
    (fn) => (projections === undefined ? () => {} : projections.faceOf('permissions').subscribe(fn)),
    () => (projections === undefined ? undefined : readPermissions(projections.faceOf('permissions').getSnapshot())),
  )
  const value = projected ?? FALLBACK
  const [pick, setPick] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => {
    setOpen(false)
    setAcknowledged(false)
    setConfirmation(null)
  }, [value.currentValue])

  if (command === undefined) return null

  const currentValue = pick ?? value.currentValue
  const current = value.options.find(option => option.value === currentValue)
  const busy = pick !== null || confirmation !== null
  const label = current === undefined ? displayName(currentValue) : optionLabel(current)
  const glyph = permissionGlyph(currentValue)
  const items: readonly MenuItem[] = value.options
    .filter(option => option.value !== 'custom')
    .map((option) => {
      const icon = permissionGlyph(option.value)
      return {
        id: option.value,
        label: optionLabel(option),
        ...(icon === undefined ? {} : { icon }),
      }
    })

  const submit = (id: string): void => {
    setPick(id)
    void command(`/permission ${id}`).catch((cause: unknown) => {
      onError(cause instanceof Error ? cause.message : '权限切换失败')
    }).finally(() => {
      setPick(null)
    })
  }

  const choose = (id: string): void => {
    setOpen(false)
    if (id === value.currentValue) return
    if (id === FULL_ACCESS) {
      setAcknowledged(false)
      setConfirmation(id)
      return
    }
    submit(id)
  }

  const closeConfirmation = (): void => {
    setAcknowledged(false)
    setConfirmation(null)
  }

  return (
    <>
      <span className="dsh-codex-sidechat-perm-wrap">
      <Menu
        open={open}
        items={items}
        selectedId={currentValue}
        onSelect={choose}
        onClose={() => setOpen(false)}
        align="start"
        side="top"
        portal
        anchor={(
          <button
            type="button"
            className="dsh-codex-sidechat-perm"
            aria-label={t('sideChat.accessMode').replace('{name}', label)}
            title={current?.description ?? label}
            disabled={busy}
            onClick={() => setOpen(currentOpen => !currentOpen)}
          >
            {glyph !== undefined && (
              <span className="dsh-codex-sidechat-perm-icon" aria-hidden>
                {glyph}
              </span>
            )}
            <span className="dsh-codex-sidechat-perm-label">{label}</span>
          </button>
        )}
      />
      </span>
      <RiskConfirmation
        open={confirmation !== null}
        title={t('sideChat.accessConfirmTitle')}
        description={t('sideChat.accessConfirmDescription')}
        acknowledgeLabel={t('sideChat.accessConfirmAcknowledge')}
        cancelLabel={t('sideChat.accessConfirmCancel')}
        confirmLabel={t('sideChat.accessConfirmEnable')}
        acknowledged={acknowledged}
        onAcknowledgedChange={setAcknowledged}
        onCancel={closeConfirmation}
        onConfirm={() => {
          if (!acknowledged || confirmation === null) return
          const id = confirmation
          closeConfirmation()
          submit(id)
        }}
      />
    </>
  )
}
