/**
 * Side-chat transcript: renders the session's Chat presentation nodes with
 * the same primitives the main conversation uses (DisclosureRow Think/tool
 * rows, MarkdownText, MessageText, TerminalBlock). Side chats stay compact:
 * no details panel, no turn-tail actions, no queue chrome.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  AssistantBlock,
  ChatConversationViewNode,
  ConversationSnapshot,
} from '@just-genius/dsh-plugin-runtime/client'
import type { ToolCallBlock, ToolResultNode } from './types'
import {
  CodeBlock,
  DisclosureRow,
  IconApiOutline14,
  IconBrowseOutline16,
  IconChevronDownOutline14,
  IconCodeOutline16,
  IconEditOutline16,
  IconNewChatOutline16,
  IconSearchOutline16,
  IconSparkle16,
  IconThinkOutline14,
  JsonBlock,
  MessageText,
  OfficialMarkdownText,
  TerminalBlock,
  type MarkdownCodeLabels,
} from '@just-genius/dsh-plugin-ui'

/** Distance from the bottom (px) that still counts as "following". */
const PIN_THRESHOLD = 48

const CODE_LABELS: MarkdownCodeLabels = { copyLabel: '复制', copiedLabel: '已复制' }

type ToolVariant = 'search' | 'read' | 'bash' | 'write' | 'edit' | 'code' | 'others'

const TOOL_VARIANTS: Record<string, ToolVariant> = {
  bash: 'bash',
  pwsh: 'bash',
  read: 'read',
  web_fetch: 'read',
  web_search: 'search',
  grep: 'search',
  glob: 'search',
  write: 'write',
  edit: 'edit',
  run_code: 'code',
}

const VARIANT_TITLES: Record<ToolVariant, string> = {
  search: 'Search',
  read: 'Read',
  bash: 'Bash',
  write: 'Write',
  edit: 'Edit',
  code: 'Code',
  others: 'Tool call',
}

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
  return parts.join('\n')
}

function toolIcon(variant: ToolVariant): ReactNode {
  switch (variant) {
    case 'search': return <IconSearchOutline16 size={14} />
    case 'read': return <IconBrowseOutline16 size={14} />
    case 'bash': return <IconApiOutline14 size={14} />
    case 'write':
    case 'edit': return <IconEditOutline16 size={14} />
    case 'code': return <IconCodeOutline16 size={14} />
    default: return <IconSparkle16 size={14} />
  }
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
  const variant = TOOL_VARIANTS[name] ?? 'others'
  const settled = isSettledTool(block)
  const state = !settled
    ? 'running'
    : block.error?.code === 'interrupted'
      ? 'stopped'
      : block.isError
        ? 'error'
        : 'ok'
  const args = parseArgs(callArgsRaw(block))
  const summaryKeys = variant === 'bash'
    ? ['description', 'command'] as const
    : variant === 'search'
      ? ['query', 'pattern', 'url'] as const
      : variant === 'code'
        ? ['code', 'source'] as const
        : ['path', 'file_path', 'url', 'description', 'command'] as const
  const summary = pickString(args, summaryKeys)
    || (variant === 'others' && name.length > 0 ? name : block.callId)
  const output = settled ? resultText(block) : ''
  const command = pickString(args, ['command'])
  const expandable = output.length > 0 || (variant === 'bash' && command.length > 0)
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
        title={VARIANT_TITLES[variant]}
        open={expanded && expandable}
        expandable={expandable}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={
          (failure.length > 0 || (summary?.length ?? 0) > 0) && (
            <>
              <span className="dsh-codex-sidechat-sep" aria-hidden />
              <span className={failure.length > 0
                ? 'dsh-codex-sidechat-toolrow-summary is-error'
                : 'dsh-codex-sidechat-toolrow-summary'}
              >
                {failure.length > 0 ? failure : summary}
              </span>
            </>
          )
        }
      >
        {variant === 'bash' ? (
          <TerminalBlock
            command={command || summary || ''}
            output={output.length > 0 ? output : undefined}
            running={!settled}
            labels={{ copy: '复制', copied: '已复制', running: '运行中', done: '完成', failed: '失败' }}
          />
        ) : output.length > 0 ? (
          <CodeBlock code={output} copyLabel="复制" copiedLabel="已复制" />
        ) : null}
      </DisclosureRow>
    </div>
  )
}

function UserBubble({ content }: { content: readonly unknown[] }) {
  const text = textOfContent(content)
  if (text.length === 0) return null
  return (
    <div className="dsh-codex-sidechat-user">
      <div className="dsh-codex-sidechat-user-bubble">
        <MessageText text={text} />
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

function ChatNodeView({ node }: { node: ChatConversationViewNode }) {
  if (node.visibility === 'hidden') return null
  const data = asRecord(node.data)
  switch (node.kind) {
    case 'user':
    case 'steering':
      return <UserBubble content={Array.isArray(data?.content) ? data.content as readonly unknown[] : []} />
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
    case 'command': {
      const name = typeof data?.name === 'string' ? data.name : 'command'
      return (
        <div className="dsh-codex-sidechat-toolrow" data-variant="others" data-state="ok">
          <DisclosureRow
            rowClassName="dsh-codex-sidechat-toolrow-row"
            icon={<IconSparkle16 size={14} />}
            title={name}
            open={false}
            expandable={false}
            onToggle={() => {}}
          />
        </div>
      )
    }
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
    case 'context':
      return null
    default:
      return (
        <JsonBlock label={node.kind} payload={node.data} defaultOpen={false} />
      )
  }
}

function hasVisibleContent(snapshot: ConversationSnapshot): boolean {
  for (const key of snapshot.chat.order) {
    const node = snapshot.chat.nodes.get(key)
    if (node === undefined || node.visibility === 'hidden') continue
    if (node.kind === 'turn-tail' || node.kind === 'context') continue
    return true
  }
  return snapshot.running
    || snapshot.pending.length > 0
    || snapshot.queue.some(item => item.placement === 'steering')
}

/**
 * Render one side chat's transcript with follow-the-latest scroll.
 * @param props - the live conversation snapshot, or undefined while binding.
 */
export function SideChatTranscript({
  snapshot,
  t,
}: {
  snapshot: ConversationSnapshot | undefined
  t: (key: string) => string
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

  if (snapshot === undefined || !hasVisibleContent(snapshot)) {
    return (
      <div className="dsh-codex-sidechat-empty">
        <div className="dsh-codex-sidechat-empty-hero">
          <IconNewChatOutline16 size={48} className="dsh-codex-sidechat-empty-icon" />
          <h2 className="dsh-codex-sidechat-empty-title">{t('sideChat.emptyTitle')}</h2>
          <p className="dsh-codex-sidechat-empty-hint">{t('sideChat.emptyHint')}</p>
        </div>
      </div>
    )
  }

  const pendingSteering = snapshot.queue.filter(item => item.placement === 'steering')

  return (
    <div className="dsh-codex-sidechat-transcript-wrap">
      <div
        className="dsh-codex-sidechat-transcript"
        ref={scrollRef}
        onScroll={onScroll}
      >
        {snapshot.chat.order.map((key) => {
          const node = snapshot.chat.nodes.get(key)
          if (node === undefined) return null
          return <ChatNodeView key={key} node={node} />
        })}
        {snapshot.running && <TurnStatus />}
        {pendingSteering.map(item => (
          <UserBubble key={item.id} content={item.content} />
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
