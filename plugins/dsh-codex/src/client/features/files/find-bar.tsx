/**
 * The find widget above the code/diff scrollport (VS Code's find widget:
 * input, three option toggles, match count, prev/next, close).
 */
import {
  IconChevronDownOutline14,
  IconChevronUpOutline14,
  IconCloseOutline16,
} from '@just-genius/dsh-plugin-ui'
import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from 'react'
import type { FindOptions } from './find-model'
import type { ViewLabels } from './view-labels'

export function FindBar(props: {
  labels: ViewLabels
  query: string
  options: FindOptions
  matchCount: number
  activeIndex: number
  invalidRegex: boolean
  inputRef: MutableRefObject<HTMLInputElement | null>
  onQueryChange: (value: string) => void
  onOptionsChange: (patch: Partial<FindOptions>) => void
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void
}) {
  const {
    labels, query, options, matchCount, activeIndex, invalidRegex, inputRef,
    onQueryChange, onOptionsChange, onPrev, onNext, onClose, onKeyDown,
  } = props
  const countLabel = query.length === 0
    ? ''
    : invalidRegex
      ? labels.findInvalidRegex
      : matchCount === 0
        ? labels.findNoResults
        : labels.findMatchCount(activeIndex + 1, matchCount)
  return (
    <div className="dsh-files-find" role="search">
      <input
        ref={(node) => { inputRef.current = node }}
        className={
          'dsh-files-find-input'
          + (invalidRegex && query.length > 0 ? ' is-invalid' : '')
        }
        type="search"
        value={query}
        placeholder={labels.findPlaceholder}
        aria-label={labels.findPlaceholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <div className="dsh-files-find-toggles" role="group">
        <button
          type="button"
          className={
            'dsh-files-find-toggle'
            + (options.matchCase ? ' is-active' : '')
          }
          title={labels.findMatchCase}
          aria-label={labels.findMatchCase}
          aria-pressed={options.matchCase}
          onClick={() => onOptionsChange({ matchCase: !options.matchCase })}
        >
          Aa
        </button>
        <button
          type="button"
          className={
            'dsh-files-find-toggle'
            + (options.wholeWord ? ' is-active' : '')
          }
          title={labels.findWholeWord}
          aria-label={labels.findWholeWord}
          aria-pressed={options.wholeWord}
          onClick={() => onOptionsChange({ wholeWord: !options.wholeWord })}
        >
          <span className="dsh-files-find-whole" aria-hidden>
            <span className="dsh-files-find-whole-bar" />
            ab
            <span className="dsh-files-find-whole-bar" />
          </span>
        </button>
        <button
          type="button"
          className={
            'dsh-files-find-toggle'
            + (options.regex ? ' is-active' : '')
          }
          title={labels.findRegex}
          aria-label={labels.findRegex}
          aria-pressed={options.regex}
          onClick={() => onOptionsChange({ regex: !options.regex })}
        >
          .*
        </button>
      </div>
      <span
        className={
          'dsh-files-find-count'
          + (invalidRegex && query.length > 0 ? ' is-invalid' : '')
        }
        aria-live="polite"
      >
        {countLabel}
      </span>
      <button
        type="button"
        className="dsh-files-find-btn"
        title={labels.findPrev}
        aria-label={labels.findPrev}
        disabled={matchCount === 0}
        onClick={onPrev}
      >
        <IconChevronUpOutline14 size={14} />
      </button>
      <button
        type="button"
        className="dsh-files-find-btn"
        title={labels.findNext}
        aria-label={labels.findNext}
        disabled={matchCount === 0}
        onClick={onNext}
      >
        <IconChevronDownOutline14 size={14} />
      </button>
      <button
        type="button"
        className="dsh-files-find-btn"
        title={labels.findClose}
        aria-label={labels.findClose}
        onClick={onClose}
      >
        <IconCloseOutline16 size={14} />
      </button>
    </div>
  )
}
