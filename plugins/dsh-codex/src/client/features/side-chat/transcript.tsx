/**
 * Side-chat transcript: renders the session's Chat presentation nodes with
 * the same primitives the main conversation uses (DisclosureRow Think/tool
 * rows, MarkdownText, MessageText, TerminalBlock). Side chats stay compact:
 * no details panel, no turn-tail actions, no queue chrome.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  AssistantBlock,
  ChatConversationViewNode,
  ConversationSnapshot,
} from '@just-genius/dsh-plugin-runtime/client'
import type {
  ContentBlock,
  ImageAttachmentRefLike,
  ToolCallBlock,
  ToolCallView,
  ToolResultNode,
  ToolResultView,
} from './types'
import {
  CodeBlock,
  DisclosureRow,
  IconApiOutline14,
  IconBrowseOutline16,
  IconChecklistOutline14,
  IconChevronDownOutline14,
  IconCodeOutline16,
  IconEditOutline16,
  IconGlobeOutline14,
  IconLinkOutline14,
  IconNewChatOutline16,
  IconQuestionOutline14,
  IconSearchOutline16,
  IconSkillOutline16,
  IconSparkle16,
  IconThinkOutline14,
  IconUserOutline16,
  DiffBlock,
  JsonBlock,
  MessageText,
  OfficialMarkdownText,
  ReadBlock,
  SearchBlock,
  TerminalBlock,
  type MarkdownCodeLabels,
} from '@just-genius/dsh-plugin-ui'
import {
  chatRowsOf,
  contextRowsOf,
  hasVisibleContent,
  pendingSteeringOf,
} from './snapshot'
import {
  isTerminalCall,
  toolPresentation,
  variantTitle,
  type ToolState,
  type ToolVariant,
} from './tool-presentation'
import type { SideChatContextState } from '../../../shared/side-chat'

/** Distance from the bottom (px) that still counts as "following". */
const PIN_THRESHOLD = 48

const CODE_LABELS: MarkdownCodeLabels = { copyLabel: '复制', copiedLabel: '已复制' }

/** Characters of a tool result kept inline before it is cut with a marker. */
const RESULT_PREVIEW_CHARS = 4000

/**
 * Height cap for the forwarded read/diff/search cards, in content lines.
 *
 * The official primitives collapse their middle past this many lines, so a
 * 2 000-line read cannot push the rest of the transcript off-screen in a side
 * panel. Matches the primitives' own default (16) so these cards cut at the
 * same place the main chat's cards do.
 */
const SIDE_PANEL_MAX_LINES = 16

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function latestLine(text: string): string {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}

function asRecord(data: unknown): Record<string, unknown> | null {
  return typeof data === 'object' && data !== null ? data as Record<string, unknown> : null
}

function textOfContent(content: readonly unknown[]): string {
  return content
    .filter((block): block is { type?: string; text?: string } =>
      typeof block === 'object' && block !== null
      && (block as { type?: unknown }).type === 'text')
    .map(block => String(block.text ?? ''))
    .join('')
}

