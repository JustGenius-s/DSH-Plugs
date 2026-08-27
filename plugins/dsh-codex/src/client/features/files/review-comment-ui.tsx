import {
  createElement,
  type ComponentType,
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CodexKey } from '../../locales'
import { fileIconSvg } from './file-icons'
import {
  FILE_REVIEW_COMMENT_SOURCE,
  type FileReviewSide,
  type ReviewCommentEntry,
} from './review-comment'

const CHAT_NODE_SLOT = 'conversation.chat.node'
const INPUT_DOCK_SLOT = 'conversation.input.dock'
const CONVERSATION_NS = 'conversation'

interface ReviewCommentModel {
  get(ref: string): ReviewCommentEntry | undefined
  remove(ref: string): void
  all(sessionId: string): ReviewCommentEntry[]
}

interface SerializedReviewComment {
  path: string
  side: FileReviewSide
  startLine: number
  endLine: number
  body: string
  code: string
}

interface ActiveReviewComment {
  occurrenceId: number
  offset: number
  entry: ReviewCommentEntry
}

type DockProps = PropsRuntime<'conversation.input.dock'>
type UserNodeProps = ChatNodeViewProps<'user' | 'steering'>
type NativeUserRenderer = ComponentType<UserNodeProps>

/**
 * Project review comments as attachment cards in both places Codex keeps them:
 * above the composer while drafting, and above the durable user message after
 * send. The U+FFFC reference remains the submission transport only.
 */
export function registerFileReviewCommentUi(
  ctx: ClientContext,
  model: ReviewCommentModel,
  t: (key: CodexKey) => string,
): () => void {
  const disposeDock = ctx.slots.inject(INPUT_DOCK_SLOT, () => ctx.slots.register(
    {
      name: INPUT_DOCK_SLOT,
      id: 'codex-file-review-comments',
      order: -20,
      locale: 'settings.codex' as never,
    },
    function ReviewCommentDockSlot(props: DockProps) {
      return <ReviewCommentDock {...props} model={model} t={t} />
    } as never,
  ))

  const disposeUser = registerUserNodeDecorator(ctx, 'user', model, t)
  const disposeSteering = registerUserNodeDecorator(ctx, 'steering', model, t)

  return () => {
    disposeSteering()
    disposeUser()
    disposeDock()
  }
}

function registerUserNodeDecorator(
  ctx: ClientContext,
  key: 'user' | 'steering',
  model: ReviewCommentModel,
  codexT: (key: CodexKey) => string,
): () => void {
  return ctx.slots.inject(CHAT_NODE_SLOT, () => {
    const native = findNativeUserRenderer(ctx.slots.entries(CHAT_NODE_SLOT), key)
    if (native === undefined) return () => {}
    return ctx.slots.register(
      {
        name: CHAT_NODE_SLOT,
        key,
        priority: -20,
        locale: CONVERSATION_NS as never,
      },
      function ReviewUserMessageSlot(props: UserNodeProps) {
        return <ReviewUserMessage native={native} props={props} t={codexT} />
      } as never,
    )
  })
}

function findNativeUserRenderer(
  entries: readonly StoredEntry[],
  key: 'user' | 'steering',
): NativeUserRenderer | undefined {
  const entry = entries.find(candidate => candidate.options.key === key
    && (candidate.options.priority ?? 0) >= 0)
  return entry?.component as NativeUserRenderer | undefined
}

