/** Answers terminal capability queries that headless xterm does not handle. */
export class TerminalQueryResponder {
  private termcapBuffer = ''
  private oscBuffer = ''

  constructor(private readonly sendInput: (data: string) => void) {}

  consume(text: string): void {
    this.answerTermcap(text)
    this.answerOsc(text)
  }

  reset(): void {
    this.termcapBuffer = ''
    this.oscBuffer = ''
  }

  private answerTermcap(text: string): void {
    const prefix = '\x1bP+q'
    const terminator = '\x1b\\'
    const pending = this.termcapBuffer + text
    let index = 0
    for (;;) {
      const start = pending.indexOf(prefix, index)
      if (start === -1) {
        this.termcapBuffer = matchingSuffix(pending, [prefix])
        return
      }
      const end = pending.indexOf(terminator, start + prefix.length)
      const nextStart = pending.indexOf(prefix, start + prefix.length)
      if (nextStart !== -1 && (end === -1 || nextStart < end)) {
        index = nextStart
        continue
      }
      if (end === -1) {
        this.termcapBuffer = pending.slice(start)
        return
      }
      const query = pending.slice(start + prefix.length, end).toLowerCase()
      if (/^[0-9a-f]+$/.test(query)) {
        const value = XTGETTCAP_ANSWERS[query]
        this.sendInput(value === undefined
          ? `\x1bP0+r${query}${terminator}`
          : `\x1bP1+r${query}=${value}${terminator}`)
      }
      index = end + terminator.length
    }
  }

  private answerOsc(text: string): void {
    let pending = this.oscBuffer + text
    for (;;) {
      let hit: OscQuery | undefined
      for (const query of OSC_QUERIES) {
        const index = pending.indexOf(query.token)
        if (index !== -1 && (hit === undefined || index < hit.index)) hit = { ...query, index }
      }
      if (hit === undefined) break
      this.sendInput(hit.reply)
      pending = pending.slice(hit.index + hit.token.length)
    }
    this.oscBuffer = matchingSuffix(pending, OSC_QUERIES.map(query => query.token))
  }
}

const XTGETTCAP_ANSWERS: Record<string, string> = {
  '436f': '323536', '6b75': '1b4f41', '6b64': '1b4f42', '6b72': '1b4f43',
  '6b6c': '1b4f44', '2332': '1b5b313b3248', '2334': '1b5b313b3244',
  '2569': '1b5b313b3243', '6b34': '1b4f53', '6b35': '1b5b31357e',
  '6b32': '1b4f51', '6b33': '1b4f52', '6b36': '1b5b31377e',
  '2a37': '1b5b313b3246', '4631': '1b5b32337e', '4632': '1b5b32347e',
}

const terminator = '\x1b\\'
const OSC_QUERIES = [
  { token: '\x1b]10;?\x07', reply: `\x1b]10;rgb:e6e6/e6e6/e8e8${terminator}` },
  { token: '\x1b]11;?\x07', reply: `\x1b]11;rgb:1515/1515/1717${terminator}` },
  { token: '\x1b]12;?\x07', reply: `\x1b]12;rgb:e6e6/e6e6/e8e8${terminator}` },
  { token: `\x1b]10;?${terminator}`, reply: `\x1b]10;rgb:e6e6/e6e6/e8e8${terminator}` },
  { token: `\x1b]11;?${terminator}`, reply: `\x1b]11;rgb:1515/1515/1717${terminator}` },
  { token: `\x1b]12;?${terminator}`, reply: `\x1b]12;rgb:e6e6/e6e6/e8e8${terminator}` },
] as const

interface OscQuery {
  token: string
  reply: string
  index: number
}

function matchingSuffix(input: string, tokens: readonly string[]): string {
  const max = Math.max(...tokens.map(token => token.length)) - 1
  for (let length = Math.min(max, input.length); length > 0; length -= 1) {
    const suffix = input.slice(input.length - length)
    if (tokens.some(token => token.startsWith(suffix))) return suffix
  }
  return ''
}
