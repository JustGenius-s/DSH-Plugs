import type {
  AssistantBlock,
  ConversationNode,
  ConversationSnapshot,
  PendingInteraction,
  RunningToolCall,
  SessionSummary,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { WeChatKey } from './locales.ts'

export type WeChatItem =
  | { kind: 'time'; id: string; label: string }
  | { kind: 'me'; id: string; text: string; time: number }
  | { kind: 'them'; id: string; text: string; time: number; streaming?: boolean }
  | { kind: 'tip'; id: string; text: string }
  | { kind: 'typing' }
  | { kind: 'approval'; id: string; wait: PendingInteraction }
  | { kind: 'question'; id: string; wait: PendingInteraction }

export type Translate = (key: WeChatKey) => string

const TOOL_LABELS: Record<string, { run: string; done: string }> = {
  bash: { run: '正在跑命令', done: '命令跑完了' },
  mcp_client_bash: { run: '正在跑命令', done: '命令跑完了' },
  read: { run: '正在看', done: '看完了' },
  mcp_client_read: { run: '正在看', done: '看完了' },
  write: { run: '正在写', done: '写好了' },
  mcp_client_write: { run: '正在写', done: '写好了' },
  edit: { run: '正在改', done: '改好了' },
  mcp_client_edit: { run: '正在改', done: '改好了' },
  grep: { run: '正在搜', done: '搜完了' },
  mcp_client_grep: { run: '正在搜', done: '搜完了' },
  glob: { run: '正在找文件', done: '文件找到了' },
  mcp_client_glob: { run: '正在找文件', done: '文件找到了' },
  todo_write: { run: '在整理待办', done: '待办更新了' },
  mcp_client_todo_write: { run: '在整理待办', done: '待办更新了' },
  web_search: { run: '正在网上查', done: '查到了' },
  mcp_client_web_search: { run: '正在网上查', done: '查到了' },
  web_fetch: { run: '正在打开网页', done: '网页看完了' },
  mcp_client_web_fetch: { run: '正在打开网页', done: '网页看完了' },
}

export function splitBubbles(text: string): string[] {
  const trimmed = text.replace(/\r\n/g, '\n').trim()
  if (!trimmed) return []
  const parts = trimmed.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  return parts.length > 0 ? parts : [trimmed]
}

export function textFromUnknown(value: unknown, imageLabel: string): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  if (typeof record.text === 'string') return record.text
  if (record.type === 'image' || record.kind === 'image') return imageLabel
  if (Array.isArray(record.content)) {
    return record.content.map((part) => textFromUnknown(part, imageLabel)).filter(Boolean).join('\n')
  }
  if (Array.isArray(record.blocks)) {
    return record.blocks.map((part) => textFromUnknown(part, imageLabel)).filter(Boolean).join('\n')
  }
  return ''
}

export function textFromBlocks(blocks: readonly unknown[] | undefined, imageLabel: string): string {
  if (!blocks) return ''
  return blocks.map((block) => textFromUnknown(block, imageLabel)).filter(Boolean).join('\n')
}

