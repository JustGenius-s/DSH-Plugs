export interface FindOptions {
  matchCase: boolean
  wholeWord: boolean
  regex: boolean
}

export interface FindMatch {
  line: number
  start: number
  end: number
}

export interface FindResult {
  matches: FindMatch[]
  invalidRegex: boolean
}

/** Pure, reusable file-buffer search independent of the React find widget. */
export function collectFindMatches(
  lines: readonly string[],
  query: string,
  options: FindOptions,
): FindResult {
  if (query.length === 0) return { matches: [], invalidRegex: false }
  let pattern: RegExp
  try {
    pattern = buildFindPattern(query, options)
  } catch {
    return { matches: [], invalidRegex: true }
  }
  const matches: FindMatch[] = []
  for (let line = 0; line < lines.length; line += 1) {
    const input = lines[line] ?? ''
    if (input.length === 0 && !options.regex) continue
    pattern.lastIndex = 0
    let match = pattern.exec(input)
    while (match !== null) {
      const text = match[0] ?? ''
      if (text.length === 0) {
        if (pattern.lastIndex >= input.length) break
        pattern.lastIndex += 1
      } else {
        matches.push({ line, start: match.index, end: match.index + text.length })
      }
      if (!pattern.global) break
      match = pattern.exec(input)
    }
  }
  return { matches, invalidRegex: false }
}

function buildFindPattern(query: string, options: FindOptions): RegExp {
  const flags = options.matchCase ? 'g' : 'gi'
  let source = options.regex ? query : escapeRegExp(query)
  if (options.wholeWord) source = `(?<![\\w])(?:${source})(?![\\w])`
  return new RegExp(source, flags)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
