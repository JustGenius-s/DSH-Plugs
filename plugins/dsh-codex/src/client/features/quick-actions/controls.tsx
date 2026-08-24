/**
 * QuickActionsControls: the reusable trigger + menu + manager for the
 * codespace "quick actions" feature.
 *
 * Two visual variants share one behavior:
 *  - 'header'   — a compact toolbar Button (checklist label + chevron).
 *  - 'launcher' — a plain Button (checklist + label).
 *
 * Both open a portaled Menu listing the stored actions (ids `run:<id>`), a
 * separator, then a `manage` row that opens the editor Modal. Selecting a run
 * closes the menu and calls `execute`; a rejection surfaces as a short inline
 * error instead of throwing from the event handler.
 *
 * The manage Modal is its own inner component so all editor draft state is
 * local to it. It is mounted only while the modal is open, so closing it
 * discards the draft and no updates can land after close.
 */

import { useMemo, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import {
  Button, Menu, Modal, Tooltip,
  IconChecklistOutline14, IconChevronDownOutline14, IconPlusOutline16,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { injectStyles } from '@just-genius/dsh-plugin-ui'
import { createQuickAction } from './store'
import type { QuickAction, QuickActionsStore, QuickActionTarget } from '../../../shared/config'

const QUICK_ACTIONS_CSS = `
.dsh-codex-quick-actions-modal{width:min(560px,calc(100vw - 48px))!important;max-width:calc(100vw - 48px)!important;box-sizing:border-box}
.dsh-codex-quick-actions-modal-content{width:100%!important;max-width:none!important;box-sizing:border-box;padding:0!important}

/* Section shell: mirrors ModelsSection.module.css (settings-panel design
   language — 16/24 title, 14/22 intro, capsule controls, border-l2 hairlines,
   every color through a --dsw-alias-* token). */
.dsh-codex-quick-actions{display:flex;flex-direction:column;gap:12px;max-width:720px;max-height:min(62vh,560px);overflow-y:auto;overflow-x:hidden;padding-right:4px;color:var(--dsw-alias-label-primary)}
.dsh-codex-quick-actions-title{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dsh-codex-quick-actions-intro{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary)}
.dsh-codex-quick-actions-empty{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-codex-quick-actions-rows{list-style:none;margin:4px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}

/* A configured quick action: outlined on the panel fill, so the filled editor
   it expands into reads as the nested object. */
.dsh-codex-quick-actions-rowCard{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:12px}
.dsh-codex-quick-actions-rowHead{display:flex;align-items:center;gap:10px}
.dsh-codex-quick-actions-rowIdentity{display:inline-flex;align-items:baseline;gap:6px;min-width:0}
.dsh-codex-quick-actions-rowName{font-size:14px;line-height:22px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dsh-codex-quick-actions-rowMeta{flex:none;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-codex-quick-actions-rowActions{display:inline-flex;align-items:center;gap:4px;margin-left:auto}
.dsh-codex-quick-actions-rowActions .dsh-codex-quick-actions-secondary,
.dsh-codex-quick-actions-rowActions .dsh-codex-quick-actions-danger{height:28px;padding:0 10px;border-radius:14px;font-size:12px;line-height:18px}

/* Editing surface: a filled module on the panel, matching the settings
   selector fill rather than adding another outline inside the row. */
.dsh-codex-quick-actions-editor{border-radius:12px;background:var(--dsw-alias-bg-module-platform);padding:14px 16px;display:flex;flex-direction:column;gap:14px}
.dsh-codex-quick-actions-addCard{border-radius:12px;background:var(--dsw-alias-bg-module-platform);padding:14px 16px;display:flex;flex-direction:column;gap:14px}
.dsh-codex-quick-actions-addCard .dsh-codex-quick-actions-editor{background:none;padding:0}

.dsh-codex-quick-actions-field{display:flex;flex-direction:column;gap:6px}
.dsh-codex-quick-actions-fieldLabel{display:inline-flex;align-items:center;gap:10px;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.dsh-codex-quick-actions-input{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font:inherit;font-size:14px;line-height:22px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.dsh-codex-quick-actions-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.dsh-codex-quick-actions-input::placeholder{color:var(--dsw-alias-label-dimmed)}
.dsh-codex-quick-actions-textarea{box-sizing:border-box;width:100%;max-width:100%;min-height:72px;max-height:180px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;resize:vertical;overflow-y:auto;overflow-x:hidden;overflow-wrap:anywhere;white-space:pre-wrap;display:block}
.dsh-codex-quick-actions-textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.dsh-codex-quick-actions-textarea::placeholder{color:var(--dsw-alias-label-dimmed)}

/* One command step inside the editor. */
.dsh-codex-quick-actions-step{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:10px}
.dsh-codex-quick-actions-stepHead{display:flex;align-items:center;gap:8px}
.dsh-codex-quick-actions-stepTitle{font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.dsh-codex-quick-actions-stepRemove{margin-left:auto;border:none;background:transparent;padding:0;cursor:pointer;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}

/* Capsule buttons, sharing ModelsSection's controls vocabulary. */
.dsh-codex-quick-actions-primary{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:none;border-radius:18px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.dsh-codex-quick-actions-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.dsh-codex-quick-actions-secondary{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:18px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.dsh-codex-quick-actions-secondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
.dsh-codex-quick-actions-danger{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 14px;border:none;border-radius:18px;background:transparent;color:var(--dsw-alias-state-error-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.dsh-codex-quick-actions-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.dsh-codex-quick-actions-editorActions{display:flex;justify-content:flex-end;gap:8px}
.dsh-codex-quick-actions-primary:disabled,
.dsh-codex-quick-actions-secondary:disabled,
.dsh-codex-quick-actions-danger:disabled{opacity:.4;cursor:default}
.dsh-codex-quick-actions-secondary:focus-visible,
.dsh-codex-quick-actions-danger:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}

/* The "add a quick action" affordance: the last slot of the list, dashed and
   full width, repeating the row cards' corner — a place, not a command. */
.dsh-codex-quick-actions-addAction{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;width:100%;height:44px;padding:0 14px;border:1px dashed var(--dsw-alias-border-l3);border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.dsh-codex-quick-actions-addAction:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}

.dsh-codex-quick-actions-footer{display:flex;width:100%;align-items:center;justify-content:space-between;gap:8px}
.dsh-codex-quick-actions-footerGroup{display:flex;align-items:center;gap:8px}
`
injectStyles('@just-genius/dsh-codex', '@just-genius/dsh-codex/quick-actions.css', QUICK_ACTIONS_CSS)

export interface QuickActionsControlsProps {
  store: QuickActionsStore
  execute: (action: QuickAction) => Promise<void>
  t: (key: string) => string
  variant?: 'header' | 'launcher'
}

export function QuickActionsControls({ store, execute, t, variant = 'header' }: QuickActionsControlsProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [menuOpen, setMenuOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const items = useMemo<readonly MenuEntry[]>(() => {
    const runItems: MenuEntry[] = snapshot.actions.map(action => ({
      id: `run:${action.id}`,
      label: action.name || action.id,
    }))
    const entries: MenuEntry[] = [...runItems]
    if (runItems.length > 0) entries.push({ type: 'separator', id: 'sep-quick-actions' })
    entries.push({ id: 'manage', label: t('quickActions.manage') })
    return entries
  }, [snapshot.actions, t])

  const openMenu = (): void => {
    setRunError(null)
    setMenuOpen(open => !open)
  }

  const onSelect = (id: string): void => {
    if (id === 'manage') {
      setMenuOpen(false)
      setManageOpen(true)
      return
    }
    if (!id.startsWith('run:')) return
    setMenuOpen(false)
    const actionId = id.slice('run:'.length)
    const action = snapshot.actions.find(item => item.id === actionId)
    if (action === undefined) return
    setRunError(null)
    // Never throw from the event handler: surface a rejection as inline text.
    try {
      void execute(action).catch(() => setRunError(t('quickActions.runError')))
    } catch {
      setRunError(t('quickActions.runError'))
    }
  }

  const triggerButton = variant === 'header' ? (
    <Button
      variant="toolbar"
      size="sm"
      style={triggerButtonStyle}
      aria-label={t('quickActions')}
      title={t('quickActions')}
      aria-expanded={menuOpen}
      aria-haspopup="menu"
      onClick={openMenu}
    >
      <IconChecklistOutline14 size={14} />
    </Button>
  ) : (
    <Button
      variant="ghost"
      size="sm"
      style={triggerButtonStyle}
      aria-label={t('quickActions')}
      title={t('quickActions')}
      aria-expanded={menuOpen}
      aria-haspopup="menu"
      onClick={openMenu}
    >
      <IconChecklistOutline14 size={14} />
    </Button>
  )
  const trigger = <Tooltip label={t('quickActions')} delayMs={500} side="bottom">{triggerButton}</Tooltip>

  return (
    <>
      <div style={controlsStyle}>
        <Menu
          open={menuOpen}
          portal
          dense
          side="bottom"
          align="end"
          anchor={trigger}
          items={items}
          onSelect={onSelect}
          onClose={() => setMenuOpen(false)}
        />
        {runError !== null && (
          <div style={errorStyle} role="alert">{runError}</div>
        )}
      </div>
      {manageOpen && (
        <ManageModal store={store} t={t} onClose={() => setManageOpen(false)} />
      )}
    </>
  )
}

interface ManageModalProps {
  store: QuickActionsStore
  t: (key: string) => string
  onClose: () => void
}

function ManageModal({ store, t, onClose }: ManageModalProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  // The single in-page editor draft: null while nothing is being edited, an
  // existing action while a row is expanded, or a new (unsaved) action while
  // the add card is open. The list and the editor share one page.
  const [draft, setDraft] = useState<QuickAction | null>(null)

  const isNew = draft !== null && !snapshot.actions.some(action => action.id === draft.id)

  const startNew = (): void => setDraft(createQuickAction())
  const startEdit = (action: QuickAction): void =>
    setDraft({ ...action, steps: action.steps.map(step => ({ ...step })) })
  const cancelEdit = (): void => setDraft(null)

  const save = (): void => {
    if (draft === null) return
    const exists = snapshot.actions.some(action => action.id === draft.id)
    if (exists) store.update(draft)
    else store.add(draft)
    setDraft(null)
  }

  const deleteDraft = (): void => {
    if (draft === null) return
    store.remove(draft.id)
    setDraft(null)
  }

  const rows = snapshot.actions

  return (
    <Modal
      open
      onClose={onClose}
      title={t('quickActions.manage')}
      closeLabel={t('quickActions.cancel')}
      className="dsh-codex-quick-actions-modal"
      contentClassName="dsh-codex-quick-actions-modal-content"
      footer={draft === null ? undefined : (
        <div className="dsh-codex-quick-actions-footer">
          <div className="dsh-codex-quick-actions-footerGroup">
            <button
              type="button"
              className="dsh-codex-quick-actions-secondary"
              onClick={cancelEdit}
            >
              {t('quickActions.cancel')}
            </button>
          </div>
          <div className="dsh-codex-quick-actions-footerGroup">
            <button
              type="button"
              className="dsh-codex-quick-actions-primary"
              onClick={save}
            >
              {t('quickActions.save')}
            </button>
          </div>
        </div>
      )}
    >
      <section className="dsh-codex-quick-actions">
        {rows.length === 0 && draft === null ? (
          <p className="dsh-codex-quick-actions-empty">{t('quickActions.empty')}</p>
        ) : null}

        <ul className="dsh-codex-quick-actions-rows">
          {rows.map(action => {
            const open = draft !== null && draft.id === action.id
            return (
              <li key={action.id} className="dsh-codex-quick-actions-rowCard">
                <div className="dsh-codex-quick-actions-rowHead">
                  <div className="dsh-codex-quick-actions-rowIdentity">
                    <span className="dsh-codex-quick-actions-rowName">{action.name || action.id}</span>
                    <span className="dsh-codex-quick-actions-rowMeta">{String(action.steps.length)} {t('quickActions.steps')}</span>
                  </div>
                  <div className="dsh-codex-quick-actions-rowActions">
                    <button
                      type="button"
                      className="dsh-codex-quick-actions-secondary"
                      onClick={() => { open ? setDraft(null) : startEdit(action) }}
                    >
                      {t('quickActions.edit')}
                    </button>
                    <button
                      type="button"
                      className="dsh-codex-quick-actions-danger"
                      onClick={() => { store.remove(action.id) }}
                    >
                      {t('quickActions.delete')}
                    </button>
                  </div>
                </div>
                {open && draft !== null && (
                  <ActionEditor
                    draft={draft}
                    t={t}
                    isNew={false}
                    onChange={setDraft}
                    onDelete={deleteDraft}
                  />
                )}
              </li>
            )
          })}
        </ul>

        {draft !== null && isNew
          ? (
            <div className="dsh-codex-quick-actions-addCard">
              <ActionEditor
                draft={draft}
                t={t}
                isNew
                onChange={setDraft}
                onDelete={cancelEdit}
              />
            </div>
          )
          : (
            <button
              type="button"
              className="dsh-codex-quick-actions-addAction"
              onClick={startNew}
            >
              <IconPlusOutline16 size={14} />
              {t('quickActions.new')}
            </button>
          )}
      </section>
    </Modal>
  )
}

interface ActionEditorProps {
  draft: QuickAction
  t: (key: string) => string
  isNew: boolean
  onChange: (next: QuickAction) => void
  onDelete: () => void
}

function ActionEditor({ draft, t, isNew, onChange, onDelete }: ActionEditorProps) {
  const [openTargetIndex, setOpenTargetIndex] = useState<number | null>(null)
  const targetItems = useMemo<readonly MenuEntry[]>(() => [
    { id: 'current', label: t('quickActions.currentTerminal') },
    { id: 'new', label: t('quickActions.newTerminal') },
  ], [t])

  const setName = (value: string): void => onChange({ ...draft, name: value })
  const setCommandField = (index: number, value: string): void =>
    onChange({
      ...draft,
      steps: draft.steps.map((step, i) => i === index ? { ...step, command: value } : step),
    })
  const setStepTarget = (index: number, target: QuickActionTarget): void =>
    onChange({
      ...draft,
      steps: draft.steps.map((step, i) => i === index ? { ...step, target } : step),
    })
  const addCommandStep = (): void =>
    onChange({ ...draft, steps: [...draft.steps, { command: '', target: 'current' }] })
  const removeStep = (index: number): void =>
    onChange({ ...draft, steps: draft.steps.filter((_, i) => i !== index) })

  return (
    <div className="dsh-codex-quick-actions-editor">
      <div className="dsh-codex-quick-actions-field">
        <span className="dsh-codex-quick-actions-fieldLabel">{t('quickActions.name')}</span>
        <input
          className="dsh-codex-quick-actions-input"
          value={draft.name}
          onChange={event => setName(event.currentTarget.value)}
          placeholder={t('quickActions.name')}
        />
      </div>

      {draft.steps.map((step, index) => (
        <div key={index} className="dsh-codex-quick-actions-step">
          <div className="dsh-codex-quick-actions-stepHead">
            <span className="dsh-codex-quick-actions-stepTitle">{t('quickActions.command')}</span>
            <Menu
              open={openTargetIndex === index}
              items={targetItems}
              portal
              dense
              side="bottom"
              align="end"
              selectedIds={[step.target]}
              anchor={(
                <Button
                  variant="outline"
                  size="sm"
                  aria-haspopup="menu"
                  aria-expanded={openTargetIndex === index}
                  onClick={() => setOpenTargetIndex(current => current === index ? null : index)}
                >
                  <span>
                    {step.target === 'current' ? t('quickActions.currentTerminal') : t('quickActions.newTerminal')}
                  </span>
                  <IconChevronDownOutline14 size={14} />
                </Button>
              )}
              onSelect={id => {
                setStepTarget(index, id as QuickActionTarget)
                setOpenTargetIndex(null)
              }}
              onClose={() => setOpenTargetIndex(null)}
            />
            <button
              type="button"
              className="dsh-codex-quick-actions-stepRemove"
              onClick={() => removeStep(index)}
            >
              {t('quickActions.delete')}
            </button>
          </div>

          <textarea
            className="dsh-codex-quick-actions-textarea"
            value={step.command}
            onChange={event => setCommandField(index, event.currentTarget.value)}
            placeholder={t('quickActions.command')}
            rows={3}
          />
        </div>
      ))}

      <button
        type="button"
        className="dsh-codex-quick-actions-secondary"
        onClick={addCommandStep}
      >
        <IconPlusOutline16 size={14} />
        {t('quickActions.addCommand')}
      </button>
    </div>
  )
}

// Inline styles for the floating trigger only — the manager page's visual
// language lives in the injected QUICK_ACTIONS_CSS sheet above.

const controlsStyle: CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '6px',
}

const triggerButtonStyle: CSSProperties = {
  gap: '6px',
}

const errorStyle: CSSProperties = {
  margin: 0,
  maxWidth: 280,
  fontSize: 12,
  lineHeight: '16px',
  color: 'var(--dsw-alias-state-error-primary, #f43f5e)',
}