export function textFromAssistantBlocks(blocks: readonly AssistantBlock[] | undefined, imageLabel: string): string {
  if (!blocks) return ''
  const parts: string[] = []
  for (const block of blocks) {
    if (block.kind === 'text' && block.text.trim()) parts.push(block.text)
    else if (block.kind === 'image') parts.push(imageLabel)
  }
  return parts.join('\n\n')
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function basename(path: string): string {
  const clean = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const slash = clean.lastIndexOf('/')
  return slash >= 0 ? clean.slice(slash + 1) : clean
}

export function toolTip(name: string, argsRaw: string, done: boolean): string {
  const args = parseArgs(argsRaw)
  const path = typeof args.path === 'string' ? args.path
    : typeof args.file === 'string' ? args.file
      : typeof args.target_file === 'string' ? args.target_file
        : typeof args.target_notebook === 'string' ? args.target_notebook
          : ''
  const command = typeof args.command === 'string' ? args.command : ''
  const query = typeof args.pattern === 'string' ? args.pattern
    : typeof args.query === 'string' ? args.query
      : typeof args.search_term === 'string' ? args.search_term
        : ''
  const labels = TOOL_LABELS[name] ?? {
    run: `正在用 ${name}`,
    done: `${name} 做完了`,
  }
  const head = done ? labels.done : labels.run
  if (path) return `${head} ${basename(path)}`
  if (command) {
    const short = command.length > 36 ? `${command.slice(0, 36)}…` : command
    return `${head} ${short}`
  }
  if (query) {
    const short = query.length > 24 ? `${query.slice(0, 24)}…` : query
    return `${head} ${short}`
  }
  return head
}

export function formatClock(time: number, t: Translate): string {
  if (!Number.isFinite(time) || time <= 0) return ''
  const date = new Date(time)
  const now = new Date()
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) {
    if (now.getTime() - time < 60_000) return t('justNow')
    return `${hh}:${mm}`
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `${t('yesterday')} ${hh}:${mm}`
  return `${date.getMonth() + 1}/${date.getDate()} ${hh}:${mm}`
}

function pushTime(items: WeChatItem[], time: number, lastTime: number, t: Translate): number {
  if (!time) return lastTime
  if (lastTime === 0 || time - lastTime > 5 * 60_000) {
    const label = formatClock(time, t)
    if (label) items.push({ kind: 'time', id: `time-${time}`, label })
    return time
  }
  return lastTime
}

function pushThem(items: WeChatItem[], id: string, text: string, time: number, streaming?: boolean) {
  const bubbles = splitBubbles(text)
  bubbles.forEach((bubble, index) => {
    items.push({
      kind: 'them',
      id: `${id}:${index}`,
      text: bubble,
      time,
      streaming: streaming && index === bubbles.length - 1,
    })
  })
}

function pushMe(items: WeChatItem[], id: string, text: string, time: number) {
  const bubbles = splitBubbles(text)
  bubbles.forEach((bubble, index) => {
    items.push({ kind: 'me', id: `${id}:${index}`, text: bubble, time })
  })
}

export function projectChat(snapshot: ConversationSnapshot | undefined, t: Translate): WeChatItem[] {
  if (!snapshot) return []
  const imageLabel = t('preview.image')
  const items: WeChatItem[] = []
  let lastTime = 0
  const seenCalls = new Set<string>()

  for (const node of snapshot.nodes) {
    lastTime = pushTime(items, node.time, lastTime, t)
    appendNode(items, node, imageLabel, seenCalls)
  }

  for (const call of snapshot.runningCalls) {
    if (seenCalls.has(call.callId)) continue
    items.push({ kind: 'tip', id: `run-${call.callId}`, text: toolTip(call.name, call.argsRaw, false) })
    seenCalls.add(call.callId)
  }

  const partialText = textFromAssistantBlocks(snapshot.partial?.blocks, imageLabel)
  if (partialText) {
    lastTime = pushTime(items, Date.now(), lastTime, t)
    pushThem(items, `partial-${snapshot.partial?.turn}-${snapshot.partial?.step}`, partialText, Date.now(), true)
  }

  for (const wait of snapshot.pending) {
    if (wait.kind === 'approval') items.push({ kind: 'approval', id: wait.key, wait })
    else items.push({ kind: 'question', id: wait.key, wait })
  }

  const last = items[items.length - 1]
  const streaming = last?.kind === 'them' && last.streaming
  if (snapshot.running && !streaming && snapshot.pending.length === 0) {
    items.push({ kind: 'typing' })
  }
  return items
}

function appendNode(items: WeChatItem[], node: ConversationNode, imageLabel: string, seenCalls: Set<string>) {
  switch (node.kind) {
    case 'user':
    case 'steering': {
      const text = textFromBlocks(node.content as unknown as readonly unknown[], imageLabel)
      if (text) pushMe(items, `${node.kind}-${node.seq}`, text, node.time)
      return
    }
    case 'assistant': {
      const text = textFromAssistantBlocks(node.blocks, imageLabel)
      if (text) pushThem(items, `assistant-${node.seq}`, text, node.time)
      return
    }
    case 'tool-result': {
      seenCalls.add(node.callId)
      const name = node.call?.name ?? 'tool'
      const args = node.call?.argsRaw ?? ''
      items.push({
        kind: 'tip',
        id: `tool-${node.callId}`,
        text: toolTip(name, args, !node.isError) + (node.isError ? '（没做成）' : ''),
      })
      return
    }
    case 'command': {
      const name = node.name ?? 'command'
      items.push({
        kind: 'tip',
        id: `cmd-${node.seq}`,
        text: node.outcome ? `/${name} 做完了` : `正在执行 /${name}`,
      })
      return
    }
    case 'turn-error':
      items.push({ kind: 'tip', id: `err-${node.seq}`, text: node.message || '这次没做成' })
      return
    case 'turn-max-tokens':
      items.push({ kind: 'tip', id: `max-${node.seq}`, text: '说到一半被截断了' })
      return
    case 'compaction':
      items.push({ kind: 'tip', id: `compact-${node.seq}`, text: '前面的聊天压缩了一下' })
      return
    case 'model-retry':
      items.push({ kind: 'tip', id: `retry-${node.seq}`, text: '对方在重试…' })
      return
    default:
      return
  }
}

export function lastPreview(items: WeChatItem[], summary: SessionSummary, t: Translate): string {
  if (summary.pendingInteraction) return t('preview.needYou')
  if (summary.running) return t('preview.typing')
  if (summary.completed) return t('preview.done')
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]
    if (item.kind === 'me' || item.kind === 'them' || item.kind === 'tip') {
      const text = item.text.replace(/\s+/g, ' ').trim()
      return text.length > 28 ? `${text.slice(0, 28)}…` : text
    }
  }
  return summary.displayTitle
}

export function hueFromId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return hash % 360
}

export function initialOf(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return '聊'
  const match = trimmed.match(/[\p{L}\p{N}]/u)
  return (match?.[0] ?? trimmed[0] ?? '聊').toUpperCase()
}

export function runningToolHint(calls: readonly RunningToolCall[]): string | undefined {
  const call = calls[0]
  if (!call) return undefined
  return toolTip(call.name, call.argsRaw, false)
}