function parseArgs(raw: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(raw) as unknown
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function pickString(args: Record<string, unknown> | undefined, keys: readonly string[]): string {
  if (args === undefined) return ''
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return ''
}

function isSettledTool(block: ToolCallBlock): block is ToolResultNode {
  return 'kind' in block
}

function callName(block: ToolCallBlock): string {
  return isSettledTool(block) ? block.call?.name ?? '' : block.name ?? ''
}

function callArgsRaw(block: ToolCallBlock): string {
  return (isSettledTool(block) ? block.call?.argsRaw : block.argsRaw) ?? ''
}

/**
 * Readable text of a tool result.
 *
 * Text blocks are concatenated; any non-text block is serialized so a result
 * that carries structured output still shows something. Results longer than
 * {@link RESULT_PREVIEW_CHARS} are cut with an explicit marker — a side panel
 * is narrow, and a 200 kB tool result must not push the transcript off-screen.
 */
function resultText(node: ToolResultNode): string {
  const parts: string[] = []
  for (const block of node.content) {
    const item = block as { type?: string; text?: string }
    if (item.type === 'text') parts.push(String(item.text ?? ''))
    else parts.push(JSON.stringify(block, null, 2))
  }
  if (parts.length === 0 && node.error !== undefined) {
    parts.push(`${node.error.name}: ${node.error.code}`)
  }
  const text = parts.join('\n')
  if (text.length <= RESULT_PREVIEW_CHARS) return text
  return `${text.slice(0, RESULT_PREVIEW_CHARS)}\n… (输出过长，已截断)`
}

function toolIcon(variant: ToolVariant): ReactNode {
  switch (variant) {
    case 'search': return <IconSearchOutline16 size={14} />
    case 'read': return <IconBrowseOutline16 size={14} />
    case 'write': return <IconEditOutline16 size={14} />
    case 'edit': return <IconEditOutline16 size={14} />
    case 'bash': return <IconApiOutline14 size={14} />
    case 'code': return <IconCodeOutline16 size={14} />
    case 'todo': return <IconChecklistOutline14 size={14} />
    case 'job': return <IconApiOutline14 size={14} />
    case 'web': return <IconGlobeOutline14 size={14} />
    case 'agent': return <IconUserOutline16 size={14} />
    case 'skill': return <IconSkillOutline16 size={14} />
    case 'question': return <IconQuestionOutline14 size={14} />
    case 'image': return <IconBrowseOutline16 size={14} />
    default: return <IconSparkle16 size={14} />
  }
}

/**
 * The collapsed summary of one tool call.
 *
 * Resolution order: the declared salient argument, then the host's own
 * `callView.title`, then any path-ish argument, then the tool name. A query
 * array (`web_search`) is joined; a todo list is counted rather than dumped.
 */
function toolSummary(
  args: Record<string, unknown> | undefined,
  keys: readonly string[],
  name: string,
  view?: ToolCallView | null,
): string {
  for (const key of keys) {
    const value = args?.[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
    if (Array.isArray(value)) {
      const items = value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map(item => item.trim())
      if (items.length > 0) return items.join(' · ')
      if (key === 'todos' && value.length > 0) return `${value.length} 项`
    }
  }
  if (typeof view?.title === 'string' && view.title.trim().length > 0) return view.title.trim()
  const path = pickString(args, ['path', 'file_path', 'url'])
  if (path.length > 0) return path
  return name
}

function ReasoningRow({ text, running }: { text: string; running: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const summary = running ? latestLine(text) : firstLine(text)
  return (
    <div
      className="dsh-codex-sidechat-think"
      data-variant="think"
      data-state={running ? 'running' : 'ok'}
    >
      <DisclosureRow
        rowClassName="dsh-codex-sidechat-think-row"
        leadingClassName="dsh-codex-sidechat-think-leading"
        titleClassName="dsh-codex-sidechat-think-title"
        chevronClassName="dsh-codex-sidechat-think-chevron"
        icon={<IconThinkOutline14 size={14} />}
        title="Think"
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className="dsh-codex-sidechat-sep" aria-hidden />
            <span className="dsh-codex-sidechat-think-summary" data-follow-end={running || undefined}>
              {summary}
            </span>
          </>
        )}
      >
        <div className="dsh-codex-sidechat-think-body">{text}</div>
      </DisclosureRow>
    </div>
  )
}

function AssistantMarkdown({
  blocks,
  streaming,
  interrupted,
}: {
  blocks: readonly AssistantBlock[]
  streaming: boolean
  interrupted?: boolean
}) {
  const last = blocks.length - 1
  if (!(streaming || interrupted === true || blocks.some(block => block.kind !== 'tool-call'))) {
    return null
  }
  const rendered: ReactNode[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block === undefined) continue
    switch (block.kind) {
      case 'text':
        rendered.push(
          <OfficialMarkdownText
            key={i}
            text={block.text}
            streaming={streaming}
            codeLabels={CODE_LABELS}
          />,
        )
        break
      case 'reasoning':
        rendered.push(
          <ReasoningRow key={i} text={block.text} running={streaming && i === last} />,
        )
        break
      case 'tool-call':
        break
      case 'image':
        break
      default:
        rendered.push(
          <JsonBlock key={i} label="未知块" payload={block} defaultOpen={false} />,
        )
    }
  }
  return (
    <div className="dsh-codex-sidechat-md" data-streaming={streaming || undefined}>
      <div className="dsh-codex-sidechat-md-body">
        {rendered}
        {interrupted === true && <span className="dsh-codex-sidechat-stopped">已停止</span>}
      </div>
    </div>
  )
}

