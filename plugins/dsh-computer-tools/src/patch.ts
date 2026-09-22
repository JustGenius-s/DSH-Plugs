import { ALL_OFFICIAL_PACKAGES, MANAGED_MARKER, type PatchEntry } from './shared.ts'
import { capabilityOfPackage, isManagedId } from './catalog.ts'

interface Block {
  raw: string
}

export function parsePatchEntries(text: string): PatchEntry[] {
  const entries: PatchEntry[] = []
  for (const block of splitTopLevel(text)) {
    if (isInsertBlock(block.raw)) {
      entries.push(...parseInsertEntries(block.raw))
      continue
    }
    const single = parseIdBlock(block.raw)
    if (single !== null) entries.push(single)
  }
  return entries
}

export function applyDesiredPatch(
  text: string,
  desired: readonly PatchEntry[],
  options: {
    removeForeign: boolean
    capabilities: ReadonlySet<'browser' | 'computer'>
  },
): string {
  const kept: string[] = []
  for (const block of splitTopLevel(text)) {
    if (isManagedBlock(block.raw)) continue
    if (isInsertBlock(block.raw)) {
      const remaining = parseInsertEntries(block.raw).filter((entry) => !shouldDrop(entry, options))
      if (remaining.length === 0) continue
      kept.push(serializeInsert(remaining).replace(/\n$/, ''))
      continue
    }
    const single = parseIdBlock(block.raw)
    if (single && shouldDrop(single, options)) continue
    const trimmed = block.raw.replace(/\s*$/, '')
    if (trimmed !== '') kept.push(trimmed)
  }
  const prefix = kept.join('\n').replace(/\s*$/, '')
  if (desired.length === 0) return prefix === '' ? '' : `${prefix}\n`
  const managed = `${MANAGED_MARKER}\n${serializeInsert(desired)}`
  return prefix === '' ? managed : `${prefix}\n${managed}`
}

export function serializeInsert(entries: readonly PatchEntry[]): string {
  const lines = ['- insert:']
  for (const entry of entries) {
    lines.push(`    - id: ${entry.id}`)
    lines.push(`      name: ${yamlQuote(entry.name)}`)
    const keys = Object.keys(entry.config)
    if (keys.length === 0) continue
    lines.push('      config:')
    for (const key of keys) {
      lines.push(`        ${key}: ${formatValue(entry.config[key])}`)
    }
  }
  return `${lines.join('\n')}\n`
}

function shouldDrop(
  entry: PatchEntry,
  options: { removeForeign: boolean; capabilities: ReadonlySet<'browser' | 'computer'> },
): boolean {
  if (isManagedId(entry.id)) return true
  if (!options.removeForeign) return false
  const capability = capabilityOfPackage(entry.name)
  return capability !== null && ALL_OFFICIAL_PACKAGES.has(entry.name) && options.capabilities.has(capability)
}

function splitTopLevel(text: string): Block[] {
  if (text.trim() === '' || text.trim() === '[]') return []
  const blocks: Block[] = []
  let current: string[] = []

  const flush = () => {
    const raw = current.join('\n').replace(/\s*$/, '')
    current = []
    if (raw !== '') blocks.push({ raw })
  }

  const currentIsMarkerPrefix = () => {
    const meaningful = current.filter((line) => line.trim() !== '')
    return meaningful.length > 0 && meaningful.every((line) => line.trim() === MANAGED_MARKER)
  }

  for (const line of text.split('\n')) {
    if (/^- /.test(line)) {
      if (current.length > 0 && !currentIsMarkerPrefix()) flush()
      current.push(line)
      continue
    }
    if (line.trim() === MANAGED_MARKER && current.some((item) => /^- /.test(item))) {
      flush()
      current.push(line)
      continue
    }
    current.push(line)
  }
  flush()
  return blocks
}

function isManagedBlock(raw: string): boolean {
  if (!raw.includes(MANAGED_MARKER)) return false
  const item = firstDocumentItem(raw)
  return item === 'insert' || item === null
}

function isInsertBlock(raw: string): boolean {
  return firstDocumentItem(raw) === 'insert'
}

function firstDocumentItem(raw: string): string | null {
  for (const line of raw.split('\n')) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const match = /^- ([^:\s]+):/.exec(line)
    return match?.[1] ?? null
  }
  return null
}

function parseInsertEntries(raw: string): PatchEntry[] {
  const lines = raw.split('\n')
  const start = lines.findIndex((line) => /^- insert:[ \t]*$/.test(line))
  const body = start < 0 ? raw : lines.slice(start + 1).join('\n')
  const parts = body.split(/^(?=[ \t]*- id: )/m)
  const entries: PatchEntry[] = []
  for (const part of parts) {
    if (part.trim() === '') continue
    const parsed = parseNestedItem(part)
    if (parsed !== null) entries.push(parsed)
  }
  return entries
}

function parseIdBlock(raw: string): PatchEntry | null {
  const idMatch = /^- id:\s*(\S+)/m.exec(raw)
  const nameMatch = /^\s+name:\s*(.+)$/m.exec(raw)
  if (!idMatch || !nameMatch) return null
  return {
    id: idMatch[1] ?? '',
    name: parseScalar(nameMatch[1] ?? ''),
    config: parseConfig(raw),
  }
}

function parseNestedItem(raw: string): PatchEntry | null {
  const idMatch = /^[ \t]*- id:\s*(\S+)/m.exec(raw)
  const nameMatch = /^[ \t]+name:\s*(.+)$/m.exec(raw)
  if (!idMatch || !nameMatch) return null
  return {
    id: idMatch[1] ?? '',
    name: parseScalar(nameMatch[1] ?? ''),
    config: parseConfig(raw),
  }
}

function parseConfig(raw: string): Record<string, unknown> {
  const lines = raw.split('\n')
  const start = lines.findIndex((line) => /^\s*config:\s*(?:$|\S)/.test(line))
  if (start < 0) return {}
  const indent = /^(\s*)/.exec(lines[start] ?? '')?.[1]?.length ?? 0
  const keyIndent = ' '.repeat(indent + 2)
  const config: Record<string, unknown> = {}
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '') continue
    if (!line.startsWith(keyIndent)) break
    const match = new RegExp(`^${keyIndent}([^:\\s]+):\\s*(.*)$`).exec(line)
    if (!match) continue
    const key = match[1] ?? ''
    const rest = match[2] ?? ''
    config[key] = parseYamlValue(rest)
  }
  return config
}

function parseYamlValue(raw: string): unknown {
  const value = raw.trim()
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === '') return ''
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim()
    if (inner === '') return []
    return inner.split(',').map((item) => parseScalar(item.trim())).filter((item) => item !== '')
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  return parseScalar(value)
}

function parseScalar(raw: string): string {
  const value = raw.trim()
  if (
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    || (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
  ) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  return value
}

function formatValue(value: unknown): string {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    const items = value.map((item) => typeof item === 'string' && /[\s,:]/.test(item) ? yamlQuote(item) : String(item))
    return `[${items.join(', ')}]`
  }
  if (typeof value === 'string') {
    if (value === '') return "''"
    if (/[:#{}[\],&*?|>!%@`'"]/.test(value) || value.includes(' ') || value.startsWith('@')) {
      return yamlQuote(value)
    }
    return value
  }
  return yamlQuote(String(value))
}

function yamlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
