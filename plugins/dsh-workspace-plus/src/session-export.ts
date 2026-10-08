import type { SessionExportPayload } from './shared.ts'
import { summarizeToolArguments, summarizeToolResult } from './session-export-tools.ts'

export interface ExportSession {
  header: {
    id: string
    createdAt: number
    cwd?: string
    parentSession?: string
  }
  events: readonly unknown[]
}

type RecordValue = Record<string, unknown>
interface ExportEvent {
  type: string
  time?: number
  data: RecordValue
  surfaceOp?: unknown
}
interface MessageEntry {
  kind: 'message'
  role: '用户' | '助手'
  time?: number
  content: unknown[]
  partial?: boolean
}
interface ToolEntry {
  kind: 'tool'
  name: string
  arguments?: unknown
  content?: unknown
  error?: unknown
  failed: boolean
  started: boolean
  complete: boolean
}
interface NoteEntry {
  kind: 'note'
  text: string
}
type Entry = MessageEntry | ToolEntry | NoteEntry
interface StreamBlock {
  content: RecordValue
  closed: boolean
}

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : undefined
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function blocks(value: unknown): unknown[] {
  return Array.isArray(value) ? value : typeof value === 'string' ? [{ type: 'text', text: value }] : []
}

function eventOf(value: unknown): ExportEvent | undefined {
  const event = record(value)
  if (event === undefined || typeof event.type !== 'string') return undefined
  return {
    type: event.type,
    time: typeof event.time === 'number' ? event.time : undefined,
    data: record(event.data) ?? {},
    surfaceOp: event.surfaceOp,
  }
}

function stepKey(data: RecordValue): string {
  return `${String(data.turn)}:${String(data.step)}`
}

/** Escape generated labels only. Authored Markdown is kept verbatim. */
function label(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[\\`*_[\]<>#|]/g, '\\$&')
}

function code(value: string): string {
  const fence = '`'.repeat(Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length)) + 1)
  return `${fence} ${value.replace(/[\r\n]/g, ' ')} ${fence}`
}

function codeBlock(value: string): string {
  const fence = '`'.repeat(Math.max(2, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length)) + 1)
  return `${fence}text\n${value}\n${fence}`
}

/** A cancelled fenced block must not swallow every following message. */
function closeMessageFence(text: string): string {
  let open: { marker: string; indent: string } | undefined
  for (const line of text.split(/\r?\n/)) {
    const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
    if (match === null) continue
    const [, indent, marker, rest] = match
    if (open === undefined) {
      // Backticks in a backtick fence's info string make it ordinary text.
      if (marker[0] !== '`' || !rest.includes('`')) open = { marker, indent }
    } else if (marker[0] === open.marker[0] && marker.length >= open.marker.length && rest.trim() === '') {
      open = undefined
    }
  }
  return open === undefined ? text : `${text}\n${open.indent}${open.marker}\n\n> 导出时补齐了未闭合的代码围栏。`
}