function ToolCard({ block }: { block: ToolCallBlock }) {
  const [expanded, setExpanded] = useState(false)
  const name = callName(block)
  const settled = isSettledTool(block)
  const view = block.callView
  const presentation = toolPresentation(name, view)
  const variant = presentation.variant
  const state: ToolState = !settled
    ? 'running'
    : block.error?.code === 'interrupted'
      ? 'stopped'
      : block.isError
        ? 'error'
        : 'ok'
  const args = parseArgs(callArgsRaw(block))
  const summary = toolSummary(args, presentation.summaryKeys, name, view)
  const output = settled ? resultText(block) : ''
  const command = pickString(args, ['command'])
  const resultView = settled ? block.resultView : undefined
  const terminal = isTerminalCall(variant, view)
  // Expandable when there is anything to see: a result body, a structured
  // result card, a command line, or nested child calls.
  const subCount = block.subCalls?.length ?? 0
  const expandable = output.length > 0
    || (terminal && command.length > 0)
    || resultView != null
    || subCount > 0
  const failure = state === 'error' ? firstLine(output) : ''

  return (
    <div
      className="dsh-codex-sidechat-toolrow"
      data-variant={variant}
      data-tool={name}
      data-state={state}
    >
      <DisclosureRow
        rowClassName="dsh-codex-sidechat-toolrow-row"
        leadingClassName="dsh-codex-sidechat-toolrow-leading"
        titleClassName="dsh-codex-sidechat-toolrow-title"
        chevronClassName="dsh-codex-sidechat-toolrow-chevron"
        icon={toolIcon(variant)}
        title={presentation.title.length > 0 ? presentation.title : variantTitle(variant)}
        open={expanded && expandable}
        expandable={expandable}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={
          (failure.length > 0 || (summary?.length ?? 0) > 0 || subCount > 0) && (
            <>
              <span className="dsh-codex-sidechat-sep" aria-hidden />
              <span className={failure.length > 0
                ? 'dsh-codex-sidechat-toolrow-summary is-error'
                : 'dsh-codex-sidechat-toolrow-summary'}
              >
                {failure.length > 0 ? failure : summary}
              </span>
              {subCount > 0 && (
                <span className="dsh-codex-sidechat-toolrow-badge">
                  {subCount}
                </span>
              )}
              {state === 'running' && (
                <span className="dsh-codex-sidechat-toolrow-state">运行中</span>
              )}
            </>
          )
        }
      >
        {terminal ? (
          <div className="dsh-codex-sidechat-terminal">
            <TerminalBlock
              command={command || summary || ''}
              output={output.length > 0 ? output : undefined}
              running={!settled}
              labels={{ copy: '复制', copied: '已复制', running: '运行中', done: '完成', failed: '失败' }}
            />
          </div>
        ) : null}
        {resultView != null
          ? <ToolResultViewBody view={resultView} />
          : output.length > 0 && !terminal
            ? <div className="dsh-codex-sidechat-code"><CodeBlock code={output} copyLabel="复制" copiedLabel="已复制" /></div>
            : null}
        {subCount > 0 && (
          <div className="dsh-codex-sidechat-subcalls">
            {block.subCalls?.map((child, index) => (
              <ToolCard key={child.callId ?? index} block={child} />
            ))}
          </div>
        )}
      </DisclosureRow>
    </div>
  )
}