function ReviewCommentDock({
  sessionId,
  input,
  inputActions,
  model,
  t,
}: DockProps & {
  model: ReviewCommentModel
  t: (key: CodexKey) => string
}): ReactElement | null {
  const root = useRef<HTMLSpanElement>(null)
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null)
  const active = input.occurrences.flatMap((occurrence): ActiveReviewComment[] => {
    if (occurrence.source !== FILE_REVIEW_COMMENT_SOURCE) return []
    const entry = model.get(occurrence.ref)
    return entry === undefined ? [] : [{
      occurrenceId: occurrence.occurrenceId,
      offset: occurrence.offset,
      entry,
    }]
  })
  const occurrenceKey = active.map(comment => comment.occurrenceId).join(',')

  // Reconcile the store with the draft: a review comment whose reference was
  // edited away in the composer (Backspace/Enter on the @file:line chip)
  // disappears from `input.occurrences` but would otherwise stay pinned in
  // the diff, because entries outlive the draft. Drop any entry whose ref is
  // no longer present in the draft's occurrences.
  const reviewRefs = input.occurrences
    .filter(occurrence => occurrence.source === FILE_REVIEW_COMMENT_SOURCE)
    .map(occurrence => occurrence.ref)
  const activeRefs = new Set(reviewRefs)
  const refsKey = reviewRefs.join(',')
  useEffect(() => {
    const stale = model.all(sessionId).filter(entry => !activeRefs.has(entry.ref))
    for (const entry of stale) model.remove(entry.ref)
  }, [sessionId, refsKey])

  useLayoutEffect(() => {
    if (active.length === 0) {
      setPortalHost(null)
      return
    }
    const card = findComposerCard(root.current)
    const scroll = card?.querySelector<HTMLElement>(':scope > [data-input-scroll="true"]')
    if (card === undefined || scroll === null || scroll === undefined) return
    const host = document.createElement('div')
    host.className = 'dsh-files-review-composer-host'
    host.dataset.reviewCommentAttachments = 'true'
    card.insertBefore(host, scroll)
    setPortalHost(host)
    return () => {
      host.remove()
    }
  }, [occurrenceKey])

  if (active.length === 0) return null

  // One summary attachment for the whole batch, Codex-style: a comment icon +
  // "{count} comments" pill. Removing it drops every review comment in the
  // draft (they are one attachment, not one attachment per comment).
  const removeAll = (): void => {
    const occurrences = [...input.occurrences]
      .filter(occurrence => occurrence.source === FILE_REVIEW_COMMENT_SOURCE)
      .sort((a, b) => b.offset - a.offset)
    for (const comment of active) model.remove(comment.entry.ref)
    let draft = input.draft
    for (const occurrence of occurrences) {
      // The occurrence is `@<label>` (label now visible, e.g. `src/a.ts:12`)
      // followed by the machine's separator space when one was appended.
      let end = occurrence.offset + 1 + occurrence.label.length
      if (draft[end] === ' ') end += 1
      draft = draft.slice(0, occurrence.offset) + draft.slice(end)
    }
    inputActions.setDraft(draft)
  }

  return (
    <>
      <span className="dsh-files-review-dock-anchor" ref={root} aria-hidden />
      {portalHost !== null && createPortal(
        <div className="dsh-files-review-rail" aria-label={t('files.reviewAttachments')}>
          <ReviewCommentsSummary
            comments={active.map(comment => comment.entry)}
            t={t}
            removeLabel={t('files.reviewRemove')}
            onRemove={removeAll}
          />
        </div>,
        portalHost,
      )}
    </>
  )
}

function findComposerCard(anchor: HTMLElement | null): HTMLElement | undefined {
  let parent = anchor?.parentElement
  for (let depth = 0; depth < 6 && parent !== null && parent !== undefined; depth += 1) {
    const card = parent.querySelector<HTMLElement>('[data-composer-card="true"]')
    if (card !== null) return card
    parent = parent.parentElement
  }
  return undefined
}

function ReviewUserMessage({
  native: Native,
  props,
  t,
}: {
  native: NativeUserRenderer
  props: UserNodeProps
  t: (key: CodexKey) => string
}): ReactElement {
  const data = props.node.data
  const projected = projectReviewComments(data.content)
  if (projected.comments.length === 0) return createElement(Native, props)

  const node = {
    ...props.node,
    data: {
      ...data,
      content: projected.content,
    },
  } as UserNodeProps['node']

  return (
    <div className="dsh-files-review-message">
      <div className="dsh-files-review-message-rail" aria-label={t('files.reviewAttachments')}>
        <ReviewCommentsSummary comments={projected.comments} t={t} />
      </div>
      {createElement(Native, { ...props, node } as UserNodeProps)}
    </div>
  )
}