function iso(time: unknown): string | undefined {
  if (typeof time !== 'number' || !Number.isFinite(time)) return undefined
  const date = new Date(time)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** Plain .md name, bounded in UTF-8 bytes for common desktop filesystems. */
export function sessionExportFilename(title: string, sessionId: string): string {
  let base = title.normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
  if (base === '') base = `session-${sessionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'export'}`
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = `_${base}`
  let short = ''
  let bytes = 0
  for (const char of base) {
    const size = new TextEncoder().encode(char).length
    if (bytes + size > 180) break
    short += char
    bytes += size
  }
  return `${short.replace(/[.\s]+$/g, '')}.md`
}

function attachmentText(block: RecordValue): string {
  const attachment = record(block.attachment) ?? record(block.source) ?? {}
  const name = string(attachment.name) || string(block.name) || (block.type === 'image' ? '图片' : '文件')
  const facts = [string(attachment.mediaType) || string(attachment.mimeType)]
  if (typeof attachment.width === 'number' && typeof attachment.height === 'number') {
    facts.push(`${attachment.width} × ${attachment.height}`)
  }
  const id = string(attachment.attachmentId)
  if (id !== '') facts.push(`附件 ID：${id}`)
  facts.push('未嵌入文件')
  return `\n\n> 附件：${label(name)}（${facts.filter(Boolean).map(label).join('；')}）\n\n`
}

function messageText(content: readonly unknown[]): string {
  return content.map((raw) => {
    const block = record(raw)
    if (block === undefined) return ''
    switch (block.type) {
      case 'text': return string(block.text)
      case 'reasoning':
      case 'tool-call': return ''
      case 'image':
      case 'file':
      case 'attachment': return attachmentText(block)
      default: return `\n\n> 未导出的内容块：${label(string(block.type) || '未知类型')}\n\n`
    }
  }).join('')
}

function resultFailed(content: unknown): boolean {
  return blocks(content).some((raw) => {
    const block = record(raw)
    return block?.isError === true || (block?.type === 'tool-result' && resultFailed(block.content))
  })
}

function renderTool(entry: ToolEntry): string {
  const status = entry.failed ? '失败' : entry.complete ? '完成' : entry.started ? '未记录结果' : '未记录执行'
  const args = summarizeToolArguments(entry.arguments)
  const result = summarizeToolResult(entry.content, entry.failed, entry.error)
  return [
    `- ${code(entry.name)} — **${status}**${args === '' ? '' : ` · ${code(args)}`}`,
    result === '' ? '' : `\n${codeBlock(result).split('\n').map((line) => `  ${line}`).join('\n')}`,
  ].filter(Boolean).join('\n')
}

/**
 * Export the human transcript from the complete append-only log. Compaction
 * replacement events are model-only copies, never replacements for this view.
 */
export function exportSessionMarkdown(source: ExportSession, exportedAt = Date.now()): SessionExportPayload {
  const events = source.events.map(eventOf).filter((event): event is ExportEvent => event !== undefined)
  const originals = events.filter((event) => record(event.surfaceOp)?.op !== 'replace')
  const settledSteps = new Set(originals.filter((event) => event.type === 'assistant/message').map((event) => stepKey(event.data)))
  const entries: Entry[] = []
  const tools = new Map<string, ToolEntry>()
  const streams = new Map<string, { entry: MessageEntry; blocks: Map<number, StreamBlock> }>()
  const commands = new Map<string, NoteEntry>()
  let title = ''
  let firstPrompt = ''
  let turnOpen = false

  function tool(data: RecordValue, id: string, name?: string): ToolEntry {
    // Providers may reuse call ids across steps. Empty ids cannot be paired.
    const key = id === '' ? undefined : `${stepKey(data)}:${id}`
    const existing = key === undefined ? undefined : tools.get(key)
    if (existing !== undefined) {
      if (name) existing.name = name
      return existing
    }
    const entry: ToolEntry = { kind: 'tool', name: name || '工具结果', started: false, complete: false, failed: false }
    if (key !== undefined) tools.set(key, entry)
    entries.push(entry)
    return entry
  }

  for (const event of originals) {
    const data = event.data
    switch (event.type) {
      case 'session/title':
        if (string(data.title).trim() !== '') title = string(data.title).trim()
        break
      case 'turn/start':
        turnOpen = true
        break
      case 'turn/end': {
        turnOpen = false
        const reason = record(data.reason)
        const kind = string(reason?.kind)
        if (kind === 'error') {
          entries.push({ kind: 'note', text: `本轮失败\n\n${codeBlock(summarizeToolResult([], true, reason?.error) || '未知错误')}` })
        } else if (['aborted', 'interrupted', 'cancelled', 'canceled', 'blocked', 'max-tokens'].includes(kind)) {
          const status = kind === 'blocked' ? '本轮被阻止' : kind === 'max-tokens' ? '本轮达到输出上限' : '本轮已中断'
          entries.push({ kind: 'note', text: status })
        }
        break
      }
      case 'user/message':
      case 'steering/message': {
        const message = record(data.message) ?? data
        const kind = record(message.source)?.kind
        if (kind !== undefined && kind !== 'user') break
        const content = blocks(message.content)
        if (firstPrompt === '') firstPrompt = content.map((raw) => {
          const block = record(raw)
          return block?.type === 'text' ? string(block.text) : ''
        }).join('').trim()
        entries.push({ kind: 'message', role: '用户', time: event.time, content })
        break
      }
      case 'assistant/message': {
        const message = record(data.message) ?? data
        let content: unknown[] = []
        const flush = (): void => {
          if (content.length === 0) return
          entries.push({ kind: 'message', role: '助手', time: event.time, content, partial: data.interrupted === true })
          content = []
        }
        for (const raw of blocks(message.content)) {
          const block = record(raw)
          if (block?.type !== 'tool-call') {
            content.push(raw)
            continue
          }
          flush()
          const entry = tool(data, string(block.id), string(block.name))
          entry.arguments = block.arguments
        }
        flush()
        break
      }
      case 'assistant/chunk': {
        const key = stepKey(data)
        if (settledSteps.has(key)) break
        const chunk = record(data.chunk)
        if (chunk === undefined || typeof chunk.index !== 'number') break
        let stream = streams.get(key)
        if (stream === undefined) {
          const entry: MessageEntry = { kind: 'message', role: '助手', time: event.time, content: [], partial: true }
          stream = { entry, blocks: new Map() }
          streams.set(key, stream)
          entries.push(entry)
        }
        const previous = stream.blocks.get(chunk.index)
        if (chunk.type === 'block-start' && previous === undefined) {
          stream.blocks.set(chunk.index, { content: { type: chunk.blockType, text: '' }, closed: false })
        } else if (chunk.type === 'text-delta') {
          if (previous?.closed) break
          const content = previous?.content ?? { type: 'text', text: '' }
          stream.blocks.set(chunk.index, {
            content: { ...content, text: string(content.text) + string(chunk.text) },
            closed: false,
          })
        } else if (chunk.type === 'block-end' && !previous?.closed) {
          const block = record(chunk.block)
          if (block !== undefined) stream.blocks.set(chunk.index, { content: block, closed: true })
        }
        break
      }
      case 'tool/call': {
        const entry = tool(data, string(data.callId), string(data.name))
        entry.arguments = data.arguments
        entry.started = true
        break
      }
      case 'tool/result': {
        const message = record(data.message) ?? data
        const content = blocks(message.content)
        const result = content.map(record).find((block) => block?.type === 'tool-result')
        const id = string(record(message.source)?.callId) || string(result?.toolCallId) || string(data.callId)
        const entry = tool(data, id)
        entry.content = content
        entry.error = data.error
        entry.failed = data.error != null || data.isError === true || resultFailed(content)
        entry.complete = true
        break
      }
      case 'command/run': {
        const entry: NoteEntry = { kind: 'note', text: `命令：${code(`/${string(data.name)}${string(data.args)}`)}` }
        commands.set(string(data.commandId), entry)
        entries.push(entry)
        break
      }
      case 'command/done': {
        const entry = commands.get(string(data.commandId))
        const result = string(data.text)
        const text = `命令${data.kind === 'error' ? '失败' : '完成'}${result === '' ? '' : `\n\n${codeBlock(result)}`}`
        if (entry === undefined) entries.push({ kind: 'note', text })
        else entry.text += `\n\n${text}`
        break
      }
    }
  }

  for (const stream of streams.values()) {
    // Match the host assembler: first appearance order, first close wins.
    stream.entry.content = [...stream.blocks.values()]
      .map((block) => block.content)
      .filter((block) => block.type === 'text' || block.type === 'image')
  }

  title ||= [...firstPrompt.replace(/\s+/g, ' ')].slice(0, 80).join('') || '未命名会话'
  const metadata = [
    `- 会话 ID：${code(source.header.id)}`,
    source.header.cwd ? `- 工作目录：${code(source.header.cwd)}` : '',
    source.header.parentSession ? `- 分叉来源：${code(source.header.parentSession)}` : '',
    iso(source.header.createdAt) ? `- 创建时间：${iso(source.header.createdAt)}` : '',
    `- 导出时间：${iso(exportedAt) ?? '未知'}`,
  ].filter(Boolean)
  const sections = [
    `# ${label(title)}`,
    metadata.join('\n'),
    '> 已保留完整日志中的用户与助手正文（包括压缩前的历史）。工具请求与结果合并为摘要，过长参数或输出会标注省略；思考过程、系统及插件注入上下文、用量和重复流式片段不导出。附件仅记录引用信息，未嵌入文件。',
  ]
  if (turnOpen) sections.push('> 会话仍在进行中；以下仅包含导出时已进入会话日志的内容。尚未入日志的生成片段、未发送的草稿和排队输入不在本次导出范围内；已记录的未完成回复会标记。')

  let pendingTools: ToolEntry[] = []
  const flushTools = (): void => {
    if (pendingTools.length === 0) return
    const failed = pendingTools.filter((entry) => entry.failed).length
    sections.push(`<details>\n<summary>工具调用 · ${pendingTools.length} 次${failed === 0 ? '' : ` · ${failed} 次失败`}</summary>\n\n${pendingTools.map(renderTool).join('\n\n')}\n\n</details>`)
    pendingTools = []
  }
  let visible = 0
  for (const entry of entries) {
    if (entry.kind === 'tool') {
      pendingTools.push(entry)
      visible += 1
      continue
    }
    if (entry.kind === 'message') {
      const text = messageText(entry.content)
      if (text.trim() === '') continue
      flushTools()
      sections.push(`## ${entry.role}${iso(entry.time) ? ` · ${iso(entry.time)}` : ''}${entry.partial ? '（未完成）' : ''}\n\n${closeMessageFence(text)}`)
    } else {
      flushTools()
      sections.push(`### 会话状态\n\n${entry.text}`)
    }
    visible += 1
  }
  flushTools()
  if (visible === 0) sections.push('_此会话尚无可导出的对话。_')
  return { filename: sessionExportFilename(title, source.header.id), markdown: `${sections.join('\n\n')}\n` }
}