/**
 * Render a host-provided structured result card.
 *
 * The `card` tag says which presentation the tool asked for. A read result
 * renders as line-numbered code, a search as grouped matches, a web result as a
 * citation list; anything else falls back to the raw result text (already
 * rendered by the caller) so no card type is ever a blank hole.
 */
function ToolResultViewBody({ view }: { view: ToolResultView }): ReactNode {
  switch (view.card) {
    case 'read': {
      const lines = view.lines ?? []
      if (lines.length === 0) return null
      return (
        <div className="dsh-codex-sidechat-toolresult">
          <ReadBlock
            label={view.path}
            lines={lines.map(line => ({ number: line.number ?? 0, text: String(line.text ?? '') }))}
            totalLines={view.totalLines ?? lines.length}
            {...(view.lang === undefined ? {} : { lang: view.lang })}
            maxLines={SIDE_PANEL_MAX_LINES}
          />
        </div>
      )
    }
    case 'search': {
      // `truncated`/`total` are required: the primitive folds them into its
      // banner (显示 X / 共 N) so a capped result is never presented as complete.
      const total = view.total ?? 0
      const truncated = view.truncated ?? false
      const paths = view.paths ?? []
      if (paths.length > 0) {
        return (
          <div className="dsh-codex-sidechat-toolresult">
            <SearchBlock
              kind="paths"
              paths={[...paths]}
              total={total}
              truncated={truncated}
              maxLines={SIDE_PANEL_MAX_LINES}
            />
          </div>
        )
      }
      const files = view.files ?? []
      if (files.length === 0) return null
      return (
        <div className="dsh-codex-sidechat-toolresult">
          <SearchBlock
            kind="matches"
            files={files.map(file => ({
              path: file.path ?? '',
              matches: (file.matches ?? []).map(match => matchLine(match)),
            }))}
            total={total}
            truncated={truncated}
            maxLines={SIDE_PANEL_MAX_LINES}
          />
        </div>
      )
    }
    case 'diff': {
      const diffs = view.diffs ?? []
      if (diffs.length === 0) return null
      return (
        <div className="dsh-codex-sidechat-toolresult">
          <DiffBlock
            diffs={diffs.map(diff => ({
              path: diff.path ?? '',
              oldText: diff.oldText ?? null,
              newText: diff.newText ?? '',
            }))}
            maxLines={SIDE_PANEL_MAX_LINES}
          />
        </div>
      )
    }
    case 'web': {
      const sources = view.sources ?? []
      if (sources.length > 0) {
        return (
          <ul className="dsh-codex-sidechat-sources">
            {sources.map((source, index) => (
              <li key={source.url ?? index} className="dsh-codex-sidechat-source">
                <span className="dsh-codex-sidechat-source-title">
                  {source.title ?? source.url ?? ''}
                </span>
                {source.url !== undefined && (
                  <a
                    className="dsh-codex-sidechat-source-link"
                    href={source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {source.url}
                  </a>
                )}
                {source.snippet !== undefined && (
                  <span className="dsh-codex-sidechat-source-snippet">{source.snippet}</span>
                )}
              </li>
            ))}
          </ul>
        )
      }
      if (view.url !== undefined) {
        return (
          <div className="dsh-codex-sidechat-toolresult">
            <div className="dsh-codex-sidechat-toolresult-caption">
              {view.statusCode === undefined ? view.url : `${view.statusCode} · ${view.url}`}
            </div>
          </div>
        )
      }
      return null
    }
    default:
      return null
  }
}

/**
 * Normalize one search match to the primitive's `SearchBlockLineMatch` shape.
 *
 * The host emits `{ lineNumber, line }`; stringifying that object is what
 * produced `[object Object]` rows. Unknown shapes degrade to the object's text.
 */
function matchLine(match: unknown): { lineNumber: number; line: string } {
  if (typeof match === 'object' && match !== null) {
    const record = match as { lineNumber?: unknown; number?: unknown; line?: unknown; text?: unknown }
    const number = typeof record.lineNumber === 'number'
      ? record.lineNumber
      : typeof record.number === 'number' ? record.number : 0
    const text = typeof record.line === 'string'
      ? record.line
      : typeof record.text === 'string' ? record.text : ''
    return { lineNumber: number, line: text }
  }
  return { lineNumber: 0, line: String(match ?? '') }
}
/**
 * Render the image blocks of one message.
 *
 * Durable images are content-addressed references, not URLs, so they must be
 * fetched through the session-authorized `session.attachment` RPC — the same
 * call the official chat uses, which proves the requesting session's log
 * actually cites the attachment before releasing any bytes. Failures render a
 * placeholder rather than a broken `<img>`.
 */
function MessageImages({
  blocks,
  sessionId,
  api,
}: {
  blocks: readonly unknown[]
  sessionId: string
  api: ImageApi | undefined
}) {
  const images = useMemo(
    () => blocks.filter(isImageBlock),
    [blocks],
  )
  if (images.length === 0 || api === undefined) return null
  return (
    <div className="dsh-codex-sidechat-images">
      {images.map((image, index) => (
        <MessageImage
          key={String(image.attachment?.attachmentId ?? index)}
          image={image}
          sessionId={sessionId}
          api={api}
        />
      ))}
    </div>
  )
}

/** The session-authorized image loader face (subset of IApiClient). */
export interface ImageApi {
  sessions: {
    attachment(request: {
      sessionId: never
      attachmentId: never
    }): Promise<{ result: { ok: boolean; value?: { data?: string }; error?: { message?: string } } }>
  }
}

function MessageImage({
  image,
  sessionId,
  api,
}: {
  image: { attachment?: ImageAttachmentRefLike }
  sessionId: string
  api: ImageApi
}) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'ready'; url: string } | {
    kind: 'error'
  }>({ kind: 'loading' })

  useEffect(() => {
    let alive = true
    const attachmentId = image.attachment?.attachmentId
    if (attachmentId === undefined) {
      setState({ kind: 'error' })
      return
    }
    void api.sessions.attachment({
      sessionId: sessionId as never,
      attachmentId: attachmentId as never,
    }).then((response) => {
      if (!alive) return
      const value = response.result
      if (value.ok && typeof value.value?.data === 'string' && value.value.data.length > 0) {
        setState({ kind: 'ready', url: value.value.data })
        return
      }
      setState({ kind: 'error' })
    }).catch(() => {
      if (alive) setState({ kind: 'error' })
    })
    return () => {
      alive = false
    }
  }, [api, image.attachment?.attachmentId, sessionId])

  if (state.kind === 'error') {
    return (
      <span className="dsh-codex-sidechat-image is-error">
        {image.attachment?.name ?? '图片'}（无法加载）
      </span>
    )
  }
  if (state.kind === 'loading') {
    return <span className="dsh-codex-sidechat-image is-loading">图片…</span>
  }
  return (
    <img
      className="dsh-codex-sidechat-image"
      src={state.url}
      alt={image.attachment?.name ?? '图片'}
    />
  )
}

