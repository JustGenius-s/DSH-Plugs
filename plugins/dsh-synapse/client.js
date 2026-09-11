window.__ModuleLoader__.load({
  id: 'dsh-synapse',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    let primitives = null
    try { primitives = require('@deepseek-ai/dsh-client-ui-primitives') } catch { primitives = null }
    const module = { exports: {} }
    // Card state-machine inputs. DSH already carries every signal on its
    // session summary: `running` (the agent is working), `pendingInteraction`
    // (blocked on a human — approval / plan-review / question, which is the
    // sidebar's amber dot), and `completed` (finished while not selected, the
    // green done reminder).
    const statusOf = session => ({
      running: session.running === true,
      pendingInteraction: typeof session.pendingInteraction === 'string' ? session.pendingInteraction : null,
      completed: session.completed === true,
      blank: session.blank === true,
    })
    const currentSession = ctx => {
      const snapshot = ctx.sessions.list.getSnapshot()
      const id = snapshot.current
      if (id === undefined) return null
      const session = snapshot.byId[id]
      return session === undefined ? null : { id, title: session.displayTitle, cwd: session.cwd ?? null, parentId: session.parentId ?? null, ...statusOf(session) }
    }
    const sessionSnapshot = ctx => {
      const snapshot = ctx.sessions.list.getSnapshot()
      return snapshot.ids.map(id => {
        const session = snapshot.byId[id]
        return session === undefined ? null : { id, title: session.displayTitle, cwd: session.cwd ?? null, parentId: session.parentId ?? null, blank: session.blank, ...statusOf(session) }
      }).filter(Boolean)
    }
    const rootIdsOf = (sessions, ids) => ids.filter(id => sessions.byId[id]?.parentId == null)
    const workspaceSnapshot = ctx => {
      const sessions = ctx.sessions.list.getSnapshot()
      const snapshot = ctx.workspaces.list.getSnapshot()
      const accounted = new Set(snapshot.items.flatMap(workspace => workspace.sessionIds))
      const ungrouped = sessions.ids.filter(id => !accounted.has(id))
      return [
        ...snapshot.items.map(workspace => ({
          id: workspace.workspaceId,
          title: workspace.title,
          path: workspace.path,
          sessionIds: workspace.sessionIds,
          rootSessionIds: rootIdsOf(sessions, workspace.sessionIds),
        })),
        { id: 'dsh-ungrouped', title: '未分组', path: null, sessionIds: ungrouped, rootSessionIds: rootIdsOf(sessions, ungrouped) },
      ]
    }

    const TOOL_VARIANTS = { bash: 'bash', pwsh: 'bash', read: 'read', web_fetch: 'web', web_search: 'search', search: 'search', grep: 'search', glob: 'search', write: 'write', edit: 'edit', run_code: 'code', todo_write: 'todo', todo: 'todo', job: 'job', ask_user_question: 'question', skill: 'skill', workflow: 'code', ralph: 'agent', subagent: 'agent', view_image: 'image' }
    const TOOL_TITLES = { search: 'Search', read: '读取', bash: '命令', write: '写入', edit: '编辑', code: '代码', todo: '任务清单', job: '后台任务', web: '网页', agent: '子代理', skill: '技能', question: '提问', image: '图片', others: '工具调用' }
    const TOOL_SUMMARY_KEYS = {
      bash: ['description', 'command', 'cmd'],
      search: ['query', 'keywords', 'pattern', 'q'],
      read: ['path', 'file_path'],
      write: ['path', 'file_path'],
      edit: ['path', 'file_path'],
      code: ['code', 'source', 'name'],
      todo: ['todos'],
      job: ['jobId', 'id', 'title'],
      web: ['url'],
      agent: ['description', 'prompt', 'objective'],
      skill: ['skill', 'name'],
      question: ['questions'],
      image: ['path', 'file_path', 'url'],
      others: ['path', 'file_path', 'url', 'description', 'command', 'name'],
    }
    const seqOf = node => {
      if (node == null) return undefined
      if (typeof node.anchorSeq === 'number' && Number.isFinite(node.anchorSeq)) return node.anchorSeq
      const data = node.data
      const raw = data !== null && typeof data === 'object' ? data.seq : undefined
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
    }
    const nodeOfChat = (chat, key) => {
      if (chat == null || chat.nodes == null) return undefined
      return typeof chat.nodes.get === 'function' ? chat.nodes.get(key) : chat.nodes[key]
    }
    const assistantTextOfBlocks = blocks => Array.isArray(blocks)
      ? blocks.filter(block => block?.kind === 'text').map(block => String(block.text ?? '')).join('\n')
      : ''
    const replyTextOfSnapshot = snapshot => {
      const partial = assistantTextOfBlocks(snapshot?.partial?.blocks)
      if (partial !== '') return partial
      const keys = Array.from(snapshot?.chat?.order ?? [])
      for (let index = keys.length - 1; index >= 0; index--) {
        const node = nodeOfChat(snapshot?.chat, keys[index])
        if (node?.visibility === 'hidden') continue
        if (node?.kind === 'user' || node?.kind === 'steering') return ''
        if (node?.kind !== 'assistant-step') continue
        const text = assistantTextOfBlocks(node.data?.blocks)
        if (text !== '') return text
      }
      return ''
    }
    const turnNumberOf = node => {
      const location = node?.location
      if (location?.kind === 'turn' || location?.kind === 'step') {
        const turn = location.turn?.turn
        return typeof turn === 'number' && Number.isFinite(turn) ? turn : undefined
      }
      return undefined
    }
    const visibleUserKeys = chat => {
      const keys = []
      for (const key of Array.from(chat?.order ?? [])) {
        const node = nodeOfChat(chat, key)
        if (node != null && (node.kind === 'user' || node.kind === 'steering') && node.visibility !== 'hidden') keys.push(key)
      }
      return keys
    }
    const keysForTurn = (chat, turn) => {
      const indexed = typeof chat?.locations?.getTurn === 'function' ? chat.locations.getTurn(turn) : undefined
      if (Array.isArray(indexed) && indexed.length > 0) return [...indexed]
      return Array.from(chat?.order ?? []).filter(key => turnNumberOf(nodeOfChat(chat, key)) === turn)
    }
    const asRecord = data => data !== null && typeof data === 'object' ? data : null
    const textOfContent = content => {
      if (!Array.isArray(content)) return ''
      return content
        .filter(block => block !== null && typeof block === 'object' && block.type === 'text')
        .map(block => String(block.text ?? ''))
        .join('')
    }
    const firstLineOf = text => {
      const value = String(text ?? '')
      const newline = value.indexOf('\n')
      return newline === -1 ? value : value.slice(0, newline)
    }
    const parseArgs = raw => {
      if (typeof raw !== 'string' || raw === '') return undefined
      try {
        const value = JSON.parse(raw)
        return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
      } catch { return undefined }
    }
    const pickString = (args, keys) => {
      if (args === undefined) return ''
      for (const key of keys) {
        const value = args[key]
        if (typeof value === 'string' && value.length > 0) return value
      }
      return ''
    }
    const toolSummary = (args, keys, name) => {
      if (args !== undefined) {
        for (const key of keys) {
          const value = args[key]
          if (typeof value === 'string' && value.trim() !== '') return value.trim()
          if (Array.isArray(value)) {
            const items = value.filter(item => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
            if (items.length > 0) return items.join(' · ')
            if (key === 'todos' && value.length > 0) return `${value.length} 项`
          }
        }
      }
      return pickString(args, ['path', 'file_path', 'url']) || name || ''
    }
    const asSources = value => {
      if (!Array.isArray(value)) return []
      return value.map(item => {
        if (typeof item === 'string') return { title: item, url: /^https?:/i.test(item) ? item : undefined }
        if (item == null || typeof item !== 'object') return null
        const title = typeof item.title === 'string' ? item.title : typeof item.name === 'string' ? item.name : ''
        const url = typeof item.url === 'string' ? item.url : typeof item.link === 'string' ? item.link : typeof item.href === 'string' ? item.href : undefined
        const snippet = typeof item.snippet === 'string' ? item.snippet : typeof item.description === 'string' ? item.description : typeof item.content === 'string' ? item.content : undefined
        if (title === '' && url === undefined) return null
        return snippet === undefined ? { title: title || url, url } : { title: title || url, url, snippet }
      }).filter(Boolean)
    }
    const inferResultView = (name, output) => {
      if (typeof output !== 'string' || output.trim() === '') return null
      const text = output.trim()
      try {
        const parsed = JSON.parse(text)
        if (Array.isArray(parsed) && parsed.length > 0) {
          const sources = asSources(parsed)
          if (sources.length > 0) return { card: 'web', sources }
        }
        if (parsed !== null && typeof parsed === 'object') {
          const sources = asSources(parsed.sources ?? parsed.results ?? parsed.items ?? parsed.organic)
          if (sources.length > 0) return { card: 'web', sources }
          if (Array.isArray(parsed.paths) && parsed.paths.length > 0) return { card: 'search', kind: 'paths', paths: parsed.paths, total: parsed.total ?? parsed.paths.length, truncated: parsed.truncated === true }
          if (Array.isArray(parsed.files) && parsed.files.length > 0) return { card: 'search', kind: 'matches', files: parsed.files, total: parsed.total ?? parsed.files.length, truncated: parsed.truncated === true }
        }
      } catch { /* not JSON */ }
      if (name === 'web_search' || name === 'web_fetch') {
        const sources = []
        const matcher = /\[([^\]]+)\]\((https?:[^)]+)\)/g
        let match
        while ((match = matcher.exec(text)) !== null) sources.push({ title: match[1], url: match[2] })
        if (sources.length > 0) return { card: 'web', sources }
      }
      return null
    }
    const processToToolNode = (entry, key) => ({
      key,
      kind: 'tool-call',
      data: {
        root: entry?.result == null && entry?.error == null ? {
          name: entry?.name ?? '',
          argsRaw: entry?.arguments ?? '',
          callId: entry?.callId,
        } : {
          kind: 'result',
          name: entry?.name ?? '',
          call: { name: entry?.name ?? '', argsRaw: entry?.arguments ?? '' },
          argsRaw: entry?.arguments ?? '',
          content: typeof entry?.result === 'string' && entry.result !== '' ? [{ type: 'text', text: entry.result }] : [],
          isError: typeof entry?.error === 'string' && entry.error !== '',
          error: typeof entry?.error === 'string' && entry.error !== '' ? { name: 'Error', message: entry.error } : undefined,
          resultView: inferResultView(entry?.name ?? '', entry?.result ?? ''),
        },
      },
    })
    const detailAssistantText = (item, detail) => {
      let text = String(item.text ?? '')
      if (detail?.format === 'structured-v1') return text
      const calls = detail?.process ?? detail?.flow?.filter(entry => entry.kind === 'tool') ?? []
      // Compatibility for the old endpoint's exact "name\\narguments" suffix,
      // and only when the corresponding structured execution is also present.
      for (let changed = true; changed;) {
        changed = false
        for (const call of calls) {
          if (typeof call.name !== 'string' || typeof call.arguments !== 'string' || call.arguments === '') continue
          const suffix = `${call.name}\n${call.arguments}`
          if (text !== suffix && !text.endsWith(`\n${suffix}`)) continue
          const prefix = text.slice(0, text.length - suffix.length)
          if ((prefix.match(/^\s*(?:`{3,}|~{3,})/gm) ?? []).length % 2 !== 0) continue
          text = prefix.trimEnd()
          changed = true
          break
        }
      }
      return text
    }
    const detailToChatNodes = detail => {
      const nodes = []
      if (typeof detail?.question === 'string' && detail.question !== '') {
        nodes.push({ key: 'question', kind: 'user', data: { content: [{ type: 'text', text: detail.question }] } })
      }
      const flow = Array.isArray(detail?.flow) && detail.flow.length > 0
        ? detail.flow
        : [
            ...(Array.isArray(detail?.steps) ? detail.steps : []),
            ...(Array.isArray(detail?.process) ? detail.process.map(entry => ({ kind: 'tool', ...entry })) : []),
          ]
      flow.forEach((item, index) => {
        if (item?.kind === 'assistant') {
          const text = detailAssistantText(item, detail)
          if (text.trim() !== '') nodes.push({ key: `assistant:${item.seq ?? index}`, kind: 'assistant-step', data: { status: 'settled', blocks: [{ kind: 'text', text }] } })
          return
        }
        if (item?.kind === 'error') {
          nodes.push({ key: `error:${index}`, kind: 'turn-error', data: { message: String(item.text ?? '本轮未完成') } })
          return
        }
        if (item?.kind === 'tool' || item?.name != null) nodes.push(processToToolNode(item, `tool:${item.callId || item.seq || index}`))
      })
      return nodes
    }
    const isSettledTool = block => block !== null && typeof block === 'object' && 'kind' in block
    const callName = block => isSettledTool(block) ? block.call?.name ?? '' : block.name ?? ''
    const callArgsRaw = block => (isSettledTool(block) ? block.call?.argsRaw : block.argsRaw) ?? ''
    const resultText = node => {
      const parts = []
      for (const block of node.content ?? []) {
        if (block !== null && typeof block === 'object' && block.type === 'text') parts.push(String(block.text ?? ''))
        else parts.push(JSON.stringify(block, null, 2))
      }
      if (parts.length === 0 && node.error != null) parts.push(`${node.error.name ?? 'Error'}: ${node.error.message ?? node.error.code ?? ''}`)
      return parts.join('\n')
    }
    // Slice one user turn out of the live Chat target. Prefer the official
    // turn location index (DSH 0.1.2+); fall back to visible user rows when
    // a snapshot has no locations or the window has not loaded that turn.
    // seq is the user event; turnIndex is the 0-based card fallback.
    const keysBetweenUser = (chat, userKey) => {
      const order = Array.from(chat?.order ?? [])
      const from = order.indexOf(userKey)
      if (from === -1) return []
      const userKeys = visibleUserKeys(chat)
      const index = userKeys.indexOf(userKey)
      const endKey = index === -1 ? undefined : userKeys[index + 1]
      const to = endKey === undefined ? order.length : order.indexOf(endKey)
      return order.slice(from, to === -1 ? order.length : to)
    }
    const sliceTurnKeys = (chat, seq, turnIndex) => {
      if (chat == null || chat.order == null) return []
      const order = Array.from(chat.order)
      const resolved = keys => (Array.isArray(keys) && keys.length > 0 ? keys : null)
      let userKey
      if (Number.isInteger(seq)) {
        for (const key of order) {
          const node = nodeOfChat(chat, key)
          if (node == null || seqOf(node) !== seq) continue
          if (node.kind === 'user' || node.kind === 'steering') { userKey = key; break }
          if (userKey === undefined) userKey = key
        }
      }
      const turn = userKey === undefined ? undefined : turnNumberOf(nodeOfChat(chat, userKey))
      if (turn !== undefined) {
        const keys = resolved(keysForTurn(chat, turn))
        if (keys !== null) return keys
      }
      if (userKey !== undefined) return keysBetweenUser(chat, userKey)
      // An explicit event address must never be replaced by an unrelated
      // window-relative turn index, especially on forks with inherited turns.
      if (Number.isInteger(seq)) return []
      if (Number.isInteger(turnIndex)) {
        const keyed = resolved(keysForTurn(chat, turnIndex + 1)) ?? resolved(keysForTurn(chat, turnIndex))
        if (keyed !== null) return keyed
        const userKeys = visibleUserKeys(chat)
        if (turnIndex >= 0 && turnIndex < userKeys.length) {
          const key = userKeys[turnIndex]
          const keyedTurn = turnNumberOf(nodeOfChat(chat, key))
          if (keyedTurn !== undefined) {
            const keys = resolved(keysForTurn(chat, keyedTurn))
            if (keys !== null) return keys
          }
          return keysBetweenUser(chat, key)
        }
      }
      return []
    }
    const sliceTurnNodes = (chat, seq, turnIndex) =>
      sliceTurnKeys(chat, seq, turnIndex).map(key => nodeOfChat(chat, key)).filter(node => node != null)
    const isLastUserTurn = (chat, seq, turnIndex) => {
      if (chat == null || chat.order == null || chat.nodes == null) return false
      const sliced = sliceTurnKeys(chat, seq, turnIndex)
      if (sliced.length === 0) return false
      const userKeys = visibleUserKeys(chat)
      const lastUser = userKeys[userKeys.length - 1]
      if (lastUser !== undefined && sliced.includes(lastUser)) return true
      const lastVisible = [...Array.from(chat.order)].reverse().find(key => {
        const node = nodeOfChat(chat, key)
        return node != null && node.visibility !== 'hidden' && node.kind !== 'turn-tail'
      })
      return lastVisible !== undefined && sliced.includes(lastVisible)
    }
    // The live tail of a running turn. Location indexes freeze when the user
    // message lands, so later think/tool/stream nodes never appear in
    // keysForTurn — 详情 would show the question and then stall.
    const liveTailKeys = chat => {
      if (chat == null || chat.order == null) return []
      const userKeys = visibleUserKeys(chat)
      if (userKeys.length === 0) {
        return Array.from(chat.order).filter(key => {
          const node = nodeOfChat(chat, key)
          return node != null && node.visibility !== 'hidden' && node.kind !== 'turn-tail'
        })
      }
      return keysBetweenUser(chat, userKeys[userKeys.length - 1])
    }
    const sliceTurnKeysLive = (chat, seq, turnIndex, running) => {
      const keys = sliceTurnKeys(chat, seq, turnIndex)
      if (running !== true) return keys
      const tail = liveTailKeys(chat)
      if (keys.length === 0) return []
      if (isLastUserTurn(chat, seq, turnIndex) && tail.length > keys.length) return tail
      return keys
    }
    const MARKDOWN_CODE_LABELS = { copyLabel: '复制', copiedLabel: '已复制' }
    const MARKDOWN_LABELS = { code: MARKDOWN_CODE_LABELS, footnotes: '脚注' }
    function markdownBodyProps(text, streaming) {
      return {
        text: String(text ?? ''),
        streaming: streaming === true,
        // 0.1.2 requires labels; 0.1.1 still reads codeLabels.
        labels: MARKDOWN_LABELS,
        codeLabels: MARKDOWN_CODE_LABELS,
      }
    }
    function MarkdownBody({ text, streaming }) {
      if (primitives?.MarkdownText) return h(primitives.MarkdownText, markdownBodyProps(text, streaming))
      return h('div', { className: 'dsh-codex-sidechat-md-fallback' }, text)
    }
    // Compact outline glyphs matching dsh-codex's tool/think leading icons.
    // Used when ui-primitives is unavailable so the row never renders blank.
    const FALLBACK_ICON = {
      search: 'M6.7 11.5a4.8 4.8 0 1 1 3.4-1.4L13.5 13.5',
      read: 'M3 4.2h10M3 8h10M3 11.8h6.5',
      bash: 'M4.5 5.5 7 8l-2.5 2.5M8.5 11.5H12',
      write: 'M9.2 3.6 12.4 6.8 6 13.2H2.8V10Z',
      edit: 'M9.2 3.6 12.4 6.8 6 13.2H2.8V10Z',
      code: 'M6 4.5 2.8 8 6 11.5M10 4.5 13.2 8 10 11.5',
      think: 'M8 2.8a4 4 0 0 1 2.2 7.3V12H5.8V10.1A4 4 0 0 1 8 2.8ZM6.4 13.4h3.2',
      others: 'M8 3.2 9 6.4 12.2 7.4 9 8.4 8 11.6 7 8.4 3.8 7.4 7 6.4Z',
    }
    const primitiveIcon = (name) => {
      const Component = primitives?.[name]
      return Component === undefined ? null : h(Component, { size: 14 })
    }
    const svgIcon = (d) => h('svg', {
      width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
      strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
    }, h('path', { d }))
    const toolIcon = (variant) => {
      const primitive = variant === 'search' ? primitiveIcon('IconSearchOutline16')
        : variant === 'read' || variant === 'image' ? primitiveIcon('IconBrowseOutline16')
        : variant === 'bash' || variant === 'job' ? primitiveIcon('IconApiOutline14')
        : variant === 'write' || variant === 'edit' ? primitiveIcon('IconEditOutline16')
        : variant === 'code' ? primitiveIcon('IconCodeOutline16')
        : variant === 'web' ? primitiveIcon('IconGlobeOutline14') ?? primitiveIcon('IconLinkOutline14')
        : variant === 'skill' ? primitiveIcon('IconSkillOutline16')
        : variant === 'question' ? primitiveIcon('IconQuestionOutline14')
        : variant === 'agent' ? primitiveIcon('IconUserOutline16')
        : variant === 'todo' ? primitiveIcon('IconChecklistOutline14')
        : variant === 'think' ? primitiveIcon('IconThinkOutline14')
        : primitiveIcon('IconSparkle16')
      return primitive ?? svgIcon(FALLBACK_ICON[variant] ?? FALLBACK_ICON.others)
    }
    function FoldRow({ title, summary, body, running, error, variant, kind }) {
      const think = kind === 'think'
      const rowState = running ? 'running' : error ? 'error' : 'ok'
      return h('details', {
        className: think ? 'dsh-codex-sidechat-think dsh-codex-sidechat-fold' : 'dsh-codex-sidechat-toolrow dsh-codex-sidechat-fold',
        'data-variant': variant ?? (think ? 'think' : 'others'),
        'data-state': rowState,
      },
        h('summary', { className: think ? 'dsh-codex-sidechat-think-row dsh-codex-sidechat-fold-row' : 'dsh-codex-sidechat-toolrow-row dsh-codex-sidechat-fold-row' },
          h('span', { className: think ? 'dsh-codex-sidechat-think-leading' : 'dsh-codex-sidechat-toolrow-leading', 'aria-hidden': true }, toolIcon(variant ?? (think ? 'think' : 'others'))),
          h('span', { className: think ? 'dsh-codex-sidechat-think-title dsh-codex-sidechat-fold-title' : 'dsh-codex-sidechat-toolrow-title dsh-codex-sidechat-fold-title' }, title),
          summary ? h('span', { className: 'dsh-codex-sidechat-sep', 'aria-hidden': true }) : null,
          summary ? h('span', { className: error ? 'dsh-codex-sidechat-toolrow-summary is-error' : 'dsh-codex-sidechat-think-summary' }, summary) : null,
        ),
        body ? h('div', { className: 'dsh-codex-sidechat-think-body' }, body) : null,
      )
    }
    function matchLine(match) {
      if (typeof match === 'object' && match !== null) {
        const number = typeof match.lineNumber === 'number' ? match.lineNumber : typeof match.number === 'number' ? match.number : 0
        const text = typeof match.line === 'string' ? match.line : typeof match.text === 'string' ? match.text : ''
        return { lineNumber: number, line: text }
      }
      return { lineNumber: 0, line: String(match ?? '') }
    }
    const TERMINAL_LABELS = {
      copy: '复制', copied: '已复制', running: '运行中', done: '完成', failed: '失败',
      signal: value => `信号 ${value}`,
      exitCode: value => `退出码 ${value}`,
      noOutput: '没有输出',
      collapseAria: '收起输出', collapse: '收起',
      expandAria: hidden => `展开其余 ${hidden} 行输出`,
      expand: hidden => `展开 ${hidden} 行`,
    }
    function terminalBodyProps(command, output, running = false) {
      return { command, output: output || undefined, running, maxLines: 16, labels: TERMINAL_LABELS }
    }
    function ToolResultBody({ name, variant, args, output, resultView, running }) {
      const view = resultView ?? inferResultView(name, output)
      if (view?.card === 'web') {
        const sources = Array.isArray(view.sources) ? view.sources : []
        if (sources.length > 0) {
          return h('ul', { className: 'dsh-codex-sidechat-sources' },
            sources.map((source, index) => h('li', { key: source.url ?? String(index), className: 'dsh-codex-sidechat-source' },
              h('span', { className: 'dsh-codex-sidechat-source-title' }, source.title ?? source.url ?? ''),
              source.url ? h('a', { className: 'dsh-codex-sidechat-source-link', href: source.url, target: '_blank', rel: 'noreferrer noopener' }, source.url) : null,
              source.snippet ? h('span', { className: 'dsh-codex-sidechat-source-snippet' }, source.snippet) : null,
            )),
          )
        }
        if (typeof view.url === 'string') {
          return h('div', { className: 'dsh-codex-sidechat-toolresult-caption' }, view.statusCode == null ? view.url : `${view.statusCode} · ${view.url}`)
        }
      }
      if (view?.card === 'search' && primitives?.SearchBlock) {
        const total = view.total ?? 0
        const truncated = view.truncated === true
        if (Array.isArray(view.paths) && view.paths.length > 0) {
          return h('div', { className: 'dsh-codex-sidechat-toolresult' }, h(primitives.SearchBlock, { kind: 'paths', paths: [...view.paths], total, truncated, maxLines: 16 }))
        }
        const files = Array.isArray(view.files) ? view.files : []
        if (files.length > 0) {
          return h('div', { className: 'dsh-codex-sidechat-toolresult' }, h(primitives.SearchBlock, {
            kind: 'matches',
            files: files.map(file => ({ path: file.path ?? '', matches: (file.matches ?? []).map(matchLine) })),
            total,
            truncated,
            maxLines: 16,
          }))
        }
      }
      if (view?.card === 'read' && primitives?.ReadBlock && Array.isArray(view.lines) && view.lines.length > 0) {
        return h('div', { className: 'dsh-codex-sidechat-toolresult' }, h(primitives.ReadBlock, {
          label: view.path,
          lines: view.lines.map(line => ({ number: line.number ?? 0, text: String(line.text ?? '') })),
          totalLines: view.totalLines ?? view.lines.length,
          maxLines: 16,
        }))
      }
      if ((variant === 'bash' || variant === 'code') && primitives?.TerminalBlock) {
        return h('div', { className: 'dsh-codex-sidechat-terminal' }, h(primitives.TerminalBlock,
          terminalBodyProps(pickString(args, ['command', 'cmd']) || '', output, running),
        ))
      }
      if (output && primitives?.CodeBlock) return h('div', { className: 'dsh-codex-sidechat-code' }, h(primitives.CodeBlock, { code: output, copyLabel: '复制', copiedLabel: '已复制' }))
      return output ? h('div', { className: 'dsh-codex-sidechat-think-body' }, output) : null
    }
    function ToolCard({ block }) {
      const name = callName(block)
      const variant = TOOL_VARIANTS[name] ?? 'others'
      const settled = isSettledTool(block)
      const state = !settled ? 'running' : block.error?.code === 'interrupted' ? 'stopped' : block.isError ? 'error' : 'ok'
      const args = parseArgs(callArgsRaw(block))
      const summary = toolSummary(args, TOOL_SUMMARY_KEYS[variant] ?? TOOL_SUMMARY_KEYS.others, name)
      const output = settled ? resultText(block) : ''
      const resultView = settled ? block.resultView : undefined
      const subCalls = Array.isArray(block.subCalls) ? block.subCalls : []
      const body = h(ToolResultBody, { name, variant, args, output, resultView, running: state === 'running' })
      return h(FoldRow, {
        title: TOOL_TITLES[variant] ?? (name || '工具调用'),
        summary: state === 'error' ? firstLineOf(output) || summary : summary,
        body: body == null && subCalls.length === 0 ? null : h(React.Fragment, null,
          body,
          subCalls.length === 0 ? null : h('div', { className: 'dsh-codex-sidechat-subcalls' },
            subCalls.map((child, index) => h(ToolCard, { key: child.callId ?? String(index), block: child })),
          ),
        ),
        running: state === 'running',
        error: state === 'error',
        kind: 'tool',
        variant,
      })
    }
    function ChatNodeView({ node }) {
      if (node.visibility === 'hidden') return null
      const data = asRecord(node.data) ?? {}
      switch (node.kind) {
        case 'user':
        case 'steering': {
          const text = textOfContent(data.content)
          if (text.length === 0) return null
          return h('div', { className: 'dsh-codex-sidechat-user' },
            h('div', { className: 'dsh-codex-sidechat-user-bubble' },
              primitives?.MessageText ? h(primitives.MessageText, { text }) : text,
            ),
          )
        }
        case 'assistant-step': {
          const blocks = Array.isArray(data.blocks) ? data.blocks : []
          const status = String(data.status ?? 'settled')
          const streaming = status === 'running'
          const kids = []
          for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i]
            if (block == null) continue
            if (block.kind === 'text') kids.push(h(MarkdownBody, { key: i, text: String(block.text ?? ''), streaming }))
            else if (block.kind === 'reasoning') kids.push(h(FoldRow, { key: i, title: 'Think', summary: firstLineOf(block.text), body: block.text, running: streaming && i === blocks.length - 1, kind: 'think', variant: 'think' }))
          }
          if (status === 'interrupted') kids.push(h('span', { key: 'stopped', className: 'dsh-codex-sidechat-stopped' }, '已停止'))
          if (kids.length === 0) return null
          return h('div', { className: 'dsh-codex-sidechat-md', 'data-streaming': streaming || undefined },
            h('div', { className: 'dsh-codex-sidechat-md-body' }, kids),
          )
        }
        case 'tool-call': {
          const root = data.root
          if (root == null || typeof root !== 'object') return null
          return h(ToolCard, { block: root })
        }
        case 'turn-error':
          return h('div', { className: 'dsh-codex-sidechat-status-row is-error' }, typeof data.message === 'string' ? data.message : 'Turn error')
        case 'turn-max-tokens':
          return h('div', { className: 'dsh-codex-sidechat-status-row' }, '已达到输出上限')
        case 'model-retry':
          return h('div', { className: 'dsh-codex-sidechat-status-row' }, '正在重试…')
        case 'command': {
          const name = typeof data.name === 'string' && data.name !== '' ? data.name : 'command'
          const args = typeof data.args === 'string' ? data.args.trim() : ''
          const outcome = asRecord(data.outcome)
          const outcomeText = typeof outcome?.text === 'string' ? outcome.text : ''
          return h(FoldRow, { title: `/${name}`, summary: firstLineOf(outcomeText || args), body: [args, outcomeText].filter(part => part.length > 0).join('\n'), error: outcome?.kind === 'error', kind: 'tool', variant: 'others' })
        }
        case 'context': {
          const body = textOfContent(data.content)
          const provenance = asRecord(data.provenance)
          const label = typeof provenance?.label === 'string' && provenance.label !== '' ? provenance.label : '上下文'
          return h(FoldRow, { title: label, summary: firstLineOf(body), body, kind: 'think', variant: 'think' })
        }
        case 'compaction':
        case 'manual-compaction': {
          const summary = typeof data.summary === 'string' ? data.summary : asRecord(data.compaction)?.summary
          return h(FoldRow, { title: '上下文已压缩', summary: typeof summary === 'string' ? firstLineOf(summary) : '', body: typeof summary === 'string' ? summary : '', kind: 'tool', variant: 'others' })
        }
        default:
          return primitives?.JsonBlock
            ? h(primitives.JsonBlock, { label: node.kind, payload: node.data, defaultOpen: false })
            : null
      }
    }
    const loadTurnThrough = (ctx, sessionId, seq) => {
      if (!Number.isInteger(seq)) return
      try {
        const scope = ctx.sessions.scope(sessionId)
        const session = scope === undefined ? undefined : ctx.sessions.sessionOf(scope)
        if (session !== undefined && typeof session.loadThrough === 'function') return session.loadThrough(seq)
      } catch { /* session gone */ }
    }
    const liveSessionOf = (ctx, sessionId) => {
      try {
        const scoped = ctx.sessions.scope(sessionId)
        const fromScope = scoped === undefined ? undefined : ctx.sessions.sessionOf(scoped)
        if (fromScope != null) return fromScope
      } catch { /* not in a scoped window */ }
      try {
        const bound = ctx.sessions.binding?.(sessionId)?.session
        if (bound != null) return bound
      } catch { /* the session has not reached the list yet */ }
      try {
        const listed = ctx.sessions.get?.(sessionId)
        if (listed != null) return listed
      } catch { /* branded-id store or missing get */ }
      return undefined
    }
    const chatTargetOf = (ctx, sessionId, uiConversation) => {
      try {
        const face = uiConversation ?? (typeof ctx.get === 'function' ? ctx.get('uiConversation') : ctx.uiConversation)
        if (face == null || typeof face.binding !== 'function') return undefined
        return face.binding(sessionId)?.target('chat')
      } catch {
        return undefined
      }
    }
    // A listed session can still have a cold event window. The watched-session
    // subscription opens that window without selecting the session; until it
    // is ready, the detail endpoint supplies the readable fallback.
    const isLiveWatch = (ctx, sessionId, uiConversation) => {
      const snapshot = liveSessionOf(ctx, sessionId)?.getSnapshot?.()
      if (snapshot?.openState === 'open') return true
      // Hosts before openState carry the chat on the session snapshot itself;
      // content already materialized there proves the window is loaded.
      if (snapshot != null && !('openState' in snapshot) && (snapshot.chat?.order?.length ?? 0) > 0) return true
      const chat = chatTargetOf(ctx, sessionId, uiConversation)?.getSnapshot?.()
      return (chat?.order?.length ?? 0) > 0
    }
    const subscribeLiveTurn = (ctx, sessionId, onChange, uiConversation) => {
      const unsubs = []
      const session = liveSessionOf(ctx, sessionId)
      if (session != null && typeof session.subscribe === 'function') unsubs.push(session.subscribe(onChange))
      const target = chatTargetOf(ctx, sessionId, uiConversation)
      if (target != null && typeof target.subscribe === 'function') unsubs.push(target.subscribe(onChange))
      return () => { for (const stop of unsubs) try { stop() } catch { /* already gone */ } }
    }
    function subscribeWatchedSession(ctx, sessionId, onChange, uiConversation) {
      let disposed = false
      let session
      let target
      let stopSession = () => {}
      let stopTarget = () => {}
      const opened = new WeakSet()
      const publish = () => { if (!disposed) onChange() }
      const bind = () => {
        if (disposed) return
        const nextSession = liveSessionOf(ctx, sessionId)
        const nextTarget = chatTargetOf(ctx, sessionId, uiConversation)
        if (nextSession !== session) {
          stopSession()
          session = nextSession
          stopSession = session?.subscribe?.(bind) ?? (() => {})
        }
        if (nextTarget !== target) {
          stopTarget()
          target = nextTarget
          stopTarget = target?.subscribe?.(publish) ?? (() => {})
        }
        if (session != null && typeof session.open === 'function' && !opened.has(session)) {
          const opening = session
          opened.add(opening)
          // Session.open loads its event window only. sessions.open(id) would
          // instead navigate the host away from the user's current session.
          void Promise.resolve().then(() => {
            if (!disposed && session === opening) return opening.open()
          }).then(() => {
            if (!disposed && session === opening) bind()
          }, publish)
        }
        publish()
      }
      const stopList = ctx?.sessions?.list?.subscribe?.(bind) ?? (() => {})
      bind()
      return () => {
        disposed = true
        stopList()
        stopSession()
        stopTarget()
      }
    }
    class TurnNodeErrorBoundary extends React.Component {
      state = { failed: false }
      static getDerivedStateFromError() { return { failed: true } }
      render() {
        if (!this.state.failed) return this.props.children
        let payload
        try { payload = JSON.stringify(this.props.node.data, null, 2) } catch { payload = '记录暂不可读' }
        return h('details', { className: 'dsh-synapse-turn-node-fallback' },
          h('summary', null, '此条记录展示异常，查看原始内容'),
          h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflow: 'auto' } }, payload),
        )
      }
    }
    function TurnNodeSeat({ node }) {
      if (node == null || node.visibility === 'hidden') return null
      return h('div', {
        className: 'dsh-synapse-turn-node',
        'data-chat-anchor-key': node.key,
        'data-chat-flow-kind': node.kind,
      }, h(TurnNodeErrorBoundary, { node }, h(ChatNodeView, { node })))
    }
    function OfficialTurnPane({ watch, ctx, onClose, onOpenInDialog, useChat, useSession, sessionId, loadThrough, uiConversation }) {
      const transcriptRef = React.useRef(null)
      const scrollTopRef = React.useRef(0)
      const followTailRef = React.useRef(true)
      const [, setLiveTick] = React.useState(0)
      const watchKey = `${watch.sessionId}:${watch.seq ?? ''}:${watch.turnIndex ?? ''}`
      const lastWatchKeyRef = React.useRef(watchKey)
      if (lastWatchKeyRef.current !== watchKey) {
        lastWatchKeyRef.current = watchKey
        scrollTopRef.current = 0
      }
      const order = useChat(snapshot => snapshot?.order ?? [])
      const nodes = useChat(snapshot => snapshot?.nodes)
      const locations = useChat(snapshot => snapshot?.locations)
      const hookRunning = typeof useSession === 'function' ? useSession(snapshot => snapshot?.running === true) : false
      const boundChat = chatTargetOf(ctx, watch.sessionId, uiConversation)?.getSnapshot()
      const liveSession = liveSessionOf(ctx, watch.sessionId)
      const liveRunning = liveSession?.getSnapshot()?.running === true
      const running = hookRunning === true || liveRunning === true
      const chat = Array.isArray(order) && order.length > 0
        ? { order, nodes, locations }
        : (boundChat ?? liveSession?.getSnapshot()?.chat ?? { order, nodes, locations })
      const keys = sliceTurnKeysLive(chat, watch.seq, watch.turnIndex, running)
      const turnNodes = keys.map(key => nodeOfChat(chat, key)).filter(node => node != null && node.kind !== 'turn-tail')
      const ready = sessionId == null || sessionId === watch.sessionId
      React.useEffect(() => subscribeLiveTurn(ctx, watch.sessionId, () => setLiveTick(value => value + 1), uiConversation), [watch.sessionId, ctx, uiConversation])
      React.useEffect(() => {
        if (!ready || keys.length > 0 || !Number.isInteger(watch.seq)) return
        const loader = typeof loadThrough === 'function' ? loadThrough(watch.seq) : loadTurnThrough(ctx, watch.sessionId, watch.seq)
        if (loader != null) void Promise.resolve(loader).catch(() => {})
      }, [ready, keys.length, watch.seq, watch.sessionId, loadThrough, ctx])
      React.useLayoutEffect(() => {
        const node = transcriptRef.current
        if (node instanceof HTMLElement) {
          node.scrollTop = followTailRef.current && running && isLastUserTurn(chat, watch.seq, watch.turnIndex) ? node.scrollHeight : scrollTopRef.current
        }
      })
      const lastTurn = isLastUserTurn(chat, watch.seq, watch.turnIndex)
      const pending = running && lastTurn
      if (ready && keys.length === 0) return h(RemoteTurnPane, { watch, ctx, onClose, onOpenInDialog })
      return h('aside', { className: 'dsh-synapse-turn-pane', 'aria-label': '本轮对话' },
        h('header', { className: 'dsh-synapse-turn-pane-head' },
          h('div', { className: 'dsh-synapse-turn-pane-meta' },
            h('span', { className: 'dsh-synapse-turn-pane-badge' }, Number.isInteger(watch.turnIndex) ? `第 ${watch.turnIndex + 1} 轮` : '本轮'),
          ),
          h('div', { className: 'dsh-synapse-turn-pane-actions' },
            h('button', { type: 'button', onClick: onOpenInDialog }, '在会话中打开'),
            h('button', { type: 'button', className: 'dsh-synapse-turn-pane-close', onClick: onClose, 'aria-label': '关闭本轮' }, '×'),
          ),
        ),
        !ready
          ? h('div', { className: 'dsh-codex-sidechat-empty-panel' }, h('p', null, '正在打开这一轮…'))
          : h('div', {
              className: 'dsh-synapse-turn-flow',
              ref: transcriptRef,
              onScroll: event => {
                const node = event.currentTarget
                scrollTopRef.current = node.scrollTop
                followTailRef.current = node.scrollHeight - node.clientHeight - node.scrollTop < 48
              },
            },
              h('div', { className: 'dsh-synapse-turn-column' },
                turnNodes.map(node => h(TurnNodeSeat, { key: node.key, node })),
                pending ? h('div', { key: 'running', className: 'dsh-codex-sidechat-turn-status', role: 'status' }, '正在回复') : null,
                turnNodes.length === 0 && !pending
                  ? h('div', { className: 'dsh-codex-sidechat-empty' },
                      h('div', { className: 'dsh-codex-sidechat-empty-hero' },
                        h('h2', { className: 'dsh-codex-sidechat-empty-title' }, '正在回复'),
                      ),
                    )
                  : null,
              ),
            ),
      )
    }
    function LegacyTurnPane({ watch, ctx, onClose, onOpenInDialog, uiConversation }) {
      const [, setTick] = React.useState(0)
      const transcriptRef = React.useRef(null)
      const scrollTopRef = React.useRef(0)
      const followTailRef = React.useRef(true)
      const watchKey = `${watch.sessionId}:${watch.seq ?? ''}:${watch.turnIndex ?? ''}`
      const lastWatchKeyRef = React.useRef(watchKey)
      if (lastWatchKeyRef.current !== watchKey) {
        lastWatchKeyRef.current = watchKey
        scrollTopRef.current = 0
      }
      React.useEffect(() => {
        let unsubscribe = () => {}
        let timer = 0
        let tries = 0
        const bind = () => {
          const session = liveSessionOf(ctx, watch.sessionId)
          const target = chatTargetOf(ctx, watch.sessionId, uiConversation)
          if (session === undefined && target === undefined) {
            if (tries < 25) {
              tries += 1
              timer = window.setTimeout(bind, 200)
            }
            setTick(value => value + 1)
            return
          }
          unsubscribe = subscribeLiveTurn(ctx, watch.sessionId, () => setTick(value => value + 1), uiConversation)
          const loader = loadTurnThrough(ctx, watch.sessionId, watch.seq)
          if (loader != null) void Promise.resolve(loader).then(() => setTick(value => value + 1)).catch(() => {})
          setTick(value => value + 1)
        }
        bind()
        return () => { window.clearTimeout(timer); unsubscribe() }
      }, [watch.sessionId, watch.seq, ctx, uiConversation])
      React.useLayoutEffect(() => {
        const node = transcriptRef.current
        if (node instanceof HTMLElement) node.scrollTop = followTailRef.current && pending ? node.scrollHeight : scrollTopRef.current
      })
      const session = liveSessionOf(ctx, watch.sessionId)
      const snapshot = session?.getSnapshot()
      const chat = chatTargetOf(ctx, watch.sessionId, uiConversation)?.getSnapshot() ?? snapshot?.chat
      const running = snapshot?.running === true
      const nodes = sliceTurnKeysLive(chat, watch.seq, watch.turnIndex, running)
        .map(key => nodeOfChat(chat, key))
        .filter(node => node != null && node.kind !== 'turn-tail')
      const pending = running && isLastUserTurn(chat, watch.seq, watch.turnIndex)
      if (nodes.length === 0) return h(RemoteTurnPane, { watch, ctx, onClose, onOpenInDialog })
      return h('aside', { className: 'dsh-synapse-turn-pane', 'aria-label': '本轮对话' },
        h('header', { className: 'dsh-synapse-turn-pane-head' },
          h('div', { className: 'dsh-synapse-turn-pane-meta' },
            h('span', { className: 'dsh-synapse-turn-pane-badge' }, Number.isInteger(watch.turnIndex) ? `第 ${watch.turnIndex + 1} 轮` : '本轮'),
          ),
          h('div', { className: 'dsh-synapse-turn-pane-actions' },
            h('button', { type: 'button', onClick: onOpenInDialog }, '在会话中打开'),
            h('button', { type: 'button', className: 'dsh-synapse-turn-pane-close', onClick: onClose, 'aria-label': '关闭本轮' }, '×'),
          ),
        ),
        session === undefined && chat == null
          ? h('div', { className: 'dsh-codex-sidechat-empty-panel' }, h('p', null, '正在打开这一轮…'))
          : h('div', { className: 'dsh-codex-sidechat-transcript-wrap' },
              h('div', {
                className: 'dsh-codex-sidechat-transcript',
                ref: transcriptRef,
                onScroll: event => {
                  const node = event.currentTarget
                  scrollTopRef.current = node.scrollTop
                  followTailRef.current = node.scrollHeight - node.clientHeight - node.scrollTop < 48
                },
              },
                nodes.map((node, index) => h(TurnNodeSeat, { key: node.key ?? String(index), node })),
                pending ? h('div', { key: 'running', className: 'dsh-codex-sidechat-turn-status', role: 'status' }, 'Deep diving…') : null,
                nodes.length === 0 && !pending
                  ? h('div', { className: 'dsh-codex-sidechat-empty' },
                      h('div', { className: 'dsh-codex-sidechat-empty-hero' },
                        h('h2', { className: 'dsh-codex-sidechat-empty-title' }, '正在回复'),
                      ),
                    )
                  : null,
              ),
            ),
      )
    }
    async function readTurnDetail(watch, request = fetch, signal) {
      const empty = { question: null, steps: [], process: [], flow: [] }
      const read = async seq => {
        const response = await request('/synapse/api/turn-detail', {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId: watch.sessionId, seq,
            turnIndex: Number.isInteger(watch.turnIndex) ? watch.turnIndex : null,
            reference: watch.reference,
          }),
        })
        if (!response.ok) throw new Error('detail unavailable')
        return (await response.json())?.detail ?? empty
      }
      const matches = detail => {
        const expected = watch.reference?.question
        if (typeof expected !== 'string' || expected === '') return true
        if (typeof detail.question !== 'string') return false
        if (watch.reference?.messageId && typeof detail.messageId === 'string') return detail.messageId === watch.reference.messageId
        return expected.length === 601 && expected.endsWith('…')
          ? detail.question.startsWith(expected.slice(0, -1))
          : detail.question.trim() === expected.trim()
      }
      let detail = await read(Number.isInteger(watch.seq) ? watch.seq : null)
      if (detail.question != null && matches(detail)) return detail
      if (Number.isInteger(watch.seq) && Number.isInteger(watch.turnIndex)
        && watch.reference?.root === true && watch.reference.unique === true
        && typeof watch.reference.question === 'string' && watch.reference.question !== '') {
        detail = await read(null)
        if (detail.question != null && matches(detail)) return detail
      }
      return watch.reference === undefined ? detail : empty
    }
    function subscribeTurnDetail(watch, options) {
      let disposed = false
      let loading = false
      let again = false
      let complete = false
      let failures = 0
      let timer
      const controller = new AbortController()
      const schedule = options.schedule ?? ((fn, delay) => window.setTimeout(fn, delay))
      const cancel = options.cancel ?? (id => window.clearTimeout(id))
      const refresh = async () => {
        if (disposed) return
        if (loading) { again = true; return }
        if (timer !== undefined) { cancel(timer); timer = undefined }
        loading = true
        try {
          const detail = await options.read(watch, controller.signal)
          if (disposed) return
          complete = detail.complete === true
          failures = 0
          options.onDetail(detail)
        } catch (error) {
          if (disposed) return
          failures += 1
          options.onError(error)
        } finally {
          loading = false
          if (!disposed && failures < 3 && (!complete && options.isRunning() || again)) {
            again = false
            timer = schedule(() => { timer = undefined; void refresh() }, failures === 0 ? 750 : 1000 * 2 ** (failures - 1))
          }
        }
      }
      const stop = options.subscribe?.(() => { if (!complete) void refresh() }) ?? (() => {})
      void refresh()
      return () => {
        disposed = true
        controller.abort()
        if (timer !== undefined) cancel(timer)
        stop()
      }
    }
    function turnDetailPresentation(detail, preview, failed) {
      const hasDetail = typeof detail?.question === 'string' && detail.question !== ''
      const hasPreview = typeof preview?.question === 'string' && preview.question !== ''
      return {
        hasDetail, hasPreview,
        missing: failed || detail !== null && !hasDetail,
        displayDetail: hasDetail ? detail : hasPreview ? {
          format: 'structured-v1',
          question: preview.question,
          steps: [
            ...(preview.answer ? [{ kind: 'assistant', text: preview.answer }] : []),
            ...(preview.error ? [{ kind: 'error', text: preview.error }] : []),
          ],
        } : null,
      }
    }
    function RemoteTurnPane({ watch, ctx, onClose, onOpenInDialog }) {
      const [detail, setDetail] = React.useState(null)
      const [failed, setFailed] = React.useState(false)
      const [retry, setRetry] = React.useState(0)
      const transcriptRef = React.useRef(null)
      const followTailRef = React.useRef(true)
      const scrollTopRef = React.useRef(0)
      const watchKey = `${watch.sessionId}:${watch.seq ?? ''}:${watch.turnIndex ?? ''}`
      React.useEffect(() => {
        setDetail(null)
        setFailed(false)
        scrollTopRef.current = 0
        followTailRef.current = true
        return subscribeTurnDetail(watch, {
          read: (target, signal) => readTurnDetail(target, fetch, signal),
          isRunning: () => ctx?.sessions.list.getSnapshot().byId[watch.sessionId]?.running === true,
          subscribe: changed => ctx?.sessions.list.subscribe(changed) ?? (() => {}),
          onDetail: value => { setDetail(value); setFailed(false) },
          onError: () => setFailed(true),
        })
      }, [watchKey, ctx, retry])
      React.useLayoutEffect(() => {
        const node = transcriptRef.current
        if (node instanceof HTMLElement) node.scrollTop = followTailRef.current && detail?.complete === false ? node.scrollHeight : scrollTopRef.current
      })
      const { hasDetail, hasPreview, displayDetail, missing } = turnDetailPresentation(detail, watch.preview, failed)
      const nodes = displayDetail === null ? [] : detailToChatNodes(displayDetail)
      return h('aside', { className: 'dsh-synapse-turn-pane', 'aria-label': '本轮对话' },
        h('header', { className: 'dsh-synapse-turn-pane-head' },
          h('div', { className: 'dsh-synapse-turn-pane-meta' },
            h('span', { className: 'dsh-synapse-turn-pane-badge' }, Number.isInteger(watch.turnIndex) ? `第 ${watch.turnIndex + 1} 轮` : '本轮'),
          ),
          h('div', { className: 'dsh-synapse-turn-pane-actions' },
            h('button', { type: 'button', onClick: onOpenInDialog }, '在会话中打开'),
            h('button', { type: 'button', className: 'dsh-synapse-turn-pane-close', onClick: onClose, 'aria-label': '关闭本轮' }, '×'),
          ),
        ),
        h('div', { className: 'dsh-synapse-turn-flow', ref: transcriptRef, onScroll: event => {
          const node = event.currentTarget
          scrollTopRef.current = node.scrollTop
          followTailRef.current = node.scrollHeight - node.clientHeight - node.scrollTop < 48
        } },
          !hasDetail ? h('div', { className: 'dsh-synapse-turn-notice', role: missing ? 'alert' : 'status' },
            h('span', null, missing
              ? hasPreview ? '完整记录暂不可用，当前显示卡片摘要' : '未能定位这一轮的记录'
              : '正在读取完整记录'),
            missing ? h('button', { type: 'button', onClick: () => setRetry(value => value + 1) }, '重试') : null,
          ) : null,
          h('div', { className: 'dsh-synapse-turn-column' },
            nodes.map(node => h(TurnNodeSeat, { key: node.key, node })),
            detail?.complete === false && ctx?.sessions.list.getSnapshot().byId[watch.sessionId]?.running === true ? h('p', { role: 'status' }, '正在同步本轮记录') : null,
          ),
        ),
      )
    }
    // The host retires the entire map slot when a descendant render throws.
    class TurnPaneErrorBoundary extends React.Component {
      state = { error: null }
      static getDerivedStateFromError(error) {
        return { error }
      }
      componentDidCatch(error) {
        console.error('[dsh-synapse] turn preview failed', error)
      }
      render() {
        if (this.state.error === null) return this.props.children
        return h('aside', { className: 'dsh-synapse-turn-pane', 'aria-label': '本轮对话' },
          h('header', { className: 'dsh-synapse-turn-pane-head' },
            h('span', null, '本轮对话'),
            h('button', { type: 'button', onClick: this.props.onClose, 'aria-label': '关闭本轮' }, '×'),
          ),
          h('div', { className: 'dsh-synapse-turn-flow', role: 'alert' },
            h('p', null, '这一轮渲染失败'),
            h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } },
              String(this.state.error?.message ?? this.state.error),
            ),
          ),
        )
      }
    }
    function turnPaneSource(watchSessionId, currentSessionId, hasOfficialHooks, liveBound) {
      if (hasOfficialHooks === true && watchSessionId === currentSessionId) return 'official'
      if (liveBound === true) return 'legacy'
      return 'remote'
    }
    function SynapseTurnPane(props) {
      const [, setLiveTick] = React.useState(0)
      React.useEffect(() => subscribeWatchedSession(
        props.ctx, props.watch.sessionId, () => setLiveTick(value => value + 1), props.uiConversation,
      ), [props.ctx, props.watch.sessionId, props.uiConversation])
      const currentSessionId = props.ctx.sessions.list.getSnapshot().current
      const source = turnPaneSource(
        props.watch.sessionId,
        currentSessionId,
        typeof props.useChat === 'function',
        isLiveWatch(props.ctx, props.watch.sessionId, props.uiConversation),
      )
      if (source === 'official') return h(OfficialTurnPane, props)
      if (source === 'legacy') {
        return h(LegacyTurnPane, {
          key: `${props.watch.sessionId}:${props.watch.seq ?? ''}:${props.watch.turnIndex ?? ''}`,
          watch: props.watch,
          ctx: props.ctx,
          onClose: props.onClose,
          onOpenInDialog: props.onOpenInDialog,
          uiConversation: props.uiConversation,
        })
      }
      // Keep a readable fallback while the watched event window is opening,
      // or when the host cannot provide a live window for this session.
      return h(RemoteTurnPane, {
        key: `${props.watch.sessionId}:${props.watch.seq ?? ''}:${props.watch.turnIndex ?? ''}`,
        watch: props.watch,
        ctx: props.ctx,
        onClose: props.onClose,
        onOpenInDialog: props.onOpenInDialog,
      })
    }
    const turnWatch = {
      value: null,
      listeners: new Set(),
      get() { return this.value },
      set(next) {
        this.value = next
        for (const listener of this.listeners) listener()
      },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      },
    }

    async function waitForForkSession(sessions, sessionId, timeoutMs = 5000) {
      const available = () => {
        const scope = sessions.scope(sessionId)
        return scope !== undefined && sessions.sessionOf(scope) !== undefined
      }
      if (available()) return
      await new Promise((resolve, reject) => {
        let unsubscribe = () => {}
        const timer = setTimeout(() => {
          unsubscribe()
          reject(new Error('新分支尚未同步到客户端，请重试'))
        }, timeoutMs)
        const check = () => {
          if (!available()) return
          clearTimeout(timer)
          unsubscribe()
          resolve()
        }
        unsubscribe = sessions.list.subscribe(check)
        check()
      })
    }

    async function requestCardFork(input, request = fetch) {
      const response = await request('/synapse/api/fork-card', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operationId: input.operationId, sessionId: input.sessionId, target: input.target }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? '会话分支创建失败')
      if (typeof body.session?.id !== 'string' || body.session.id === '') throw new Error('分支响应缺少会话标识')
      return body.session
    }

    function createOperationRunner() {
      const operations = new Map()
      return (type, operationId, action) => {
        if (typeof operationId !== 'string' || operationId === '') return Promise.resolve().then(action)
        const key = `${type}:${operationId}`
        if (operations.has(key)) return operations.get(key)
        const pending = Promise.resolve().then(action)
        operations.set(key, pending)
        pending.catch(() => { if (operations.get(key) === pending) operations.delete(key) })
        return pending
      }
    }

    const TAB_LABEL = '会话地图'
    const DIALOG_TAB_LABEL = '对话'
    // The session header renders view tabs in raw registration order, not by
    // `order`, so the map tab is placed after 对话/轨迹 with flex order.
    const TAB_ORDER_MAP = '1'
    const TAB_ORDER_OTHER = '0'

    // Host chrome hidden while the map is the active session view: the codex
    // message rail and the right-side terminal/files panels. They are portalled
    // into <body> by that plugin, so they are addressed by its own class names.
    const CHROME_HIDE_SELECTORS = ['.dsh-codex-nav-rail', '.dsh-side-panels', '.dsh-side-panels-launcher', '[data-width-handle]']
    const CHROME_HIDE_CLASS = 'dsh-synapse-chrome-hidden'
    // The map has its own composer inside the canvas, so DSH's dock is removed
    // outright: display:none (unlike the panels above) reclaims its space.
    const COMPOSER_HIDE_SELECTORS = ['[data-composer-seat]']
    const COMPOSER_HIDE_CLASS = 'dsh-synapse-composer-hidden'
    // visibility (not display:none) keeps those panels laid out and measurable,
    // so their own width/position state survives while the map is open.
    // dsh-codex squeezes #root with `margin-right: var(--dsh-side-panels-width)`
    // to make room for its right panel. Hiding the panel with visibility only
    // hides its pixels — the margin stays, so the map is left in a narrower
    // box with an empty strip beside it. Zeroing the variable while the map is
    // open gives the canvas the full width, and the previous value is restored
    // on exit so the panel comes back exactly as it was.
    const SIDE_PANELS_WIDTH_VAR = '--dsh-side-panels-width'
    let savedSidePanelsWidth = null
    const setSidePanelsSqueeze = squeezed => {
      const root = document.documentElement
      if (squeezed === false) {
        root.style.setProperty(SIDE_PANELS_WIDTH_VAR, '0px')
        return
      }
      // Restoring: put back the value captured before the map took over. If
      // dsh-codex changed the width meanwhile, its own effect re-runs and
      // overwrites this anyway, so a stale restore self-heals.
      root.style.setProperty(SIDE_PANELS_WIDTH_VAR, savedSidePanelsWidth ?? '0px')
      savedSidePanelsWidth = null
    }
    const setChromeHidden = hidden => {
      const toggle = (selectors, className) => {
        for (const selector of selectors) {
          for (const element of document.querySelectorAll(selector)) {
            if (hidden) element.classList.add(className)
            else element.classList.remove(className)
          }
        }
      }
      toggle(CHROME_HIDE_SELECTORS, CHROME_HIDE_CLASS)
      toggle(COMPOSER_HIDE_SELECTORS, COMPOSER_HIDE_CLASS)
      // Capture the current squeeze BEFORE zeroing it, so leaving the map gives
      // the panel its width back. The capture happens once: a MutationObserver
      // re-asserts the hide on every DOM change, and saving again there would
      // record the already-zeroed value and collapse the panel for good.
      if (hidden === true) {
        if (savedSidePanelsWidth === null) {
          savedSidePanelsWidth = document.documentElement.style.getPropertyValue(SIDE_PANELS_WIDTH_VAR)
        }
        setSidePanelsSqueeze(false)
      } else setSidePanelsSqueeze(true)
    }
    // The Synapse iframe only exists while the map tab is active, so the
    // in-canvas sidebar is hidden unconditionally — there is no host state to
    // restore. Injected into the frame (same origin) instead of editing the
    // upstream app.js/styles.css, so upstream updates stay conflict-free.
    const CANVAS_STYLE_ID = 'dsh-synapse-canvas-style'
    // --sidebar-width drives the shell grid's first column; zeroing it lets the
    // canvas claim the full width instead of leaving a collapsed strip.
    // .view-switch is the frame's own floating 对话/会话地图 toggle — redundant
    // now that the map is a DSH tab (the host tabbar and Esc both leave it).
    // .canvas-controls (整理/定位/缩放) is kept.
    // .canvas-tabs is the 地图/详情 tab strip; with 详情 gone the whole strip
    // goes (the detail view keeps its own 返回画布 button, so nothing is
    // stranded if it is somehow entered).
    // The card footer's 详情 opens the host turn pane, so it stays visible.
    const CANVAS_STYLE = '.sidebar{display:none !important}.view-switch{display:none !important}.canvas-tabs{display:none !important}.synapse-shell{--sidebar-width:0px !important}'
    // Sliding (wheel/trackpad) pans the canvas by default; Ctrl/⌘+wheel keeps
    // zooming, and the topbar +/- buttons still work. The in-canvas `state` and
    // the camera helpers are top-level declarations of a classic script, so a
    // script injected after it can drive them directly.
    // Side-chat turn view: visual replica of dsh-codex's transcript.
    // Side-chat turn view: visual replica of dsh-codex's transcript
    // (class names and rules mirrored so the rendering matches).
    const SIDECHAT_TURN_CSS = [
      '.dsh-codex-sidechat-empty-panel { flex:1;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px }',
      '.dsh-codex-sidechat-empty-panel p { margin:0 }',
      '.dsh-codex-sidechat-transcript-wrap { position:relative;flex:1;min-height:0;display:flex;flex-direction:column }',
      '.dsh-codex-sidechat-transcript { flex:1;min-height:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:16px;container-type:inline-size;overflow-anchor:none;scrollbar-gutter:stable }',
      '/* User bubble — one-to-one with the main chat\\\'s gdEzaW_bubble. */ .dsh-codex-sidechat-user { flex-direction:column;align-items:flex-end;gap:6px;display:flex }',
      '.dsh-codex-sidechat-user-bubble { background:var(--dsw-specific-bubble);max-width:min(525px,82%);color:var(--dsw-alias-label-primary);border-radius:22px;padding:10px 16px;font-size:16px;line-height:24px;white-space:pre-wrap;word-break:break-word }',
      '/* Assistant markdown — Sxvs8a: 16/28, 16px stack gap. */ .dsh-codex-sidechat-md { color:var(--dsw-alias-label-primary);flex-direction:column;font-size:16px;line-height:28px;display:flex }',
      '.dsh-codex-sidechat-md-body { flex-direction:column;gap:16px;display:flex }',
      '.dsh-codex-sidechat-stopped { background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);border-radius:6px;align-self:flex-start;padding:0 6px;font-size:11px;line-height:18px }',
      '/* Think row — QWLzlG DisclosureRow + sweep while running. */ .dsh-codex-sidechat-think { flex-direction:column;display:flex }',
      '.dsh-codex-sidechat-think-row { position:relative;overflow:hidden }',
      '.dsh-codex-sidechat-think[data-state=running] .dsh-codex-sidechat-think-row:after { content:"";inset-block:0;background:linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);pointer-events:none;width:300px;animation:2.6s ease-out infinite dsh-codex-sidechat-row-sweep;position:absolute;left:0 }',
      '.dsh-codex-sidechat-think-leading { flex-shrink:0 }',
      '.dsh-codex-sidechat-think-chevron { color:var(--dsw-alias-label-secondary) }',
      '.dsh-codex-sidechat-think-title { font-weight:400 }',
      '.dsh-codex-sidechat-sep { background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px }',
      '.dsh-codex-sidechat-think-summary { min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:auto;font-size:14px;line-height:24px;overflow:hidden }',
      '.dsh-codex-sidechat-think-summary[data-follow-end] { text-overflow:clip }',
      '.dsh-codex-sidechat-think-body { color:var(--dsw-alias-label-tertiary);white-space:pre-wrap;word-break:break-word;padding:4px 0 4px 22px;font-size:14px;line-height:24px }',
      '/* Tool row — o3BgMG DisclosureRow + sweep while running. */ .dsh-codex-sidechat-toolrow { flex-direction:column;display:flex }',
      '.dsh-codex-sidechat-toolrow-row { position:relative;overflow:hidden }',
      '.dsh-codex-sidechat-toolrow[data-state=running] .dsh-codex-sidechat-toolrow-row:after { content:"";background:linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);pointer-events:none;width:300px;animation:2.6s ease-out infinite dsh-codex-sidechat-row-sweep;position:absolute;top:0;bottom:0;left:0 }',
      '.dsh-codex-sidechat-toolrow-leading { flex-shrink:0 }',
      '.dsh-codex-sidechat-toolrow-chevron { color:var(--dsw-alias-label-secondary) }',
      '.dsh-codex-sidechat-toolrow-title { font-weight:400 }',
      '.dsh-codex-sidechat-toolrow-summary { text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-tertiary);flex:auto;font-size:14px;line-height:24px;overflow:hidden }',
      '.dsh-codex-sidechat-toolrow-summary.is-error { color:var(--dsw-alias-state-error-primary) }',
      '.dsh-codex-sidechat-think[data-state=running] .dsh-codex-sidechat-think-row:after, .dsh-codex-sidechat-toolrow[data-state=running] .dsh-codex-sidechat-toolrow-row:after { animation:none }',
      '/* Running turn — Md3f7G_turnStatus shimmer. */ .dsh-codex-sidechat-turn-status { height:26px;font:var(--dsw-font-s-strong-14);white-space:nowrap;background:linear-gradient(90deg, var(--dsw-static-deepseek-500) 0%, var(--dsw-static-deepseek-500) 40%, var(--dsw-static-deepseek-200) 50%, var(--dsw-static-deepseek-500) 60%, var(--dsw-static-deepseek-500) 100%);color:#0000;-webkit-text-fill-color:transparent;background-position:100% 0;background-size:250% 100%;-webkit-background-clip:text;background-clip:text;flex:none;align-self:flex-start;align-items:center;animation:1.8s linear infinite dsh-codex-sidechat-turn-shimmer;display:inline-flex }',
      '.dsh-codex-sidechat-turn-clock { font:var(--dsw-font-xs-13);font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-caption);-webkit-text-fill-color:var(--dsw-alias-label-caption);margin-left:8px;font-weight:400 }',
      '.dsh-codex-sidechat-turn-status { background-position:0 0;background-size:100% 100%;animation:none }',
      '/* Jump-to-bottom — Md3f7G_toBottom floating chevron. */ .dsh-codex-sidechat-to-bottom-slot { z-index:8;height:0;pointer-events:none;justify-content:flex-end;display:flex;position:sticky;bottom:16px }',
      '.dsh-codex-sidechat-to-bottom { border:1px solid var(--dsw-alias-border-l2);width:34px;height:34px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-floating-fill);box-shadow:var(--dsw-shadow-lv2);cursor:pointer;pointer-events:auto;border-radius:100px;justify-content:center;align-items:center;margin-top:-34px;margin-right:8px;padding:0;display:flex }',
      '.dsh-codex-sidechat-to-bottom:hover { background:var(--dsw-alias-button-floating-hover) }',
      '.dsh-codex-sidechat-empty { flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center }',
      '.dsh-codex-sidechat-empty-hero { max-width:280px;display:flex;flex-direction:column;align-items:center;gap:8px }',
      '.dsh-codex-sidechat-empty-icon { color:var(--dsw-alias-label-tertiary);flex:none;margin-bottom:4px }',
      '.dsh-codex-sidechat-empty-title { margin:0;color:var(--dsw-alias-label-primary);font-size:20px;font-weight:600;line-height:28px }',
      '.dsh-codex-sidechat-empty-hint { margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;font-weight:400;line-height:20px }',
      '.dsh-codex-sidechat-toolrow-row, .dsh-codex-sidechat-think-row { display:flex; align-items:center; gap:6px; min-height:24px; color:var(--dsw-alias-label-secondary); font-size:14px; line-height:24px }',
      '.dsh-codex-sidechat-toolrow-leading, .dsh-codex-sidechat-think-leading { display:inline-flex; align-items:center; justify-content:center; width:14px; height:14px; flex:none; color:var(--dsw-alias-label-tertiary) }',
      '.dsh-codex-sidechat-toolrow-title, .dsh-codex-sidechat-think-title { flex:none; color:var(--dsw-alias-label-primary) }',
      '.dsh-synapse-turn-view { display:flex; flex-direction:column; min-height:0; height:100% }',
      '.dsh-synapse-turn-view .detail-head { flex:none }',
      '.dsh-synapse-turn-view .dsh-codex-sidechat-user-bubble { white-space:pre-wrap; word-break:break-word }',
      '.dsh-codex-sidechat-sources { list-style:none; margin:8px 0 0; padding:0; display:flex; flex-direction:column; gap:10px }',
      '.dsh-codex-sidechat-source { display:flex; flex-direction:column; gap:2px; min-width:0 }',
      '.dsh-codex-sidechat-source-title { color:var(--dsw-alias-label-primary); font-size:14px; line-height:22px; word-break:break-word }',
      '.dsh-codex-sidechat-source-link { color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; word-break:break-all }',
      '.dsh-codex-sidechat-source-snippet { color:var(--dsw-alias-label-tertiary); font-size:13px; line-height:20px }',
      '.dsh-codex-sidechat-toolresult, .dsh-codex-sidechat-terminal, .dsh-codex-sidechat-code { min-width:0; margin-top:6px }',
      '.dsh-codex-sidechat-toolresult-caption { color:var(--dsw-alias-label-secondary); font-size:13px; line-height:20px }',
      '.dsh-codex-sidechat-subcalls { display:flex; flex-direction:column; gap:8px; margin-top:8px; padding-left:8px }',
    ].join('\n')
    const CANVAS_TWEAKS_SCRIPT = `
(function () {
  if (window.__dshSynapsePanInstalled === true) return
  window.__dshSynapsePanInstalled = true
  var MIN_ZOOM = 0.2
  // Capped at 200%: beyond that the cards are mostly empty magnification.
  var MAX_ZOOM = 2
  // Mouse cursor by default; the grab hand appears only while space is held.
  // styles.css now ships a plain mouse cursor for the canvas, so the rules
  // below are a belt-and-braces guard: they keep the mouse authoritative even
  // if a cached older stylesheet is served alongside this script.
  // The space classes sit on #app, not on .canvas-viewport: render() rebuilds
  // app.innerHTML, so a class on the viewport is destroyed mid-gesture every
  // time the canvas re-renders (a live reply landing, a session sync), which
  // would drop the hand cursor while space is still held. #app survives.
  var style = document.createElement('style')
  style.id = 'dsh-synapse-cursor-style'
  style.textContent = '.canvas-viewport, .canvas-viewport.is-panning { cursor: default !important; }'
    + '.canvas-controls > span { cursor: pointer; user-select: none; }'
    + '.synapse-space-pan .canvas-viewport { cursor: grab !important; }'
    + '.synapse-space-dragging .canvas-viewport, .synapse-space-dragging .canvas-viewport * { cursor: grabbing !important; }'
    + '.synapse-space-dragging { user-select: none; }'
  document.head.appendChild(style)

  var viewportOf = function () {
    var viewport = document.querySelector('.canvas-viewport')
    return viewport instanceof HTMLElement ? viewport : null
  }
  var rootOf = function () {
    var root = document.getElementById('app')
    return root instanceof HTMLElement ? root : null
  }
  var centerOf = function (viewport) {
    var bounds = viewport.getBoundingClientRect()
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
  }
  // Anchored zoom with its own clamp: upstream's zoomCanvas is pinned to
  // 0.6-4, which is narrower than the range wanted here.
  var zoomAt = function (nextZoom, clientX, clientY) {
    var viewport = viewportOf()
    if (viewport === null) return
    var zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
    if (Math.abs(zoom - state.zoom) < 0.0005) return
    var bounds = viewport.getBoundingClientRect()
    var localX = clientX - bounds.left
    var localY = clientY - bounds.top
    var worldX = (localX - state.canvasCamera.x) / state.zoom
    var worldY = (localY - state.canvasCamera.y) / state.zoom
    state.zoom = zoom
    state.canvasCamera = { x: localX - worldX * zoom, y: localY - worldY * zoom }
    applyZoomTransform(viewport)
  }
  var applyZoomTransform = function (viewport) {
    var content = viewport.querySelector('.canvas-content')
    // Drop the composited layer before zooming: a cached will-change raster
    // would be upscaled instead of re-rasterized (the upstream zoom-blur fix).
    if (content instanceof HTMLElement) content.style.willChange = 'auto'
    applyCanvasTransform()
    syncCanvasViewport()
    window.requestAnimationFrame(function () { if (content instanceof HTMLElement) content.style.willChange = '' })
    if (typeof deferCanvasRefresh === 'function') deferCanvasRefresh()
  }
  var zoomAtCenter = function (nextZoom) {
    var viewport = viewportOf()
    if (viewport === null) return
    var center = centerOf(viewport)
    zoomAt(nextZoom, center.x, center.y)
  }
  var fitToWindow = function () {
    var viewport = viewportOf()
    if (viewport === null) return
    var content = viewport.querySelector('.canvas-content')
    if (!(content instanceof HTMLElement)) return
    var cards = content.querySelectorAll('.thread-card')
    if (cards.length === 0) return
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (var index = 0; index < cards.length; index += 1) {
      var card = cards[index]
      minX = Math.min(minX, card.offsetLeft)
      minY = Math.min(minY, card.offsetTop)
      maxX = Math.max(maxX, card.offsetLeft + card.offsetWidth)
      maxY = Math.max(maxY, card.offsetTop + card.offsetHeight)
    }
    var width = maxX - minX
    var height = maxY - minY
    if (!(width > 0) || !(height > 0)) return
    var pad = 48
    var zoom = Math.min((viewport.clientWidth - pad * 2) / width, (viewport.clientHeight - pad * 2) / height)
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
    state.zoom = zoom
    state.canvasCamera = {
      x: (viewport.clientWidth - width * zoom) / 2 - minX * zoom,
      y: (viewport.clientHeight - height * zoom) / 2 - minY * zoom,
    }
    applyZoomTransform(viewport)
  }
  // The control strip is re-rendered on every state change, so the extra
  // button is re-added whenever it disappears.
  var ensureFitButton = function () {
    var controls = document.querySelector('.canvas-controls')
    if (controls === null) return
    if (controls.querySelector('[data-synapse-fit]') !== null) return
    var button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('data-synapse-fit', '')
    button.title = '适应窗口'
    button.setAttribute('aria-label', '适应窗口')
    button.textContent = '适应'
    controls.appendChild(button)
  }

  var app = document.querySelector('#app')
  if (app === null) return

  // The wheel handler lives entirely in app.js now: it pans, and it zooms on a
  // ctrl/meta pinch. Duplicating the pinch here would zoom twice, because this
  // listener runs in the capture phase and app.js' runs in the bubble phase --
  // both would see the same event. The wide 0.2-8 clamp also moved into
  // app.js, so the pinch keeps its full range without this script.

  // Clicking a card title is handled in app.js: it forwards to the card's
  // 「在 DSH 中打开」 button so the turn opens in DSH's own conversation. Doing
  // it here too would fire first (capture phase) and jump twice.

  // Capture phase so the upstream click delegate does not also handle these.
  app.addEventListener('click', function (event) {
    var target = event.target instanceof Element ? event.target : null
    if (target === null) return
    try {
      if (typeof state === 'undefined') return
    } catch (error) { return }
    if (target.getAttribute('data-synapse-fit') !== null) {
      event.preventDefault()
      event.stopPropagation()
      fitToWindow()
      return
    }
    var zoomButton = target.closest('[data-action="zoom-in"], [data-action="zoom-out"]')
    if (zoomButton instanceof HTMLElement) {
      event.preventDefault()
      event.stopPropagation()
      zoomAtCenter(state.zoom * (zoomButton.getAttribute('data-action') === 'zoom-in' ? 1.15 : 1 / 1.15))
      return
    }
    // The zoom readout doubles as a reset-to-100% control.
    if (target instanceof HTMLElement && target.parentElement !== null
      && target.parentElement.classList.contains('canvas-controls') && target.tagName === 'SPAN') {
      event.preventDefault()
      event.stopPropagation()
      zoomAtCenter(1)
    }
  }, true)

  // User-facing copy: DSH's product name reads as 会话 in this UI. Rewritten
  // in the DOM (not in upstream source) so upstream updates stay clean. Only
  // text and label attributes are touched, and script/style contents are
  // skipped so no code is rewritten.
  var LABEL_ATTRIBUTES = ['title', 'aria-label', 'placeholder']
  var replaceCopy = function (root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentElement
        if (parent === null) return NodeFilter.FILTER_REJECT
        var tag = parent.tagName
        if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT
        return node.nodeValue !== null && node.nodeValue.indexOf('DSH') !== -1
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT
      },
    })
    var node = walker.nextNode()
    while (node !== null) {
      node.nodeValue = node.nodeValue.replace(/DSH/g, '会话')
      node = walker.nextNode()
    }
    if (typeof root.querySelectorAll !== 'function') return
    var selector = LABEL_ATTRIBUTES.map(function (name) { return '[' + name + ']' }).join(', ')
    var labelled = root.querySelectorAll(selector)
    for (var index = 0; index < labelled.length; index += 1) {
      var element = labelled[index]
      for (var attribute = 0; attribute < LABEL_ATTRIBUTES.length; attribute += 1) {
        var name = LABEL_ATTRIBUTES[attribute]
        var value = element.getAttribute(name)
        if (value !== null && value.indexOf('DSH') !== -1) {
          element.setAttribute(name, value.replace(/DSH/g, '会话'))
        }
      }
    }
  }
  var copyScheduled = false
  var scheduleCopy = function () {
    if (copyScheduled === true) return
    copyScheduled = true
    window.requestAnimationFrame(function () {
      copyScheduled = false
      replaceCopy(document.body)
    })
  }
  new MutationObserver(scheduleCopy).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  })
  scheduleCopy()

  ensureFitButton()
  var observer = new MutationObserver(ensureFitButton)
  observer.observe(app, { childList: true, subtree: true })

  // Holding space is the opt-in hand mode: the cursor becomes a grab hand and
  // dragging pans the canvas from anywhere — including over cards, where a
  // plain drag would otherwise select or open a card.
  var spaceHeld = false
  var spaceDragging = false
  var isEditable = function (target) {
    if (!(target instanceof Element)) return false
    var tag = target.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true
  }
  // The classes are re-asserted from the two booleans on every call, so a
  // re-render that rebuilds the canvas subtree cannot desync the hand from the
  // live gesture: whatever still holds is what gets shown.
  var syncSpaceClasses = function () {
    var root = rootOf()
    if (root === null) return
    root.classList.toggle('synapse-space-pan', spaceHeld === true)
    root.classList.toggle('synapse-space-dragging', spaceHeld === true && spaceDragging === true)
  }
  var setSpacePan = function (on) {
    spaceHeld = on === true
    if (spaceHeld !== true) spaceDragging = false
    syncSpaceClasses()
  }
  var setSpaceDrag = function (on) {
    spaceDragging = on === true
    syncSpaceClasses()
  }
  // render() replaces the whole canvas subtree, so the viewport element is
  // re-queried on every use instead of being cached.
  app.addEventListener('pointerdown', function (event) {
    if (spaceHeld !== true) return
    var viewport = viewportOf()
    if (viewport === null) return
    if (isEditable(event.target) === true) return
    var target = event.target instanceof Element ? event.target : null
    if (target === null || viewport.contains(target) !== true) return
    try {
      if (typeof state === 'undefined' || typeof applyCanvasTransform !== 'function') return
    } catch (error) { return }
    event.preventDefault()
    event.stopPropagation()
    var origin = { x: event.clientX, y: event.clientY, camera: { x: state.canvasCamera.x, y: state.canvasCamera.y } }
    state.canvasGesture = true
    setSpaceDrag(true)
    var move = function (moveEvent) {
      state.canvasCamera = {
        x: origin.camera.x + moveEvent.clientX - origin.x,
        y: origin.camera.y + moveEvent.clientY - origin.y,
      }
      applyCanvasTransform()
      if (typeof syncCanvasViewport === 'function') syncCanvasViewport()
    }
    var stop = function () {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', stop, true)
      window.removeEventListener('pointercancel', stop, true)
      setSpaceDrag(false)
      state.canvasGesture = false
      if (typeof scheduleLiveCardUpdate === 'function') scheduleLiveCardUpdate()
      if (typeof deferCanvasRefresh === 'function') deferCanvasRefresh()
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', stop, true)
    window.addEventListener('pointercancel', stop, true)
  }, true)
  var isSpace = function (event) { return event.code === 'Space' || event.key === ' ' }
  var setSpace = function (down) {
    spaceHeld = down === true
    setSpacePan(spaceHeld)
  }
  window.addEventListener('keydown', function (event) {
    if (isSpace(event) !== true || event.repeat === true) return
    // Space must stay a normal space while typing, and must not scroll.
    if (isEditable(event.target) === true) return
    event.preventDefault()
    setSpace(true)
  })
  window.addEventListener('keyup', function (event) {
    if (isSpace(event) !== true) return
    setSpace(false)
  })
  // The host forwards space when focus sits outside this frame — switching to
  // the map tab leaves the keyboard on the host page — so the gesture works no
  // matter where the focus is.
  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || event.data?.source !== 'dsh-synapse') return
    if (event.data.type !== 'synapse:space-pan') return
    setSpace(event.data.down === true)
  })
  window.addEventListener('blur', function () {
    setSpace(false)
  })
})()
`
    const injectCanvasStyle = doc => {
      if (doc === null || doc === undefined) return
      if (doc.getElementById(CANVAS_STYLE_ID) !== null) return
      const element = doc.createElement('style')
      element.id = CANVAS_STYLE_ID
      element.textContent = CANVAS_STYLE + '\n' + SIDECHAT_TURN_CSS
      doc.head.append(element)
      const script = doc.createElement('script')
      script.textContent = CANVAS_TWEAKS_SCRIPT
      doc.body.append(script)
    }

    module.exports.inject = ['sessions', 'workspaces', 'slots']
    module.exports.apply = ctx => {
      const runOperation = createOperationRunner()
      // The live iframe element, present only while the map view is mounted.
      let frame = null
      // Loading veil: the canvas is revealed only once it reports ready, so the
      // unstyled first paint (and the frame's own sidebar/tab strip) is never
      // visible. A timer guarantees it always appears even if that never comes.
      let veil = null
      let revealTimer = 0
      const revealFrame = () => {
        if (veil === null) return
        veil.classList.add('dsh-synapse-veil-hidden')
      }
      const prompt = async (sessionId, text) => {
        const scope = ctx.sessions.scope(sessionId)
        const session = scope === undefined ? undefined : ctx.sessions.sessionOf(scope)
        if (session === undefined) throw new Error('关联的会话已不可用')
        const result = await session.prompt([{ type: 'text', text }], 'queue')
        if (!result.ok) throw new Error(result.error?.message ?? '会话未接受这条消息')
      }
      const style = document.createElement('style')
      style.textContent = [
        '.dsh-synapse-view{position:relative;display:flex;flex:1 1 auto;width:100%;height:100%;max-height:100%;min-width:0;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base,#f5f7fa)}',
        // Reserve the sidebar width without replacing the mounted iframe.
        '.dsh-synapse-frame{display:block;flex:1 1 auto;min-width:0;min-height:0;width:100%;height:100%;border:0;-webkit-app-region:no-drag}',
        '.dsh-synapse-view.has-turn-pane .dsh-synapse-frame{flex:none;width:calc(100% - min(460px,42%));margin-right:min(460px,42%)}',
        '.dsh-synapse-veil{position:absolute;inset:0;z-index:2;background:var(--dsw-alias-bg-base,#f5f7fa);transition:opacity .2s ease}',
        '.dsh-synapse-view.has-turn-pane .dsh-synapse-veil{right:min(460px,42%)}',
        '.dsh-synapse-veil.dsh-synapse-veil-hidden{opacity:0;pointer-events:none}',
        '.dsh-synapse-tab-gate{display:none !important}',
        '.dsh-synapse-chrome-hidden{visibility:hidden !important;pointer-events:none !important}',
        'body:has(.dsh-synapse-view) [data-width-handle]{visibility:hidden !important;pointer-events:none !important}',
        '.dsh-synapse-composer-hidden{display:none !important}',
        '.dsh-synapse-turn-pane{--dsh-chat-content-width:100%;--dsh-composer-side-clearance:0px;position:absolute;inset:0 0 0 auto;z-index:3;display:flex;flex-direction:column;width:min(460px,42%);height:100%;min-width:320px;min-height:0;max-height:none;overflow:hidden;border-left:1px solid var(--dsw-alias-border-l2,#e7edf3);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#172033)}',
        '.dsh-synapse-turn-pane .dsh-codex-sidechat-transcript-wrap{flex:1;min-height:0;overflow:hidden}',
        '.dsh-synapse-turn-pane .dsh-codex-sidechat-transcript{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;overflow-anchor:none;scrollbar-gutter:stable}',
        '.dsh-synapse-turn-pane .dsh-codex-sidechat-empty-panel{flex:1;min-height:0}',
        '.dsh-synapse-turn-flow{flex:1;min-height:0;overflow-y:auto;padding:16px;overscroll-behavior:contain;overflow-anchor:none;scrollbar-gutter:stable}',
        '.dsh-synapse-turn-column{min-width:0;display:flex;flex-direction:column;gap:16px}',
        '.dsh-synapse-turn-notice{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--dsw-alias-border-l2,#e7edf3);color:var(--dsw-alias-label-secondary,#687383);font-size:12px}',
        '.dsh-synapse-turn-node{min-width:0}',
        '.dsh-synapse-turn-pane-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:none;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,#e7edf3)}',
        '.dsh-synapse-turn-pane-meta{display:flex;align-items:center;gap:8px;min-width:0}',
        '.dsh-synapse-turn-pane-badge{display:inline-flex;align-items:center;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,#eaf0fa);padding:2px 8px;color:var(--dsw-alias-state-business-primary,#3b6fd4);font-size:11px;font-weight:700}',
        '.dsh-synapse-turn-pane-hint{color:var(--dsw-alias-label-tertiary,#8a97a8);font-size:11px}',
        '.dsh-synapse-turn-pane-actions{display:flex;align-items:center;gap:8px;flex:none}',
        '.dsh-synapse-turn-pane-actions button{min-height:28px;border:1px solid var(--dsw-alias-border-l2,#d9e1ea);border-radius:7px;background:var(--dsw-alias-bg-base,#fff);padding:0 10px;color:var(--dsw-alias-label-secondary,#3d4a5c);font-size:12px}',
        '.dsh-synapse-turn-pane-close{width:28px;padding:0}',
        '.dsh-codex-sidechat-fold>summary{list-style:none;cursor:pointer}',
        '.dsh-codex-sidechat-fold>summary::-webkit-details-marker{display:none}',
        '.dsh-codex-sidechat-fold-row{display:flex;align-items:center;gap:6px;min-height:24px;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:24px}',
        '.dsh-codex-sidechat-fold-title{flex:none;color:var(--dsw-alias-label-primary)}',
        '.dsh-codex-sidechat-think-leading svg,.dsh-codex-sidechat-toolrow-leading svg{display:block;width:14px;height:14px}',
        '.dsh-codex-sidechat-md-fallback{white-space:pre-wrap;word-break:break-word}',
        SIDECHAT_TURN_CSS,
      ].join('\n')
      const send = (type, payload) => { frame?.contentWindow?.postMessage({ source: 'dsh-synapse', type, ...payload }, location.origin) }
      let syncQueued = false
      let knownSessionIds = new Set()
      const liveUnsubscribers = new Map()
      const syncLiveSessions = () => {
        const snapshot = ctx.sessions.list.getSnapshot()
        for (const id of snapshot.ids) {
          if (liveUnsubscribers.has(id)) continue
          const scope = ctx.sessions.scope(id)
          const session = scope === undefined ? undefined : ctx.sessions.sessionOf(scope)
          if (session === undefined) continue
          const publish = () => {
            if (frame === null) return
            const state = session.getSnapshot()
            const chat = chatTargetOf(ctx, id)?.getSnapshot() ?? state.chat
            const text = replyTextOfSnapshot({ ...state, chat })
            const user = nodeOfChat(chat, visibleUserKeys(chat).at(-1))
            send('synapse:live-reply', { sessionId: id, running: state.running, text, seq: seqOf(user), question: textOfContent(user?.data?.content) })
          }
          liveUnsubscribers.set(id, subscribeLiveTurn(ctx, id, publish))
          publish()
        }
        for (const [id, unsubscribe] of liveUnsubscribers) if (!snapshot.ids.includes(id)) { unsubscribe(); liveUnsubscribers.delete(id) }
      }
      const syncSessions = () => {
        if (syncQueued) return
        syncQueued = true
        queueMicrotask(() => {
          syncQueued = false
          const sessions = sessionSnapshot(ctx)
          const sessionIds = new Set(sessions.map(session => session.id))
          const removedSessionIds = [...knownSessionIds].filter(id => !sessionIds.has(id))
          knownSessionIds = sessionIds
          void fetch('/synapse/api/sessions/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessions, removedSessionIds }) }).catch(() => {})
        })
      }
      const syncTheme = () => {
        const dark = document.body?.hasAttribute?.('data-ds-dark-theme') === true
        send('synapse:theme', { dark })
      }
      const syncCurrentSession = () => {
        syncSessions()
        syncLiveSessions()
        syncTheme()
        if (frame !== null) {
          send('synapse:workspaces', { workspaces: workspaceSnapshot(ctx) })
          send('synapse:current-session', { session: currentSession(ctx) })
          // Card state machine: the host's own running / needs-input / done
          // signals per session. Sent on every list change so a card reflects
          // approvals, questions and completions as they happen.
          send('synapse:session-status', { statuses: sessionSnapshot(ctx) })
        }
      }
      const switchToDialogTab = () => {
        for (const tab of document.querySelectorAll('[role="tab"]')) {
          if ((tab.textContent ?? '').trim() === DIALOG_TAB_LABEL && tab instanceof HTMLElement) { tab.click(); return }
        }
      }
      const onMessage = event => {
        if (event.origin !== location.origin || event.data?.source !== 'dsh-synapse') return
        // The iframe's own 「对话」 button asks to leave the map.
        if (event.data.type === 'synapse:close') return switchToDialogTab()
        // Canvas rendered: drop the loading veil.
        if (event.data.type === 'synapse:map-ready') return revealFrame()
        if (event.data.type === 'synapse:request-current') {
          send('synapse:workspaces', { workspaces: workspaceSnapshot(ctx) })
          return send('synapse:current-session', { session: currentSession(ctx) })
        }
        if (event.data.type === 'synapse:open-session') {
          try { ctx.sessions.open(event.data.sessionId); switchToDialogTab() } catch { send('synapse:bridge-error', { message: '关联的会话已不可用' }) }
          // Best-effort anchor to the requested turn: chat nodes expose their
          // source event seq (anchorSeq) and render with data-chat-anchor-key,
          // so resolve seq -> node key -> scroll once the view materializes.
          const seq = event.data.seq
          if (Number.isInteger(seq)) {
            const tryScroll = attempt => {
              const scope = ctx.sessions.scope(event.data.sessionId)
              const session = scope === undefined ? undefined : ctx.sessions.sessionOf(scope)
              if (session === undefined) return
              const chat = session.getSnapshot()?.chat
              if (chat === undefined) return
              let key = undefined
              for (const node of chat.nodes.values()) {
                if (node.anchorSeq === seq) { key = node.key; break }
              }
              if (key !== undefined) {
                const row = document.querySelector(`[data-chat-anchor-key="${CSS.escape(key)}"]`)
                if (row instanceof HTMLElement) row.scrollIntoView({ block: 'start' })
                return
              }
              if (attempt < 3) window.setTimeout(() => tryScroll(attempt + 1), 500)
            }
            window.setTimeout(() => tryScroll(0), 300)
          }
          return
        }
        if (event.data.type === 'synapse:watch-turn') {
          const sessionId = typeof event.data.sessionId === 'string' && event.data.sessionId !== '' ? event.data.sessionId : null
          if (sessionId === null) {
            turnWatch.set(null)
            return
          }
          const watch = {
            sessionId,
            seq: Number.isInteger(event.data.seq) ? event.data.seq : undefined,
            turnIndex: Number.isInteger(event.data.turnIndex) ? event.data.turnIndex : undefined,
            cardId: typeof event.data.cardId === 'string' ? event.data.cardId : undefined,
            reference: typeof event.data.reference?.question === 'string' ? {
              question: event.data.reference.question,
              messageId: typeof event.data.reference.messageId === 'string' ? event.data.reference.messageId : undefined,
              root: event.data.reference.root === true,
              unique: event.data.reference.unique === true,
            } : undefined,
            preview: typeof event.data.preview?.question === 'string' ? {
              question: event.data.preview.question,
              answer: typeof event.data.preview.answer === 'string' ? event.data.preview.answer : null,
              error: typeof event.data.preview.error === 'string' ? event.data.preview.error : null,
              completed: event.data.preview.completed === true,
            } : undefined,
          }
          turnWatch.set(watch)
          // The in-canvas inspector shares the right rail; opening this pane
          // dismisses it so the two never sit side by side.
          send('synapse:close-inspector')
          return
        }
        if (event.data.type === 'synapse:activate-session') {
          // Bidirectional current-session sync: switch DSH's current session
          // without leaving the map; the sessions-list subscription re-sends
          // synapse:current-session so the map follows the new highlight.
          try { ctx.sessions.open(event.data.sessionId) } catch { send('synapse:bridge-error', { message: '关联的会话已不可用' }) }
          return
        }
        if (event.data.type === 'synapse:fork-session') {
          runOperation('fork', event.data.operationId, async () => {
            const session = await requestCardFork(event.data)
            await waitForForkSession(ctx.sessions, session.id)
            return session
          }).then(session => {
            send('synapse:forked-session', { requestId: event.data.requestId, session })
          }).catch(error => { send('synapse:bridge-error', { requestId: event.data.requestId, message: '会话分支创建失败：' + (error instanceof Error ? error.message : '请刷新后重试') }) })
          return
        }
        if (event.data.type === 'synapse:send-message') {
          const text = typeof event.data.text === 'string' ? event.data.text.trim() : ''
          if (text === '') return send('synapse:bridge-error', { requestId: event.data.requestId, message: '消息不能为空' })
          runOperation('send', event.data.operationId, () => prompt(event.data.sessionId, text)).then(() => {
            send('synapse:message-sent', { requestId: event.data.requestId, sessionId: event.data.sessionId })
          }).catch(error => {
            send('synapse:bridge-error', { requestId: event.data.requestId, message: error instanceof Error ? error.message : '会话消息发送失败' })
          })
          return
        }
        if (event.data.type === 'synapse:create-session') {
          const workspaceId = typeof event.data.workspaceId === 'string' && event.data.workspaceId !== '' && event.data.workspaceId !== 'dsh-ungrouped' ? event.data.workspaceId : undefined
          const cwd = typeof event.data.cwd === 'string' && event.data.cwd !== '' ? event.data.cwd : undefined
          const create = runOperation('create', event.data.operationId, () => workspaceId === undefined ? ctx.sessions.create(cwd === undefined ? {} : { cwd }) : ctx.sessions.create({ workspaceId }))
          create.then(id => {
            const snapshot = ctx.sessions.list.getSnapshot()
            send('synapse:created-session', { requestId: event.data.requestId, session: { id, title: snapshot.byId[id]?.displayTitle ?? '新会话', cwd: snapshot.byId[id]?.cwd ?? cwd ?? null } })
          }).catch(() => { send('synapse:bridge-error', { requestId: event.data.requestId, message: '会话创建失败，请先选择工作目录' }) })
          return
        }
        if (event.data.type === 'synapse:add-to-notes') {
          const requestId = event.data.requestId
          const body = typeof event.data.body === 'string' ? event.data.body : ''
          const tags = Array.isArray(event.data.tags) ? event.data.tags.filter(tag => typeof tag === 'string') : ['会话地图']
          if (body.trim() === '') return send('synapse:bridge-error', { requestId, message: '笔记内容为空' })
          fetch('/quick-notes/note', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'create', body, tags }),
          }).then(async response => {
            if (!response.ok) throw new Error('添加笔记失败')
            const snapshot = await response.json()
            const createdId = typeof snapshot?.createdId === 'string' ? snapshot.createdId : ''
            if (createdId !== '' && snapshot != null) {
              window.dispatchEvent(new CustomEvent('dsh-quick-notes:import', { detail: { createdId, snapshot } }))
            }
            send('synapse:note-saved', { requestId, createdId })
          }).catch(error => {
            send('synapse:bridge-error', { requestId, message: error instanceof Error ? error.message : '添加笔记失败' })
          })
        }
      }
      const onKeyDown = event => {
        if (event.key !== 'Escape' || frame === null) return
        if (turnWatch.get() !== null) { turnWatch.set(null); return }
        switchToDialogTab()
      }
      // Space is the temporary hand gesture inside the canvas. Focus usually
      // stays on the host page after switching tabs, so it is forwarded into
      // the frame rather than relying on the frame's own key events.
      const isSpaceEvent = event => event.code === 'Space' || event.key === ' '
      const isTyping = target => target instanceof HTMLElement
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable === true)
      const forwardSpace = down => {
        frame?.contentWindow?.postMessage({ source: 'dsh-synapse', type: 'synapse:space-pan', down }, location.origin)
      }
      const onSpaceDown = event => {
        if (frame === null || isSpaceEvent(event) !== true || event.repeat === true) return
        if (isTyping(event.target) === true) return
        event.preventDefault()
        forwardSpace(true)
      }
      const onSpaceUp = event => {
        if (frame === null || isSpaceEvent(event) !== true) return
        forwardSpace(false)
      }
      // Follow DSH's live theme switch: body[data-ds-dark-theme] is the web
      // client's dark-mode signal, mirrored into the map iframe via synapse:theme.
      const themeObserver = typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => syncTheme())
      function installMapBridge() {
        document.head.append(style)
        if (themeObserver !== null && document.body) {
          themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
        }
        const unsubscribeSessions = ctx.sessions.list.subscribe(syncCurrentSession)
        const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(syncCurrentSession)
        window.addEventListener('message', onMessage)
        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keydown', onSpaceDown)
        window.addEventListener('keyup', onSpaceUp)
        if (frame !== null) syncCurrentSession()
        return () => {
          window.removeEventListener('message', onMessage)
          window.removeEventListener('keydown', onKeyDown)
          window.removeEventListener('keydown', onSpaceDown)
          window.removeEventListener('keyup', onSpaceUp)
          themeObserver?.disconnect()
          unsubscribeSessions()
          unsubscribeWorkspaces()
          for (const unsubscribe of liveUnsubscribers.values()) unsubscribe()
          liveUnsubscribers.clear()
          style.remove()
        }
      }

      // The map view: the Synapse canvas in an iframe filling the session body.
      function SynapseMapView(props) {
        const ref = React.useRef(null)
        const veilRef = React.useRef(null)
        const [frameReady, setFrameReady] = React.useState(false)
        const watch = React.useSyncExternalStore(listener => turnWatch.subscribe(listener), () => turnWatch.get())
        React.useEffect(() => {
          frame = ref.current
          veil = veilRef.current
          revealTimer = window.setTimeout(revealFrame, 1500)
          setChromeHidden(true)
          // Those panels are portalled into <body> and remount on session
          // switches, so the hide is re-asserted as the DOM changes.
          const chromeObserver = new MutationObserver(() => setChromeHidden(true))
          chromeObserver.observe(document.body, { childList: true, subtree: true })
          return () => {
            window.clearTimeout(revealTimer)
            chromeObserver.disconnect()
            frame = null
            veil = null
            turnWatch.set(null)
            setChromeHidden(false)
          }
        }, [])
        const openTurnInDialog = () => {
          if (watch === null) return
          try { ctx.sessions.open(watch.sessionId); switchToDialogTab() } catch { send('synapse:bridge-error', { message: '关联的会话已不可用' }) }
          const seq = watch.seq
          if (!Number.isInteger(seq)) return
          const tryScroll = attempt => {
            const scope = ctx.sessions.scope(watch.sessionId)
            const session = scope === undefined ? undefined : ctx.sessions.sessionOf(scope)
            const chat = session?.getSnapshot()?.chat
            if (chat === undefined) {
              if (attempt < 3) window.setTimeout(() => tryScroll(attempt + 1), 500)
              return
            }
            let key
            for (const node of chat.nodes.values()) {
              if (node.anchorSeq === seq) { key = node.key; break }
            }
            if (key !== undefined) {
              const row = document.querySelector('[data-chat-anchor-key="' + CSS.escape(key) + '"]')
              if (row instanceof HTMLElement) row.scrollIntoView({ block: 'start' })
              return
            }
            if (attempt < 3) window.setTimeout(() => tryScroll(attempt + 1), 500)
          }
          window.setTimeout(() => tryScroll(0), 300)
        }
        return h(
          'div',
          { className: watch ? 'dsh-synapse-view has-turn-pane' : 'dsh-synapse-view' },
          h('iframe', {
            ref,
            className: 'dsh-synapse-frame',
            title: TAB_LABEL,
            src: '/synapse/',
            onLoad: event => {
              const element = event.currentTarget
              injectCanvasStyle(element?.contentDocument)
              // Keep the veil state declarative. The watch-turn update causes
              // this component to render again; an imperative-only class on
              // the veil would otherwise be removed by React and cover the
              // already-rendered map.
              setFrameReady(true)
              syncCurrentSession()
              // Sent from the element, not the `frame` binding: a cached frame
              // can finish loading before this effect has run.
              element?.contentWindow?.postMessage(
                { source: 'dsh-synapse', type: 'synapse:map-opened' },
                location.origin,
              )
            },
          }),
          h('div', { ref: veilRef, className: `dsh-synapse-veil${frameReady ? ' dsh-synapse-veil-hidden' : ''}` }),
          watch ? h(TurnPaneErrorBoundary, {
            key: `${watch.sessionId}:${watch.seq ?? ''}:${watch.turnIndex ?? ''}`,
            onClose: () => turnWatch.set(null),
          }, h(SynapseTurnPane, {
            watch,
            ctx,
            onClose: () => turnWatch.set(null),
            onOpenInDialog: openTurnInDialog,
            useChat: props.useChat,
            useChatNode: props.useChatNode,
            useSession: props.useSession,
            useSessions: props.useSessions,
            renderSlot: props.renderSlot,
            sessionId: props.sessionId,
            openFile: props.openFile,
            forkAt: props.forkAt,
            fileMentions: props.fileMentions,
            loadImage: props.loadImage,
            loadThrough: props.loadThrough,
            uiConversation: props.uiConversation,
          })) : null,
        )
      }

      // Invisible header resident: pins the 会话地图 tab to the right of 轨迹.
      // Header tabs render in registration order (not by `order`), so the
      // placement is applied as a flex order on the live tablist.
      function SynapseTabGate() {
        const ref = React.useRef(null)
        React.useEffect(() => {
          const node = ref.current
          if (node === null) return
          const header = node.closest('header')
          if (header === null) return
          const run = () => {
            const tablist = header.querySelector('[role="tablist"]')
            if (tablist === null) return
            for (const tab of tablist.querySelectorAll('[role="tab"]')) {
              const label = (tab.textContent ?? '').trim()
              tab.style.order = label === TAB_LABEL ? TAB_ORDER_MAP : TAB_ORDER_OTHER
            }
          }
          run()
          const observer = new MutationObserver(run)
          observer.observe(header, { childList: true, subtree: true, characterData: true })
          return () => observer.disconnect()
        }, [])
        return React.createElement('span', { ref, className: 'dsh-synapse-tab-gate', 'aria-hidden': 'true' })
      }

      ctx.effect(() => ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'synapse-map',
        order: 11,
        label: TAB_LABEL,
      }, SynapseMapView)), 'synapse: map view')
      ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
        name: 'conversation.session.header.actions',
        id: 'synapse-tab-gate',
        order: 1000,
      }, SynapseTabGate)), 'synapse: tab placement')

      ctx.effect(installMapBridge, 'synapse: web workspace switch')
    }
    return module.exports
  },
})
