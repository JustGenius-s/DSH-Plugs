import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button, IconChevronDownOutline14, Input, Menu, injectStyles, type MenuEntry } from '@just-genius/dsh-plugin-ui'
import { FONT_PREFERENCE_MAX_LENGTH, UI_FONT_FALLBACK, fontFamilyStack, type FontPreferenceKey } from '../../shared/fonts'
import { filterFontFamilies, fontMenuIndex, type FontCatalog, type FontCatalogSnapshot } from '../features/fonts/catalog'
import type { CodexKey } from '../locales'

injectStyles('@just-genius/dsh-codex', '@just-genius/dsh-codex/font-picker.css', `
.dsh-codex-font-picker{display:flex;width:100%;min-width:0}
.dsh-codex-font-anchor{display:flex;width:100%;min-width:0;align-items:center;position:relative}
.dsh-codex-font-input{display:flex;box-sizing:border-box;width:100%;min-width:0;padding-right:32px}
.dsh-codex-font-input input{width:100%;font-family:inherit}
.dsh-codex-font-anchor .dsh-codex-font-toggle{position:absolute;right:2px;width:28px;height:28px;padding:0;border-radius:6px}
.dsh-codex-font-menu[role="menu"]{width:320px;min-width:0;max-width:calc(100vw - 24px);max-height:min(320px,50vh);font-family:var(--dsw-font-family);font-weight:400}
.dsh-codex-font-menu [role="menuitem"]{font-family:inherit;font-weight:400}
.dsh-codex-font-menu [role="menuitem"]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsh-codex-font-option{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsh-codex-font-name{overflow:hidden;text-overflow:ellipsis}
.dsh-codex-font-sample{flex:none;color:var(--dsw-alias-label-secondary)}
`)