/**
 * One comment attachment, Codex-style: a single comment icon + "{count}
 * comments" summary pill (not one tile per comment). Hovering opens a
 * content popover above the pill — DSH Tooltip is string-only, and HoverCard
 * only opens to the right, so the popover is custom (Codex uses Radix
 * Popover side=top with the same path / side / line / body payload).
 */
function ReviewCommentsSummary({
  comments,
  removeLabel,
  onRemove,
  t,
}: {
  comments: readonly (ReviewCommentEntry | SerializedReviewComment)[]
  removeLabel?: string
  onRemove?: () => void
  t: (key: CodexKey) => string
}): ReactElement {
  const count = comments.length
  const summary = count === 1
    ? t('files.reviewSummaryOne')
    : t('files.reviewSummaryMany').replace('{count}', String(count))

  return (
    <ReviewCommentHover comments={comments} t={t}>
      <span className="dsh-files-review-summary">
        <span className="dsh-files-review-summary-icon" aria-hidden>
          <CommentGlyph />
        </span>
        <span className="dsh-files-review-summary-label">{summary}</span>
        {onRemove !== undefined && removeLabel !== undefined && (
          <button
            type="button"
            className="dsh-files-review-summary-remove"
            aria-label={removeLabel}
            onClick={event => {
              event.stopPropagation()
              onRemove()
            }}
          >
            <IconCloseOutline16 size={14} />
          </button>
        )}
      </span>
    </ReviewCommentHover>
  )
}

const POPOVER_CLOSE_MS = 100
const POPOVER_GAP = 8
const POPOVER_MARGIN = 8