/** Narrow one content block to an image block carrying a durable reference. */
function isImageBlock(block: unknown): block is { type: 'image'; attachment?: ImageAttachmentRefLike } {
  if (typeof block !== 'object' || block === null) return false
  const record = block as { type?: unknown; attachment?: unknown }
  return record.type === 'image' && typeof record.attachment === 'object'
}

function UserBubble({
  content,
  sessionId,
  api,
}: {
  content: readonly unknown[]
  sessionId?: string
  api?: ImageApi
}) {
  const text = textOfContent(content)
  const hasImages = content.some(isImageBlock)
  if (text.length === 0 && !hasImages) return null
  return (
    <div className="dsh-codex-sidechat-user">
      <div className="dsh-codex-sidechat-user-bubble">
        {text.length > 0 && <MessageText text={text} />}
        {hasImages && sessionId !== undefined && (
          <MessageImages blocks={content} sessionId={sessionId} api={api} />
        )}
      </div>
    </div>
  )
}

function CompactionRow({ summary }: { summary: string | null }) {
  const [expanded, setExpanded] = useState(false)
  const expandable = summary !== null && summary.length > 0
  return (
    <DisclosureRow
      rowClassName="dsh-codex-sidechat-think-row"
      icon={<IconSparkle16 size={14} />}
      title="上下文已压缩"
      open={expanded && expandable}
      expandable={expandable}
      expandOnRowClick
      onToggle={() => { setExpanded(value => !value) }}
      collapsedContent={
        expandable ? (
          <>
            <span className="dsh-codex-sidechat-sep" aria-hidden />
            <span className="dsh-codex-sidechat-think-summary">{firstLine(summary ?? '')}</span>
          </>
        ) : null
      }
    >
      <div className="dsh-codex-sidechat-think-body">{summary}</div>
    </DisclosureRow>
  )
}