export function FontPicker(props: {
  id: string
  field: FontPreferenceKey
  value: string
  disabled: boolean
  catalog: FontCatalog
  snapshot: FontCatalogSnapshot
  t: (key: CodexKey) => string
  onChange: (value: string) => void
  onApply: () => void
}) {
  const { id, field, value, disabled, catalog, snapshot, t, onChange, onApply } = props
  const anchorRef = useRef<HTMLDivElement>(null)
  const defaultLabelRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [side, setSide] = useState<'top' | 'bottom'>('bottom')
  const [focusEdge, setFocusEdge] = useState<'first' | 'last' | null>(null)
  const matches = filterFontFamilies(snapshot.families, query, field)
  const focusInput = () => anchorRef.current?.querySelector('input')?.focus()
  const closeMenu = () => { setOpen(false); setFocusEdge(null) }
  const menuButtons = () => [...(defaultLabelRef.current?.closest('[role="menu"]')
    ?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? [])]

  const showMenu = () => {
    if (disabled) return
    // Call directly from the gesture so the browser can request local-font access.
    void catalog.load()
    const rect = anchorRef.current?.getBoundingClientRect()
    if (rect !== undefined) setSide(rect.top > window.innerHeight - rect.bottom ? 'top' : 'bottom')
    setOpen(true)
  }

  useEffect(() => {
    if (!open || focusEdge === null || snapshot.status === 'loading') return
    const buttons = menuButtons()
    const index = focusEdge === 'last' ? buttons.length - 1 : query.trim() && matches.length > 0 ? 1 : 0
    buttons[index]?.focus()
    buttons[index]?.scrollIntoView({ block: 'nearest' })
    setFocusEdge(null)
  }, [open, focusEdge, snapshot.status, query, matches.length])

  useEffect(() => { if (disabled) { setOpen(false); setFocusEdge(null) } }, [disabled])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      closeMenu()
      focusInput()
      return
    }
    if (anchorRef.current?.contains(event.target as Node)) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        showMenu()
        setFocusEdge(event.key === 'ArrowDown' ? 'first' : 'last')
      } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
        event.preventDefault()
        closeMenu()
        onApply()
      } else if (event.key === 'Tab') {
        closeMenu()
      }
      return
    }
    const buttons = menuButtons()
    const current = buttons.indexOf(event.target as HTMLButtonElement)
    if (current < 0) return
    const next = fontMenuIndex(buttons.length, current, event.key)
    if (next !== undefined) {
      event.preventDefault()
      buttons[next]?.focus()
      buttons[next]?.scrollIntoView({ block: 'nearest' })
    } else if (event.key === 'Tab') {
      closeMenu()
      focusInput()
    }
  }

  const statusKey: CodexKey | undefined = snapshot.status === 'ready' ? undefined
    : snapshot.status === 'unavailable' ? 'fonts.unavailable'
      : snapshot.status === 'denied' ? 'fonts.denied'
        : snapshot.status === 'error' ? 'fonts.loadFailed' : 'fonts.loading'
  const items: MenuEntry[] = [
    { id: 'default', label: <span ref={defaultLabelRef}>{t('fonts.defaultChoice')}</span> },
    { type: 'separator', id: 'separator' },
  ]
  if (snapshot.status === 'ready' || snapshot.families.length > 0) {
    items.push({ type: 'label', id: 'count', text: t('fonts.count').replace('{shown}', String(matches.length)).replace('{total}', String(snapshot.families.length)) })
  }
  if (statusKey !== undefined) items.push({ type: 'label', id: 'status', text: t(statusKey) })
  if (snapshot.status === 'ready' && matches.length === 0) {
    items.push({ type: 'label', id: 'empty', text: t(query.trim() ? 'fonts.noMatches' : 'fonts.empty') })
  }
  items.push(...matches.map(family => ({
    id: `font:${family}`,
    label: <span className="dsh-codex-font-option" title={family}>
      <span className="dsh-codex-font-name">{family}</span>
      <span className="dsh-codex-font-sample" aria-hidden="true" style={{ fontFamily: fontFamilyStack(family, UI_FONT_FALLBACK) }}>Aa 字</span>
    </span>,
  })))

  return <div onKeyDown={onKeyDown} style={{ flex: '1 1 240px', minWidth: 0 }}>
    <Menu
      className="dsh-codex-font-picker"
      listClassName="dsh-codex-font-menu"
      open={open && !disabled}
      portal
      dense
      side={side}
      // Re-measure when loading or searching changes the menu's height.
      getAnchorRect={() => anchorRef.current?.getBoundingClientRect() ?? null}
      items={items}
      selectedId={value.trim() === '' ? 'default' : `font:${value.trim()}`}
      footer={[{ id: 'refresh', label: t('fonts.refresh'), disabled: snapshot.status === 'loading' || snapshot.status === 'unavailable' }]}
      onClose={closeMenu}
      onSelect={selected => {
        if (selected === 'refresh') {
          void catalog.load(true)
          focusInput()
          return
        }
        onChange(selected === 'default' ? '' : selected.slice('font:'.length))
        closeMenu()
        setQuery('')
        focusInput()
      }}
      anchor={<div ref={anchorRef} className="dsh-codex-font-anchor">
        <Input
          className="dsh-codex-font-input"
          id={id}
          value={value}
          placeholder={t('fonts.search')}
          maxLength={FONT_PREFERENCE_MAX_LENGTH}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-describedby={`${id}-preview`}
          onClick={() => { if (!open) { setQuery(''); showMenu() } }}
          onChange={event => {
            const next = event.currentTarget.value
            onChange(next)
            setQuery(next)
            showMenu()
          }}
        />
        <Button
          className="dsh-codex-font-toggle"
          size="sm"
          variant="ghost"
          disabled={disabled}
          aria-label={t('fonts.choose')}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            if (open) closeMenu()
            else { setQuery(''); showMenu() }
            focusInput()
          }}
        ><IconChevronDownOutline14 /></Button>
      </div>}
    />
  </div>
}
