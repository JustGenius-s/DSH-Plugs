import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  mintMemoryId,
  type MemoryEntry,
  type MemoryMeta,
  type MemorySource,
} from './shared.ts'

interface MemoryIndex {
  version: 1
  entries: MemoryMeta[]
}

function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function rootDir(): string {
  return join(dshHome(), 'memory')
}

function indexPath(): string {
  return join(rootDir(), 'index.json')
}

function entriesDir(): string {
  return join(rootDir(), 'entries')
}

function entryPath(id: string): string {
  return join(entriesDir(), `${id}.md`)
}

function ensureDirs(): void {
  mkdirSync(entriesDir(), { recursive: true })
}

function atomicWrite(file: string, body: string): void {
  ensureDirs()
  const tmp = `${file}.tmp`
  writeFileSync(tmp, body, 'utf8')
  renameSync(tmp, file)
}

function emptyIndex(): MemoryIndex {
  return { version: 1, entries: [] }
}

function normalizeMeta(raw: unknown): MemoryMeta | null {
  if (raw === null || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string' || value.id.trim() === '') return null
  if (typeof value.title !== 'string') return null
  if (typeof value.enabled !== 'boolean') return null
  if (value.source !== 'manual' && value.source !== 'ai') return null
  if (typeof value.createdAt !== 'number' || typeof value.updatedAt !== 'number') return null
  return {
    id: value.id,
    title: value.title.trim() || 'Untitled',
    enabled: value.enabled,
    source: value.source,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

function loadIndex(): MemoryIndex {
  try {
    const raw = JSON.parse(readFileSync(indexPath(), 'utf8')) as { version?: unknown; entries?: unknown }
    if (!Array.isArray(raw.entries)) return emptyIndex()
    const entries: MemoryMeta[] = []
    for (const item of raw.entries) {
      const meta = normalizeMeta(item)
      if (meta !== null) entries.push(meta)
    }
    return { version: 1, entries }
  } catch {
    return emptyIndex()
  }
}

function saveIndex(index: MemoryIndex): void {
  atomicWrite(indexPath(), `${JSON.stringify(index, null, 2)}\n`)
}

function readContent(id: string): string {
  try {
    return readFileSync(entryPath(id), 'utf8')
  } catch {
    return ''
  }
}

function writeContent(id: string, content: string): void {
  atomicWrite(entryPath(id), content.endsWith('\n') ? content : `${content}\n`)
}

function removeContent(id: string): void {
  try {
    unlinkSync(entryPath(id))
  } catch {
    // missing file is fine
  }
}

/** Drop orphan .md files that are no longer in the index. */
function pruneOrphans(index: MemoryIndex): void {
  if (!existsSync(entriesDir())) return
  const keep = new Set(index.entries.map((entry) => `${entry.id}.md`))
  for (const name of readdirSync(entriesDir())) {
    if (!name.endsWith('.md') || keep.has(name)) continue
    try {
      unlinkSync(join(entriesDir(), name))
    } catch {
      // best-effort
    }
  }
}

export function listMetas(): MemoryMeta[] {
  return loadIndex().entries.slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getEntry(id: string): MemoryEntry | null {
  const meta = loadIndex().entries.find((entry) => entry.id === id)
  if (meta === undefined) return null
  return { ...meta, content: readContent(id) }
}

export function listEntries(): MemoryEntry[] {
  return listMetas().map((meta) => ({ ...meta, content: readContent(meta.id) }))
}

export function createEntry(input: {
  title: string
  content: string
  source: MemorySource
  enabled?: boolean
}): MemoryEntry {
  const now = Date.now()
  const meta: MemoryMeta = {
    id: mintMemoryId(),
    title: input.title.trim() || 'Untitled',
    enabled: input.enabled !== false,
    source: input.source,
    createdAt: now,
    updatedAt: now,
  }
  const index = loadIndex()
  index.entries.unshift(meta)
  writeContent(meta.id, input.content.trim())
  saveIndex(index)
  return { ...meta, content: input.content.trim() }
}

export function updateEntry(
  id: string,
  patch: { title?: string; content?: string; enabled?: boolean },
): MemoryEntry | null {
  const index = loadIndex()
  const idx = index.entries.findIndex((entry) => entry.id === id)
  if (idx < 0) return null
  const prev = index.entries[idx]!
  const next: MemoryMeta = {
    ...prev,
    title: patch.title !== undefined ? (patch.title.trim() || 'Untitled') : prev.title,
    enabled: patch.enabled !== undefined ? patch.enabled : prev.enabled,
    updatedAt: Date.now(),
  }
  index.entries[idx] = next
  if (patch.content !== undefined) writeContent(id, patch.content.trim())
  saveIndex(index)
  return { ...next, content: patch.content !== undefined ? patch.content.trim() : readContent(id) }
}

export function deleteEntry(id: string): boolean {
  const index = loadIndex()
  const next = index.entries.filter((entry) => entry.id !== id)
  if (next.length === index.entries.length) return false
  index.entries = next
  removeContent(id)
  saveIndex(index)
  pruneOrphans(index)
  return true
}

export function memoryRoot(): string {
  return rootDir()
}
