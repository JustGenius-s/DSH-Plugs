const ARGUMENT_LIMIT = 300
const RESULT_LIMIT = 800
const ERROR_RESULT_LIMIT = 1_600
const TRUNCATED = '\n[… output truncated …]\n'

const targetKeys = [
  'command', 'cmd', 'file_path', 'filePath', 'path', 'paths', 'query', 'pattern',
  'url', 'urls', 'cwd', 'workdir', 'working_directory', 'directory', 'filename',
  'recipient_name', 'name',
]
const omittedArgumentKey = /(?:^|_)(?:content|contents|patch|diff|data|base64|body|old_string|new_string|old_text|new_text|edits?|token|tokens|password|secret|authorization|api_key)(?:$|_)/i

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Keep both the operation's context and its final status when shortening logs. */
function shorten(value: string, limit: number): string {
  if (value.length <= limit) return value
  const available = limit - TRUNCATED.length
  const head = Math.ceil(available * 0.65)
  return value.slice(0, head) + TRUNCATED + value.slice(-(available - head))
}

function cleanText(value: string): string {
  return value
    // CSI styles and OSC terminal hyperlinks/title changes are presentation only.
    .replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\))/g, '')
    .replace(/\u009B[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/data:[^,\s]*;base64,[A-Za-z0-9+/_=-]+/gi, '[base64 data omitted]')
    .replace(/(?:^|(?<=[\s"'=:]))[A-Za-z0-9+/]{256,}={0,2}(?=$|[\s"',}\]])/g, '[base64 data omitted]')
}

function scalar(value: unknown): string | undefined {
  if (typeof value === 'string') return cleanText(value)
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  if (value === null) return 'null'
  return undefined
}

function argumentValue(value: unknown): string {
  const text = scalar(value)
  if (text !== undefined) return shorten(text.replace(/\s+/g, ' ').trim(), 180)
  if (Array.isArray(value)) {
    // Lists of paths/URLs are useful; nested payloads should not become raw JSON.
    const items = value.slice(0, 3).map(item => scalar(item) ?? '[object]')
    if (value.length > 3) items.push(`[… ${value.length - 3} items omitted]`)
    return shorten(items.join(', '), 180)
  }
  if (record(value)) return `[object: ${Object.keys(value).length} fields]`
  return '[unavailable]'
}

/** A compact call target, never a serialization of a file body or edit payload. */
export function summarizeToolArguments(raw: unknown): string {
  let value = raw
  if (typeof raw === 'string') {
    if (!raw.trim()) return ''
    try {
      value = JSON.parse(raw)
    } catch {
      // Some tools (notably patch tools) accept a non-JSON body.
      if (/^\s*(?:\*\*\* Begin Patch|diff --git |--- [^\n]+\n\+\+\+ )/.test(raw)) {
        return '[patch content omitted]'
      }
      return shorten(cleanText(raw), ARGUMENT_LIMIT)
    }
  }

  if (value === undefined || value === null) return ''
  if (!record(value)) return shorten(argumentValue(value), ARGUMENT_LIMIT)

  const keys = Object.keys(value)
  const selected = targetKeys.filter(key => Object.hasOwn(value, key))
  if (!selected.length) {
    selected.push(...keys.filter(key => !omittedArgumentKey.test(
      key.replace(/([a-z])([A-Z])/g, '$1_$2'),
    )).slice(0, 3))
  }
  const omitted = keys.length - selected.length
  const summary = selected.map(key => `${cleanText(key)}: ${argumentValue(value[key])}`).join('; ')
  const suffix = omitted > 0 ? `${summary ? '; ' : ''}[… ${omitted} fields omitted]` : ''
  return shorten(summary, ARGUMENT_LIMIT - suffix.length) + suffix
}

interface CollectedResult {
  parts: string[]
  failed: boolean
}

function attachmentDescription(block: Record<string, unknown>, type: string): string {
  const attachment = record(block.attachment) ? block.attachment : block
  const label = [attachment.filename, attachment.name, attachment.mimeType, attachment.mediaType]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map(value => shorten(cleanText(value), 100))
    .join(', ')
  return `[${type}${label ? `: ${label}` : ''}; attachment omitted]`
}

function collectResult(value: unknown, result: CollectedResult, seen: Set<object>, depth = 0): void {
  if (value === undefined || value === null) return
  if (typeof value === 'string') {
    const text = cleanText(value)
    if (text.trim()) result.parts.push(text)
    return
  }
  if (typeof value !== 'object') {
    const text = scalar(value)
    if (text !== undefined) result.parts.push(text)
    return
  }
  if (seen.has(value) || depth > 16) {
    result.parts.push('[nested output omitted]')
    return
  }
  seen.add(value)
  if (Array.isArray(value)) {
    for (const block of value) collectResult(block, result, seen, depth + 1)
  } else if (record(value)) {
    const type = typeof value.type === 'string' ? value.type : undefined
    if (value.isError === true) result.failed = true
    if (type === 'tool-result' || (type === undefined && 'content' in value)) {
      // Canonical content wins over alternate text/JSON representations.
      collectResult(value.content, result, seen, depth + 1)
    } else if (type === 'text' || (type === undefined && typeof value.text === 'string')) {
      collectResult(value.text, result, seen, depth + 1)
    } else if (type === 'image' || type === 'audio' || type === 'file' || type === 'attachment') {
      result.parts.push(attachmentDescription(value, type))
    } else if (type === undefined && ('message' in value || 'code' in value || 'name' in value || 'reason' in value)) {
      const text = errorSummary(value, '')
      if (text) result.parts.push(text)
    } else {
      result.parts.push(`[${type ? shorten(cleanText(type), 80) : 'unknown'} output omitted]`)
    }
  }
  seen.delete(value)
}

function errorSummary(error: unknown, output: string): string {
  if (!record(error)) {
    const message = scalar(error)
    return message && !output.includes(message) ? message : ''
  }
  return ['name', 'code', 'message', 'reason']
    .flatMap((key) => {
      const text = scalar(error[key])
      if (!text || ((key === 'message' || key === 'reason') && output.includes(text))) return []
      return [`${key}: ${text}`]
    })
    .join('; ')
}

/** Preserve short results, bound long logs, and replace binary attachments by labels. */
export function summarizeToolResult(content: unknown, failed: boolean, error?: unknown): string {
  const collected: CollectedResult = { parts: [], failed }
  collectResult(content, collected, new Set())
  const output = collected.parts.join('\n')
  const failure = errorSummary(error, output)
  const text = [failure, output].filter(Boolean).join('\n')
  return shorten(text, collected.failed ? ERROR_RESULT_LIMIT : RESULT_LIMIT)
}
