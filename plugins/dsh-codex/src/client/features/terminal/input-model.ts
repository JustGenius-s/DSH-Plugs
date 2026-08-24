import type { TerminalCompletionCandidate } from '../../../shared/terminal-protocol'

export interface CompletionMenu {
  start: number
  end: number
  candidates: TerminalCompletionCandidate[]
  selectedIndex: number
}

export const MAX_HISTORY_ENTRIES = 2000
const COMPLETION_MENU_ROWS = 12

export function pasteInputBytes(text: string, bracketedPaste: boolean): string {
  const normalized = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r')
  return bracketedPaste ? `\x1b[200~${normalized}\x1b[201~` : normalized
}

export function visibleCompletionRows(
  menu: CompletionMenu,
): Array<{ index: number; candidate: TerminalCompletionCandidate }> {
  const count = menu.candidates.length
  const windowSize = Math.min(COMPLETION_MENU_ROWS, count)
  const selected = Math.max(0, Math.min(menu.selectedIndex, count - 1))
  const start = count <= windowSize ? 0 : Math.max(0, Math.min(selected - 2, count - windowSize))
  return menu.candidates.slice(start, start + windowSize).map((candidate, offset) => ({
    index: start + offset,
    candidate,
  }))
}

export function historyGhost(history: string[], input: string): string | null {
  if (input.length === 0) return null
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const command = history[index]
    if (command.length > input.length && command.startsWith(input)) return command.slice(input.length)
  }
  return null
}

export function historyPrefixMatches(history: string[], input: string, limit = 12): string[] {
  const seen = new Set<string>()
  const matches: string[] = []
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const command = history[index]
    if (command.length === 0) continue
    if (input.length > 0 && !command.startsWith(input)) continue
    if (seen.has(command)) continue
    seen.add(command)
    matches.push(command)
    if (matches.length >= limit) break
  }
  return matches
}

export function mergeHistory(loaded: string[], session: string[]): string[] {
  if (loaded.length === 0) return session.slice()
  if (session.length === 0) return loaded.slice()
  let overlap = 0
  const maxOverlap = Math.min(loaded.length, session.length)
  for (let size = maxOverlap; size > 0; size -= 1) {
    let same = true
    for (let index = 0; index < size; index += 1) {
      if (loaded[loaded.length - size + index] !== session[index]) {
        same = false
        break
      }
    }
    if (same) {
      overlap = size
      break
    }
  }
  const next = loaded.concat(session.slice(overlap))
  return next.length > MAX_HISTORY_ENTRIES ? next.slice(next.length - MAX_HISTORY_ENTRIES) : next
}

export function historyNavigationAllowed(value: string, cursor: number, direction: number): boolean {
  if (!value.includes('\n')) return true
  return direction < 0 ? !value.slice(0, cursor).includes('\n') : !value.slice(cursor).includes('\n')
}

export function lineBounds(value: string, cursor: number): { start: number; end: number } {
  const start = value.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1
  const nextBreak = value.indexOf('\n', cursor)
  return { start, end: nextBreak === -1 ? value.length : nextBreak }
}

export function wordCaret(value: string, cursor: number, direction: -1 | 1): number {
  if (direction < 0) {
    let next = cursor
    while (next > 0 && /\s/.test(value[next - 1])) next -= 1
    while (next > 0 && !/\s/.test(value[next - 1])) next -= 1
    return next
  }
  let next = cursor
  while (next < value.length && !/\s/.test(value[next])) next += 1
  while (next < value.length && /\s/.test(value[next])) next += 1
  return next
}

export function keyToBytes(event: KeyboardEvent): string | null {
  const escape = '\x1b'
  if (event.ctrlKey && event.key.length === 1) {
    const code = event.key.toUpperCase().charCodeAt(0)
    if (code >= 64 && code <= 95) return String.fromCharCode(code - 64)
    return null
  }
  if (event.metaKey) return null
  switch (event.key) {
    case 'Enter': return '\r'
    case 'Backspace': return '\x7f'
    case 'Tab': return '\t'
    case 'Escape': return escape
    case 'ArrowUp': return `${escape}[A`
    case 'ArrowDown': return `${escape}[B`
    case 'ArrowRight': return `${escape}[C`
    case 'ArrowLeft': return `${escape}[D`
    case 'Home': return `${escape}[H`
    case 'End': return `${escape}[F`
    case 'PageUp': return `${escape}[5~`
    case 'PageDown': return `${escape}[6~`
    case 'Delete': return `${escape}[3~`
    case 'Insert': return `${escape}[2~`
    default: break
  }
  return event.key.length === 1 ? event.key : null
}