function TurnStatus() {
  const [mountedAt] = useState(() => Date.now())
  const [elapsedMs, setElapsedMs] = useState(0)
  useEffect(() => {
    const tick = (): void => { setElapsedMs(Math.max(0, Date.now() - mountedAt)) }
    tick()
    const id = setInterval(tick, 1000)
    return () => { clearInterval(id) }
  }, [mountedAt])
  const showClock = elapsedMs >= 15_000
  const total = Math.max(0, Math.floor(elapsedMs / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  const clock = minutes > 0
    ? `${String(minutes)}:${String(seconds).padStart(2, '0')}`
    : `${String(seconds)}s`
  return (
    <div className="dsh-codex-sidechat-turn-status" role="status" aria-live="polite">
      Deep diving…
      {showClock && <span className="dsh-codex-sidechat-turn-clock">{clock}</span>}
    </div>
  )
}

function ChatNodeView({
  node,
  sessionId,
  api,
  t,
}: {
  node: ChatConversationViewNode
  sessionId?: string
  api?: ImageApi
  t?: (key: string) => string
}) {
  if (node.visibility === 'hidden') return null
  const data = asRecord(node.data)
  switch (node.kind) {
    case 'user':
    case 'steering':
      return (
        <UserBubble
          content={Array.isArray(data?.content) ? data.content as readonly unknown[] : []}
          sessionId={sessionId}
          api={api}
        />
      )
    case 'assistant-step': {
      const blocks = Array.isArray(data?.blocks) ? data.blocks as readonly AssistantBlock[] : []
      const status = String(data?.status ?? 'settled')
      return (
        <AssistantMarkdown
          blocks={blocks}
          streaming={status === 'running'}
          interrupted={status === 'interrupted'}
        />
      )
    }
    case 'tool-call': {
      const root = data?.root
      if (root === undefined || typeof root !== 'object' || root === null) return null
      return <ToolCard block={root as ToolCallBlock} />
    }
    case 'command':
      return <CommandRow node={data} />
    case 'context':
      return <ContextRow node={data} t={t} />
    case 'compaction':
    case 'manual-compaction': {
      const summary = typeof data?.summary === 'string'
        ? data.summary
        : asRecord(data?.compaction)?.summary
      return <CompactionRow summary={typeof summary === 'string' ? summary : null} />
    }
    case 'turn-error':
      return (
        <div className="dsh-codex-sidechat-status-row is-error">
          {typeof data?.message === 'string' ? data.message : 'Turn error'}
        </div>
      )
    case 'turn-max-tokens':
      return <div className="dsh-codex-sidechat-status-row">已达到输出上限</div>
    case 'model-retry':
      return <div className="dsh-codex-sidechat-status-row">正在重试…</div>
    case 'turn-tail':
      return null
    default:
      return (
        <JsonBlock label={node.kind} payload={node.data} defaultOpen={false} />
      )
  }
}

/**
 * One slash-command lifecycle row.
 *
 * Previously this rendered the command name and nothing else, so `/compact` or
 * a failing command gave no account of what ran. The name goes in the title and
 * the arguments plus the outcome (success text or error) become the collapsible
 * body.
 */
function CommandRow({ node }: { node: Record<string, unknown> | null }) {
  const [expanded, setExpanded] = useState(false)
  if (node === null) return null
  const name = typeof node.name === 'string' && node.name.length > 0 ? node.name : 'command'
  const args = typeof node.args === 'string' ? node.args.trim() : ''
  const outcome = asRecord(node.outcome)
  const outcomeKind = outcome?.kind === 'error' ? 'error' : 'ok'
  const outcomeText = typeof outcome?.text === 'string' ? outcome.text : ''
  const detail = [args, outcomeText].filter(part => part.length > 0).join('\n')
  const expandable = detail.length > 0
  return (
    <div className="dsh-codex-sidechat-toolrow" data-variant="others" data-state={outcomeKind}>
      <DisclosureRow
        rowClassName="dsh-codex-sidechat-toolrow-row"
        icon={<IconSparkle16 size={14} />}
        title={`/${name}`}
        open={expanded && expandable}
        expandable={expandable}
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={
          outcomeText.length > 0
            ? (
              <>
                <span className="dsh-codex-sidechat-sep" aria-hidden />
                <span className={outcomeKind === 'error'
                  ? 'dsh-codex-sidechat-toolrow-summary is-error'
                  : 'dsh-codex-sidechat-toolrow-summary'}
                >
                  {firstLine(outcomeText)}
                </span>
              </>
            )
            : null
        }
      >
        <div className={outcomeKind === 'error'
          ? 'dsh-codex-sidechat-toolrow-body is-error'
          : 'dsh-codex-sidechat-toolrow-body'}
        >
          {detail}
        </div>
      </DisclosureRow>
    </div>
  )
}

/**
 * One injected-context row.
 *
 * Context messages are model-facing injections (agent instructions, skill
 * content, a side chat's inherited parent digest, …) that this renderer used to
 * drop entirely — so the transcript silently hid the fact that extra material
 * had entered the conversation. They now render as a collapsed, labelled row
 * using the producer name the runtime projects (`provenance.label`), which is
 * exactly what the official chat shows for the same node.
 */
/** The producer id the host stamps on an inherited parent digest. */
const DIGEST_PRODUCER = 'dsh-codex:side-chat'

function ContextRow({
  node,
  t,
}: {
  node: Record<string, unknown> | null
  t?: (key: string) => string
}) {
  const [expanded, setExpanded] = useState(false)
  if (node === null) return null
  const content = Array.isArray(node.content) ? node.content as readonly ContentBlock[] : []
  const body = textOfContent(content)
  const provenance = asRecord(node.provenance)
  // Our own digest arrives with a stable wire id as its producer name; show a
  // translated label instead of that id. Any other producer keeps its own name.
  const rawLabel = typeof provenance?.label === 'string' && provenance.label.length > 0
    ? provenance.label
    : undefined
  const label = rawLabel === DIGEST_PRODUCER
    ? (t?.('sideChat.contextLabel') ?? '主对话上下文')
    : (rawLabel ?? '上下文')
  const recall = provenance?.role === 'recall'
  const expandable = body.length > 0
  return (
    <div className="dsh-codex-sidechat-context" data-recall={recall || undefined}>
      <DisclosureRow
        rowClassName="dsh-codex-sidechat-think-row"
        icon={recall ? <IconBrowseOutline16 size={14} /> : <IconSparkle16 size={14} />}
        title={recall ? `参考 ${label}` : label}
        open={expanded && expandable}
        expandable={expandable}
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={
          expandable
            ? (
              <>
                <span className="dsh-codex-sidechat-sep" aria-hidden />
                <span className="dsh-codex-sidechat-think-summary">{firstLine(body)}</span>
              </>
            )
            : null
        }
      >
        <div className="dsh-codex-sidechat-think-body">{body}</div>
      </DisclosureRow>
    </div>
  )
}

/**
 * Render one side chat's transcript with follow-the-latest scroll.
 * @param props - the live conversation snapshot, or undefined while binding.
 */
export function SideChatTranscript({
  snapshot,
  t,
  sessionId,
  api,
  contextState,
}: {
  snapshot: ConversationSnapshot | undefined
  t: (key: string) => string
  /** Session id used to authorize durable image reads. */
  sessionId?: string
  /** The `IApiClient` face, for session-authorized image loading. */
  api?: ImageApi
  /**
   * Whether the parent's context reached this side chat, as reported at open
   * time. Rendered in the empty state because the injected context is not yet
   * in the transcript — it only lands when the first turn claims it.
   */
  contextState?: SideChatContextState
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)

  useEffect(() => {
    if (!following) return
    const el = scrollRef.current
    if (el === null) return
    el.scrollTop = el.scrollHeight
  }, [snapshot, following])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (el === null) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD
    if (nearBottom !== following) setFollowing(nearBottom)
  }

  const jumpToBottom = (): void => {
    const el = scrollRef.current
    if (el === null) return
    el.scrollTop = el.scrollHeight
    setFollowing(true)
  }

  // Empty state: keep the hero, but render any context rows beneath it. A
  // freshly opened side chat's only node IS its inherited parent context, and
  // hiding it is what made this feature look broken — the user sees an empty
  // chat with no evidence the main conversation came along.
  if (snapshot === undefined || !hasVisibleContent(snapshot)) {
    const contextNodes = contextRowsOf<ChatConversationViewNode>(snapshot)
    return (
      <div className="dsh-codex-sidechat-empty">
        <div className="dsh-codex-sidechat-empty-hero">
          <IconNewChatOutline16 size={48} className="dsh-codex-sidechat-empty-icon" />
          <h2 className="dsh-codex-sidechat-empty-title">{t('sideChat.emptyTitle')}</h2>
          <p className="dsh-codex-sidechat-empty-hint">{t('sideChat.emptyHint')}</p>
        </div>
        {/* The badge is the pre-turn placeholder for the injected context: the
            digest is not in the transcript yet, so this is the only evidence it
            came along. Once the context row itself lands, it supersedes the
            badge — showing both would say the same thing twice. Only an actual
            inheritance is announced; an empty parent has nothing to report and
            an empty side chat already looks empty. */}
        {contextState === 'inherited' && contextNodes.length === 0 && (
          <div className="dsh-codex-sidechat-context-note" data-context={contextState}>
            <IconLinkOutline14 size={14} />
            <span>{t('sideChat.contextInherited')}</span>
          </div>
        )}
        {contextNodes.length > 0 && (
          <div className="dsh-codex-sidechat-empty-context">
            {contextNodes.map(node => (
              <ContextRow key={node.key} node={asRecord(node.data)} t={t} />
            ))}
          </div>
        )}
      </div>
    )
  }

  // Same defensive reads as `hasVisibleContent`: the Chat slice, the queue,
  // and the pending list all arrive asynchronously.
  const pendingSteering = pendingSteeringOf<{ id: string; content: readonly unknown[] }>(snapshot)
  const chatRows = chatRowsOf<ChatConversationViewNode>(snapshot)

  return (
    <div className="dsh-codex-sidechat-transcript-wrap">
      <div
        className="dsh-codex-sidechat-transcript"
        ref={scrollRef}
        onScroll={onScroll}
      >
        {chatRows.map(node => (
          <ChatNodeView key={node.key} node={node} sessionId={sessionId} api={api} t={t} />
        ))}
        {snapshot.running && <TurnStatus />}
        {pendingSteering.map(item => (
          <UserBubble key={item.id} content={item.content} sessionId={sessionId} api={api} />
        ))}
      </div>
      {!following && (
        <div className="dsh-codex-sidechat-to-bottom-slot">
          <button
            type="button"
            className="dsh-codex-sidechat-to-bottom"
            onClick={jumpToBottom}
            aria-label="回到底部"
            title="回到底部"
          >
            <IconChevronDownOutline14 />
          </button>
        </div>
      )}
    </div>
  )
}
