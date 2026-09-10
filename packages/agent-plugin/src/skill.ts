/**
 * Parse a SKILL.md (YAML frontmatter + markdown body).
 * Frontmatter fields used: name, description.
 */

export interface ParsedSkillMarkdown {
  name: string
  description: string
  body: string
}

export function parseSkillMarkdown(
  markdown: string,
  fallbackName: string,
): ParsedSkillMarkdown {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(markdown)
  if (!match) {
    return {
      name: fallbackName,
      description: fallbackName,
      body: markdown.trim(),
    }
  }
  const frontmatter = match[1] ?? ''
  const body = (match[2] ?? '').trim()
  const fields = parseSimpleYaml(frontmatter)
  const name = typeof fields.name === 'string' && fields.name.trim() !== ''
    ? fields.name.trim()
    : fallbackName
  const description = typeof fields.description === 'string' && fields.description.trim() !== ''
    ? fields.description.trim()
    : name
  return { name, description, body }
}

/** Tiny YAML subset: `key: value` and `key: |` / `key: >` multiline scalars. */
function parseSimpleYaml(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = text.split(/\r?\n/)
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!kv) {
      index += 1
      continue
    }
    const key = kv[1] ?? ''
    const raw = kv[2] ?? ''
    if (raw === '|' || raw === '>') {
      const block: string[] = []
      index += 1
      while (index < lines.length) {
        const next = lines[index] ?? ''
        if (/^[A-Za-z0-9_-]+:\s*/.test(next) && !/^\s/.test(next)) break
        block.push(next.replace(/^\s{2}/, ''))
        index += 1
      }
      result[key] = block.join('\n').trim()
      continue
    }
    result[key] = stripQuotes(raw.trim())
    index += 1
  }
  return result
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}
