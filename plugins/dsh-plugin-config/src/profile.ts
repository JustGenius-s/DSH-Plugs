import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface ProfilePackageJson {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

export function profileDir(): string {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'profiles', 'web')
}

export function profilePackagePath(): string {
  return join(profileDir(), 'package.json')
}

export function profilePatchPath(): string {
  return join(profileDir(), 'cordis.patch.yml')
}

export function readProfilePackage(): ProfilePackageJson {
  const file = profilePackagePath()
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as ProfilePackageJson
  } catch {
    return {}
  }
}

export function readUserDisabledIds(text = readPatchText()): Set<string> {
  const ids = new Set<string>()
  const blocks = splitPatchBlocks(text)
  for (const block of blocks) {
    if (block.kind !== 'id') continue
    if (block.disabled === true) ids.add(block.id)
  }
  return ids
}

export function readPatchText(): string {
  const file = profilePatchPath()
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

export function writeDisablePatch(id: string, disabled: boolean): void {
  const next = upsertDisable(readPatchText(), id, disabled)
  writeFileSync(profilePatchPath(), next)
}

export function removeDisablePatch(id: string): void {
  const next = dropDisable(readPatchText(), id)
  writeFileSync(profilePatchPath(), next)
}

interface IdBlock {
  kind: 'id'
  id: string
  disabled: boolean | null
  raw: string
}

interface OtherBlock {
  kind: 'other'
  raw: string
}

function splitPatchBlocks(text: string): Array<IdBlock | OtherBlock> {
  if (text.trim() === '' || text.trim() === '[]') return []
  const chunks = text.split(/(?=^- )/m)
  return chunks.map((raw) => {
    const idMatch = /^- id:\s*(\S+)/m.exec(raw)
    if (!idMatch) return { kind: 'other', raw } satisfies OtherBlock
    const disabledMatch = /^\s+disabled:\s*(true|false)\s*$/m.exec(raw)
    return {
      kind: 'id',
      id: idMatch[1] ?? '',
      disabled: disabledMatch ? disabledMatch[1] === 'true' : null,
      raw,
    } satisfies IdBlock
  })
}

function upsertDisable(text: string, id: string, disabled: boolean): string {
  const header = text.includes('Your patch layer') || text.trim() === '' || text.trim() === '[]'
    ? ensureHeader(text)
    : text
  const source = header.trim() === '[]' ? '' : header
  const blocks = splitPatchBlocks(source)
  let found = false
  const next: string[] = []
  for (const block of blocks) {
    if (block.kind !== 'id' || block.id !== id) {
      next.push(block.raw)
      continue
    }
    found = true
    next.push(setDisabled(block.raw, disabled))
  }
  if (!found) {
    const suffix = source.endsWith('\n') || source === '' ? '' : '\n'
    return `${source}${suffix}- id: ${id}\n  disabled: ${disabled ? 'true' : 'false'}\n`
  }
  const joined = next.join('').replace(/\s*$/, '\n')
  return joined === '\n' ? ensureHeader('') : joined
}

function ensureHeader(text: string): string {
  if (text.includes('Your patch layer')) return text.trim() === '[]' ? text.replace('[]', '').replace(/\s*$/, '\n') : text
  return `# Your patch layer for this dsh profile, applied after every bundle layer.\n`
}

function setDisabled(raw: string, disabled: boolean): string {
  const value = disabled ? 'true' : 'false'
  if (/^\s+disabled:\s*/m.test(raw)) {
    return raw.replace(/^\s+disabled:\s*(true|false)\s*$/m, `  disabled: ${value}`)
  }
  return raw.replace(/\s*$/, '\n') + `  disabled: ${value}\n`
}

function dropDisable(text: string, id: string): string {
  const blocks = splitPatchBlocks(text)
  if (blocks.length === 0) return text
  const next: string[] = []
  for (const block of blocks) {
    if (block.kind !== 'id' || block.id !== id) {
      next.push(block.raw)
      continue
    }
    const stripped = block.raw.replace(/^\s+disabled:\s*(true|false)\s*\n?/m, '')
    const lines = stripped.split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'))
    if (lines.length === 1 && lines[0] === `- id: ${id}`) continue
    next.push(stripped)
  }
  const joined = next.join('').replace(/\s*$/, '\n')
  return joined === '\n' ? `${text.split('\n').filter((line) => line.startsWith('#')).join('\n')}\n` : joined
}