function ReviewCommentHover({
  comments,
  t,
  children,
}: {
  comments: readonly (ReviewCommentEntry | SerializedReviewComment)[]
  t: (key: CodexKey) => string
  children: ReactElement
}): ReactElement {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number, left: number } | null>(null)

  const cancelClose = (): void => {
    if (closeTimer.current === null) return
    window.clearTimeout(closeTimer.current)
    closeTimer.current = null
  }

  const show = (): void => {
    cancelClose()
    setOpen(true)
  }

  const hideSoon = (): void => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setOpen(false)
      setPos(null)
    }, POPOVER_CLOSE_MS)
  }

  useEffect(() => () => cancelClose(), [])

  useLayoutEffect(() => {
    if (!open) return
    const anchor = anchorRef.current
    const card = cardRef.current
    if (anchor === null || card === null) return
    const a = anchor.getBoundingClientRect()
    const c = card.getBoundingClientRect()
    let top = a.top - c.height - POPOVER_GAP
    if (top < POPOVER_MARGIN) {
      top = Math.min(
        a.bottom + POPOVER_GAP,
        window.innerHeight - c.height - POPOVER_MARGIN,
      )
    }
    const maxLeft = window.innerWidth - c.width - POPOVER_MARGIN
    const left = Math.min(Math.max(POPOVER_MARGIN, a.left), Math.max(POPOVER_MARGIN, maxLeft))
    setPos({ top, left })
  }, [open, comments])

  return (
    <>
      <span
        ref={anchorRef}
        className="dsh-files-review-hover-anchor"
        onMouseEnter={show}
        onMouseLeave={hideSoon}
      >
        {children}
      </span>
      {open && createPortal(
        <div
          ref={cardRef}
          className="dsh-files-review-popover-card"
          role="tooltip"
          style={pos === null
            ? { visibility: 'hidden', top: 0, left: 0 }
            : { top: pos.top, left: pos.left }}
          onMouseEnter={show}
          onMouseLeave={hideSoon}
        >
          <div className="dsh-files-review-popover">
            {comments.map((comment, index) => (
              <ReviewCommentPreview
                key={`${comment.path}:${comment.startLine}:${comment.endLine}:${index}`}
                comment={comment}
                t={t}
              />
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

function ReviewCommentPreview({
  comment,
  t,
}: {
  comment: ReviewCommentEntry | SerializedReviewComment
  t: (key: CodexKey) => string
}): ReactElement {
  const name = basename(comment.path)
  const range = comment.startLine === comment.endLine
    ? String(comment.endLine)
    : `${comment.startLine}–${comment.endLine}`
  const side = comment.side === 'old'
    ? t('files.reviewSideOld')
    : comment.side === 'new'
      ? t('files.reviewSideNew')
      : ''
  const location = side === '' ? range : `${side} ${range}`

  return (
    <div className="dsh-files-review-preview">
      <div className="dsh-files-review-preview-header">
        <span
          className="dsh-files-file-glyph"
          aria-hidden
          dangerouslySetInnerHTML={{ __html: fileIconSvg(name) }}
        />
        <span className="dsh-files-review-preview-path" title={comment.path}>
          {comment.path}
        </span>
        <span className="dsh-files-review-preview-loc">{location}</span>
      </div>
      {comment.body !== '' && (
        <p className="dsh-files-review-body">{comment.body}</p>
      )}
    </div>
  )
}

function basename(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? path : path.slice(slash + 1)
}

/** Lucide message-square-text glyph for the comment-attachment chip. */
function CommentGlyph(): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
      <path d="M7 11h10" />
      <path d="M7 15h6" />
      <path d="M7 7h8" />
    </svg>
  )
}

function projectReviewComments(content: readonly unknown[]): {
  content: readonly unknown[]
  comments: SerializedReviewComment[]
} {
  const comments: SerializedReviewComment[] = []
  const projected = content.flatMap((raw): unknown[] => {
    if (!isTextBlock(raw)) return [raw]
    const parsed = parseSerializedReviewComments(raw.text)
    comments.push(...parsed.comments)
    return parsed.text === '' ? [] : [{ ...raw, text: parsed.text }]
  })
  return { content: projected, comments }
}

export function parseSerializedReviewComments(text: string): {
  text: string
  comments: SerializedReviewComment[]
} {
  const comments: SerializedReviewComment[] = []
  const projected = text.replace(
    /\n?<file_review_comment\b([^>]*)>\n?([\s\S]*?)<\/file_review_comment>\n?/g,
    (_whole, rawAttributes: string, rawBody: string) => {
      const attributes = parseAttributes(rawAttributes)
      const splitAt = rawBody.lastIndexOf('\n\nSelected source:\n')
      const body = (splitAt === -1 ? rawBody : rawBody.slice(0, splitAt)).trim()
      const code = splitAt === -1
        ? ''
        : rawBody.slice(splitAt + '\n\nSelected source:\n'.length)
          .replace(/^    /gm, '')
          .trim()
      const range = parseRange(attributes.range)
      const startLine = positiveLine(attributes.start_line) ?? range.start
      const endLine = positiveLine(attributes.end_line) ?? range.end
      const path = decodeEntities(attributes.path ?? '')
      if (path !== '' && body !== '') {
        comments.push({
          path,
          side: parseSide(attributes.side),
          startLine,
          endLine,
          body,
          code: code === '(source unavailable)' ? '' : code,
        })
      }
      return ''
    },
  )
  return {
    text: projected.replace(/^\s*\n|\n\s*$/g, '').trim(),
    comments,
  }
}

function parseAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of value.matchAll(/([\w-]+)="([^"]*)"/g)) {
    if (match[1] !== undefined && match[2] !== undefined) attributes[match[1]] = match[2]
  }
  return attributes
}

function parseRange(value: string | undefined): { start: number; end: number } {
  const numbers = value?.match(/\d+/g)?.map(Number) ?? []
  const start = numbers[0] ?? 1
  return { start, end: numbers[1] ?? start }
}

function positiveLine(value: string | undefined): number | undefined {
  const line = Number(value)
  return Number.isInteger(line) && line > 0 ? line : undefined
}

function parseSide(value: string | undefined): FileReviewSide {
  if (value === 'old' || value?.startsWith('original') === true) return 'old'
  if (value === 'new' || value?.startsWith('modified') === true) return 'new'
  return 'file'
}

function decodeEntities(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&')
}

function isTextBlock(value: unknown): value is { type: 'text'; text: string } {
  return typeof value === 'object' && value !== null
    && (value as { type?: unknown }).type === 'text'
    && typeof (value as { text?: unknown }).text === 'string'
}
