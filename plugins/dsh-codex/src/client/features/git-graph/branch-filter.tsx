import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Button,
  IconBranchOutline16,
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconSearchOutline16,
  Input,
} from '@just-genius/dsh-plugin-ui'
import {
  GIT_GRAPH_ALL_SCOPE,
  type GitGraphScopeRef,
} from '../../../shared/git-graph'

export function toggleScope(
  id: string,
  current: readonly string[],
  fallback: string,
): string[] {
  if (id === GIT_GRAPH_ALL_SCOPE) return [GIT_GRAPH_ALL_SCOPE]
  const withoutAll = current.filter((item) => item !== GIT_GRAPH_ALL_SCOPE)
  if (withoutAll.includes(id)) {
    const next = withoutAll.filter((item) => item !== id)
    return next.length === 0 ? [fallback] : next
  }
  return [...withoutAll, id]
}

export function scopeFallback(refs: readonly GitGraphScopeRef[]): string {
  return refs.find((ref) => ref.current === true)?.fullName ?? 'HEAD'
}

export function scopeLabel(
  selected: readonly string[],
  refs: readonly GitGraphScopeRef[],
  t: (key: string) => string,
): string {
  if (selected.includes(GIT_GRAPH_ALL_SCOPE)) return t('gitGraph.filterAll')
  const names = selected
    .map((id) => refs.find((ref) => ref.fullName === id)?.name ?? id)
    .filter((name) => name.length > 0)
  if (names.length === 0) return t('gitGraph.filterAll')
  if (names.length === 1) return names[0] ?? t('gitGraph.filterAll')
  return `${names[0]} +${String(names.length - 1)}`
}

export function BranchFilter(props: {
  refs: readonly GitGraphScopeRef[]
  selected: readonly string[]
  t: (key: string) => string
  onToggle: (id: string) => void
}) {
  const { refs, selected, t, onToggle } = props
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState<{
    left: number
    top: number
    width: number
  } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const matches = useMemo(() => filterRefs(refs, query), [query, refs])
  const showAll = queryMatches(t('gitGraph.filterAll'), query)

  useEffect(() => {
    if (open) return
    setQuery('')
    setPos(null)
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const trigger = triggerRef.current?.getBoundingClientRect()
      const pop = popRef.current
      if (trigger === undefined || pop === null) return
      const width = Math.min(280, Math.max(240, trigger.width))
      const height = pop.offsetHeight
      const vw = window.innerWidth
      const vh = window.innerHeight
      let left = trigger.left
      let top = trigger.bottom + 4
      left = Math.min(Math.max(left, 12), Math.max(12, vw - width - 12))
      if (top + height > vh - 12) {
        top = Math.max(12, trigger.top - height - 4)
      }
      setPos({ left, top, width })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [matches, open, query, showAll])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (rootRef.current?.contains(event.target) === true) return
      if (popRef.current?.contains(event.target) === true) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (refs.length === 0) return null

  const onSearchKey = (event: { key: string; preventDefault(): void }) => {
    if (event.key !== 'Enter') return
    const first = showAll ? GIT_GRAPH_ALL_SCOPE : matches[0]?.fullName
    if (first === undefined) return
    event.preventDefault()
    onToggle(first)
  }

  return (
    <div className="dsh-git-graph-filter" ref={rootRef}>
      <span className="dsh-git-graph-filter-wrap" ref={triggerRef}>
        <Button
          type="button"
          size="sm"
          variant="toolbar"
          className="dsh-git-graph-filter-trigger"
          aria-label={t('gitGraph.filterLabel')}
          aria-haspopup="listbox"
          aria-expanded={open}
          icon={<IconBranchOutline16 />}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="dsh-git-graph-filter-name">
            {scopeLabel(selected, refs, t)}
          </span>
          <IconChevronDownOutline14 aria-hidden="true" />
        </Button>
      </span>
      {open && typeof document !== 'undefined'
        ? createPortal(
          <div
            ref={popRef}
            className="dsh-git-graph-filter-pop"
            role="listbox"
            aria-label={t('gitGraph.filterLabel')}
            aria-multiselectable="true"
            style={pos === null
              ? { visibility: 'hidden', left: 0, top: 0 }
              : { left: pos.left, top: pos.top, width: pos.width }}
          >
            <div className="dsh-git-graph-filter-search">
              <Input
                autoFocus
                className="dsh-git-graph-filter-query"
                icon={<IconSearchOutline16 />}
                placeholder={t('gitGraph.filterSearch')}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={onSearchKey}
              />
            </div>
            <div className="dsh-git-graph-filter-list">
              {showAll ? (
                <FilterItem
                  id={GIT_GRAPH_ALL_SCOPE}
                  label={t('gitGraph.filterAll')}
                  selected={selected.includes(GIT_GRAPH_ALL_SCOPE)}
                  onToggle={onToggle}
                />
              ) : null}
              <FilterGroups
                refs={matches}
                selected={selected}
                t={t}
                onToggle={onToggle}
              />
              {!showAll && matches.length === 0 ? (
                <div className="dsh-git-graph-filter-empty">
                  {t('gitGraph.filterEmpty')}
                </div>
              ) : null}
            </div>
          </div>,
          document.body,
        )
        : null}
    </div>
  )
}

function FilterGroups(props: {
  refs: readonly GitGraphScopeRef[]
  selected: readonly string[]
  t: (key: string) => string
  onToggle: (id: string) => void
}) {
  return (
    <>
      {renderGroup(props, 'head', props.t('gitGraph.filterHead'))}
      {renderGroup(props, 'branch', props.t('gitGraph.filterBranches'))}
      {renderGroup(props, 'remote', props.t('gitGraph.filterRemotes'))}
      {renderGroup(props, 'tag', props.t('gitGraph.filterTags'))}
    </>
  )
}

function renderGroup(
  props: {
    refs: readonly GitGraphScopeRef[]
    selected: readonly string[]
    onToggle: (id: string) => void
  },
  type: GitGraphScopeRef['type'],
  label: string,
) {
  const group = props.refs.filter((ref) => ref.type === type)
  if (group.length === 0) return null
  return (
    <div key={type}>
      <div className="dsh-git-graph-filter-group">{label}</div>
      {group.map((ref) => (
        <FilterItem
          key={ref.fullName}
          id={ref.fullName}
          label={ref.name}
          selected={props.selected.includes(ref.fullName)}
          onToggle={props.onToggle}
        />
      ))}
    </div>
  )
}

function FilterItem(props: {
  id: string
  label: string
  selected: boolean
  onToggle: (id: string) => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={props.selected}
      className={'dsh-git-graph-filter-item'
        + (props.selected ? ' is-selected' : '')}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => props.onToggle(props.id)}
    >
      <span className="dsh-git-graph-filter-item-name">{props.label}</span>
      {props.selected
        ? <IconCheckOutline16 className="dsh-git-graph-filter-check" />
        : null}
    </button>
  )
}

function filterRefs(
  refs: readonly GitGraphScopeRef[],
  query: string,
): GitGraphScopeRef[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return [...refs]
  return refs.filter((ref) => queryMatches(ref.name, needle)
    || queryMatches(ref.fullName, needle))
}

function queryMatches(value: string, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return true
  return value.toLowerCase().includes(needle)
}
