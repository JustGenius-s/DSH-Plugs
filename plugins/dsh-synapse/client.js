window.__ModuleLoader__.load({
  id: 'dsh-synapse',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    let primitives = null
    try { primitives = require('@deepseek-ai/dsh-client-ui-primitives') } catch { primitives = null }
    const module = { exports: {} }
    const currentSession = ctx => {
      const snapshot = ctx.sessions.list.getSnapshot()
      const id = snapshot.current
      if (id === undefined) return null
      const session = snapshot.byId[id]
      return session === undefined ? null : { id, title: session.displayTitle, cwd: session.cwd ?? null, parentId: session.parentId ?? null }
    }
    const sessionSnapshot = ctx => {
      const snapshot = ctx.sessions.list.getSnapshot()
      return snapshot.ids.map(id => {
        const session = snapshot.byId[id]
        return session === undefined ? null : { id, title: session.displayTitle, cwd: session.cwd ?? null, parentId: session.parentId ?? null, blank: session.blank }
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

    const TOOL_VARIANTS = { bash: 'bash', pwsh: 'bash', read: 'read', web_fetch: 'read', web_search: 'search', grep: 'search', glob: 'search', write: 'write', edit: 'edit', run_code: 'code' }
    const TOOL_TITLES = { search: 'Search', read: 'Read', bash: 'Bash', write: 'Write', edit: 'Edit', code: 'Code', others: 'Tool call' }
    const seqOf = node => {
      if (node == null) return undefined
      if (typeof node.anchorSeq === 'number' && Number.isFinite(node.anchorSeq)) return node.anchorSeq
      const data = node.data
      const raw = data !== null && typeof data === 'object' ? data.seq : undefined
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
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
    const isSettledTool = block => block !== null && typeof block === 'object' && 'kind' in block
    const callName = block => isSettledTool(block) ? block.call?.name ?? '' : block.name ?? ''
    const callArgsRaw = block => (isSettledTool(block) ? block.call?.argsRaw : block.argsRaw) ?? ''
    const resultText = node => {
      const parts = []
      for (const block of node.content ?? []) {
        if (block !== null && typeof block === 'object' && block.type === 'text') parts.push(String(block.text ?? ''))
        else parts.push(JSON.stringify(block, null, 2))
      }
      if (parts.length === 0 && node.error != null) parts.push(`${node.error.name ?? 'Error'}: ${node.error.code ?? ''}`)
      return parts.join('\n')
    }
    // Slice one user turn out of the live session chat (same nodes side-chat
    // renders). seq is the user event; turnIndex is the fallback when seq is
    // missing. Read-only: the pane never prompts.
    const sliceTurnNodes = (chat, seq, turnIndex) => {
      if (chat == null || chat.order == null || chat.nodes == null) return []
      const order = Array.from(chat.order)
      const nodeOf = key => typeof chat.nodes.get === 'function' ? chat.nodes.get(key) : chat.nodes[key]
      const userKeys = []
      for (const key of order) {
        const node = nodeOf(key)
        if (node != null && node.kind === 'user' && node.visibility !== 'hidden') userKeys.push(key)
      }
      let start = -1
      if (Number.isInteger(seq)) start = userKeys.findIndex(key => seqOf(nodeOf(key)) === seq)
      if (start === -1 && Number.isInteger(turnIndex) && turnIndex >= 0 && turnIndex < userKeys.length) start = turnIndex
      if (start === -1) return []
      const from = order.indexOf(userKeys[start])
      const endKey = userKeys[start + 1]
      const to = endKey === undefined ? order.length : order.indexOf(endKey)
      const nodes = []
      for (let index = from; index < to; index += 1) {
        const node = nodeOf(order[index])
        if (node != null) nodes.push(node)
      }
      return nodes
    }
    const isLastUserTurn = (chat, seq, turnIndex) => {
      if (chat == null || chat.order == null || chat.nodes == null) return true
      const order = Array.from(chat.order)
      const nodeOf = key => typeof chat.nodes.get === 'function' ? chat.nodes.get(key) : chat.nodes[key]
      const userKeys = order.filter(key => {
        const node = nodeOf(key)
        return node != null && node.kind === 'user' && node.visibility !== 'hidden'
      })
      let start = -1
      if (Number.isInteger(seq)) start = userKeys.findIndex(key => seqOf(nodeOf(key)) === seq)
      if (start === -1 && Number.isInteger(turnIndex)) start = turnIndex
      return start === -1 || start === userKeys.length - 1
    }
    function MarkdownBody({ text, streaming }) {
      if (primitives?.MarkdownText) return h(primitives.MarkdownText, { text, streaming: streaming === true, codeLabels: { copyLabel: '复制', copiedLabel: '已复制' } })
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
        : variant === 'read' ? primitiveIcon('IconBrowseOutline16')
        : variant === 'bash' ? primitiveIcon('IconApiOutline14')
        : variant === 'write' || variant === 'edit' ? primitiveIcon('IconEditOutline16')
        : variant === 'code' ? primitiveIcon('IconCodeOutline16')
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
          const name = callName(root)
          const variant = TOOL_VARIANTS[name] ?? 'others'
          const settled = isSettledTool(root)
          const state = !settled ? 'running' : root.error?.code === 'interrupted' ? 'stopped' : root.isError ? 'error' : 'ok'
          const args = parseArgs(callArgsRaw(root))
          const keys = variant === 'bash' ? ['description', 'command'] : variant === 'search' ? ['query', 'pattern', 'url'] : variant === 'code' ? ['code', 'source'] : ['path', 'file_path', 'url', 'description', 'command']
          const summary = pickString(args, keys) || (variant === 'others' && name ? name : '')
          const output = settled ? resultText(root) : ''
          return h(FoldRow, { title: TOOL_TITLES[variant] ?? (name || 'Tool call'), summary: state === 'error' ? firstLineOf(output) || summary : summary, body: output, running: state === 'running', error: state === 'error', kind: 'tool', variant })
        }
        case 'turn-error':
          return h('div', { className: 'dsh-codex-sidechat-status-row is-error' }, typeof data.message === 'string' ? data.message : 'Turn error')
        case 'turn-max-tokens':
          return h('div', { className: 'dsh-codex-sidechat-status-row' }, '已达到输出上限')
        case 'model-retry':
          return h('div', { className: 'dsh-codex-sidechat-status-row' }, '正在重试…')
        case 'compaction':
        case 'manual-compaction': {
          const summary = typeof data.summary === 'string' ? data.summary : asRecord(data.compaction)?.summary
          return h(FoldRow, { title: '上下文已压缩', summary: typeof summary === 'string' ? firstLineOf(summary) : '', body: typeof summary === 'string' ? summary : '', kind: 'tool', variant: 'others' })
        }
        default:
          return null
      }
    }
    function SynapseTurnPane({ watch, ctx, onClose, onOpenInDialog }) {
      const [, setTick] = React.useState(0)
      React.useEffect(() => {
        try { ctx.sessions.open(watch.sessionId) } catch { /* session gone */ }
        let unsubscribe = () => {}
        let timer = 0
        let tries = 0
        const bind = () => {
          const scope = ctx.sessions.scope(watch.sessionId)
          const session = scope === undefined ? undefined : ctx.sessions.sessionOf(scope)
          if (session === undefined) {
            if (tries < 25) {
              tries += 1
              timer = window.setTimeout(bind, 200)
            }
            setTick(value => value + 1)
            return
          }
          unsubscribe = session.subscribe(() => setTick(value => value + 1))
          setTick(value => value + 1)
        }
        bind()
        return () => { window.clearTimeout(timer); unsubscribe() }
      }, [watch.sessionId])
      const scope = ctx.sessions.scope(watch.sessionId)
      const session = scope === undefined ? undefined : ctx.sessions.sessionOf(scope)
      const snapshot = session?.getSnapshot()
      const nodes = sliceTurnNodes(snapshot?.chat, watch.seq, watch.turnIndex)
      const running = snapshot?.running === true && isLastUserTurn(snapshot?.chat, watch.seq, watch.turnIndex)
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
        session === undefined
          ? h('div', { className: 'dsh-codex-sidechat-empty-panel' }, h('p', null, '正在打开这一轮…'))
          : h('div', { className: 'dsh-codex-sidechat-transcript-wrap' },
              h('div', { className: 'dsh-codex-sidechat-transcript' },
                nodes.map((node, index) => h(ChatNodeView, { key: node.key ?? String(index), node })),
                running ? h('div', { key: 'running', className: 'dsh-codex-sidechat-turn-status', role: 'status' }, 'Deep diving…') : null,
                nodes.length === 0 && !running
                  ? h('div', { className: 'dsh-codex-sidechat-empty' },
                      h('div', { className: 'dsh-codex-sidechat-empty-hero' },
                        h('h2', { className: 'dsh-codex-sidechat-empty-title' }, '这一轮还没有内容'),
                        h('p', { className: 'dsh-codex-sidechat-empty-hint' }, '等待这一轮的第一条消息。'),
                      ),
                    )
                  : null,
              ),
            ),
      )
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

    const TAB_LABEL = '会话地图'
    const DIALOG_TAB_LABEL = '对话'
    // The session header renders view tabs in raw registration order, not by
    // `order`, so the map tab is placed after 对话/轨迹 with flex order.
    const TAB_ORDER_MAP = '1'
    const TAB_ORDER_OTHER = '0'

    // Host chrome hidden while the map is the active session view: the codex
    // message rail and the right-side terminal/files panels. They are portalled
    // into <body> by that plugin, so they are addressed by its own class names.
    const CHROME_HIDE_SELECTORS = ['.dsh-codex-nav-rail', '.dsh-side-panels', '.dsh-side-panels-launcher']
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
      '.dsh-codex-sidechat-transcript { flex:1;min-height:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:16px;container-type:inline-size }',
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
      '.dsh-synapse-turn-view .dsh-codex-sidechat-user-bubble { white-space:pre-wrap; word-break:break-word }'
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

  // Show only the current DSH conversation's cards. conversationCards is a
  // top-level function declaration, so re-binding it here is picked up by the
  // app's own call sites without patching upstream source.
  var originalConversationCards = window.conversationCards
  if (typeof originalConversationCards === 'function') {
    window.conversationCards = function (threads) {
      // Resolved here rather than through currentDshThread(): that helper
      // returns undefined whenever the current-session id is missing, and a
      // fallback to "all threads" here would leak every conversation back onto
      // the canvas (seen when 整理/定位 re-rendered).
      try {
        var list = state?.workspace?.threads ?? threads
        var currentId = state?.currentDsh?.id ?? state?.activeId
        if (typeof currentId !== 'string' || currentId === '') return []
        var current = list.find(function (thread) {
          return thread?.dshSessionId === currentId || thread?.id === currentId
        })
        if (current === undefined) return []
        return originalConversationCards([current])
      } catch (error) { return [] }
    }
  }

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
        '.dsh-synapse-view{position:relative;display:flex;width:100%;height:100%;max-height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base,#f5f7fa)}',
        '.dsh-synapse-frame{display:block;flex:1;min-width:0;min-height:0;height:100%;border:0;-webkit-app-region:no-drag}',
        '.dsh-synapse-veil{position:absolute;inset:0;z-index:2;background:var(--dsw-alias-bg-base,#f5f7fa);transition:opacity .2s ease}',
        '.dsh-synapse-view.has-turn-pane .dsh-synapse-veil{right:min(460px,42%)}',
        '.dsh-synapse-veil.dsh-synapse-veil-hidden{opacity:0;pointer-events:none}',
        '.dsh-synapse-tab-gate{display:none !important}',
        '.dsh-synapse-chrome-hidden{visibility:hidden !important;pointer-events:none !important}',
        '.dsh-synapse-composer-hidden{display:none !important}',
        '.dsh-synapse-view.has-turn-pane .dsh-synapse-frame{margin-right:min(460px,42%)}',
        '.dsh-synapse-turn-pane{position:absolute;top:0;right:0;bottom:0;z-index:3;display:flex;flex-direction:column;width:min(460px,42%);min-width:320px;min-height:0;max-height:100%;overflow:hidden;border-left:1px solid var(--dsw-alias-border-l2,#e7edf3);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#172033)}',
        '.dsh-synapse-turn-pane .dsh-codex-sidechat-transcript-wrap{flex:1;min-height:0;overflow:hidden}',
        '.dsh-synapse-turn-pane .dsh-codex-sidechat-transcript{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}',
        '.dsh-synapse-turn-pane .dsh-codex-sidechat-empty-panel{flex:1;min-height:0}',
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
      document.head.append(style)
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
            const text = state.partial?.blocks.filter(block => block.kind === 'text').map(block => block.text).join('\n') ?? ''
            send('synapse:live-reply', { sessionId: id, running: state.running, text })
          }
          liveUnsubscribers.set(id, session.subscribe(publish))
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
          try { ctx.sessions.open(sessionId) } catch {
            send('synapse:bridge-error', { message: '关联的会话已不可用' })
            return
          }
          turnWatch.set({
            sessionId,
            seq: Number.isInteger(event.data.seq) ? event.data.seq : undefined,
            turnIndex: Number.isInteger(event.data.turnIndex) ? event.data.turnIndex : undefined,
            cardId: typeof event.data.cardId === 'string' ? event.data.cardId : undefined,
          })
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
          const atSeq = Number.isInteger(event.data.atSeq) ? event.data.atSeq : undefined
          // Keep the inherited title: a branch is a child of the source, not a
          // peer session that needs its own incrementing workspace name.
          ctx.sessions.fork({ sessionId: event.data.sessionId, atSeq, increaseTitle: false }).then(id => {
            const snapshot = ctx.sessions.list.getSnapshot()
            send('synapse:forked-session', { requestId: event.data.requestId, session: { id, title: snapshot.byId[id]?.displayTitle ?? '会话分支', parentId: snapshot.byId[id]?.parentId ?? event.data.sessionId } })
          }).catch(() => { send('synapse:bridge-error', { message: '会话分支创建失败，请确认源会话已经完成当前轮次' }) })
          return
        }
        if (event.data.type === 'synapse:archive-session') {
          const sessionId = typeof event.data.sessionId === 'string' ? event.data.sessionId : ''
          if (sessionId === '') return send('synapse:bridge-error', { requestId: event.data.requestId, message: '缺少要删除的会话' })
          ctx.workspaces.archiveSession(sessionId).then(() => {
            send('synapse:archived-session', { requestId: event.data.requestId, sessionId })
          }).catch(() => { send('synapse:bridge-error', { requestId: event.data.requestId, message: '分支会话删除失败' }) })
          return
        }
        if (event.data.type === 'synapse:send-message') {
          const text = typeof event.data.text === 'string' ? event.data.text.trim() : ''
          if (text === '') return send('synapse:bridge-error', { requestId: event.data.requestId, message: '消息不能为空' })
          prompt(event.data.sessionId, text).then(() => {
            send('synapse:message-sent', { requestId: event.data.requestId, sessionId: event.data.sessionId })
          }).catch(error => {
            send('synapse:bridge-error', { requestId: event.data.requestId, message: error instanceof Error ? error.message : '会话消息发送失败' })
          })
          return
        }
        if (event.data.type === 'synapse:create-session') {
          const workspaceId = typeof event.data.workspaceId === 'string' && event.data.workspaceId !== '' && event.data.workspaceId !== 'dsh-ungrouped' ? event.data.workspaceId : undefined
          const cwd = typeof event.data.cwd === 'string' && event.data.cwd !== '' ? event.data.cwd : undefined
          const create = workspaceId === undefined ? ctx.sessions.create(cwd === undefined ? {} : { cwd }) : ctx.sessions.create({ workspaceId })
          create.then(id => {
            const snapshot = ctx.sessions.list.getSnapshot()
            send('synapse:created-session', { requestId: event.data.requestId, session: { id, title: snapshot.byId[id]?.displayTitle ?? '新会话', cwd: snapshot.byId[id]?.cwd ?? cwd ?? null } })
          }).catch(() => { send('synapse:bridge-error', { requestId: event.data.requestId, message: '会话创建失败，请先选择工作目录' }) })
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
      if (themeObserver !== null && document.body) {
        themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
      }
      const unsubscribeSessions = ctx.sessions.list.subscribe(syncCurrentSession)
      const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(syncCurrentSession)
      window.addEventListener('message', onMessage)
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keydown', onSpaceDown)
      window.addEventListener('keyup', onSpaceUp)

      // The map view: the Synapse canvas in an iframe filling the session body.
      function SynapseMapView() {
        const ref = React.useRef(null)
        const veilRef = React.useRef(null)
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
              syncCurrentSession()
              // Sent from the element, not the `frame` binding: a cached frame
              // can finish loading before this effect has run.
              element?.contentWindow?.postMessage(
                { source: 'dsh-synapse', type: 'synapse:map-opened' },
                location.origin,
              )
            },
          }),
          h('div', { ref: veilRef, className: 'dsh-synapse-veil' }),
          watch ? h(SynapseTurnPane, {
            watch,
            ctx,
            onClose: () => turnWatch.set(null),
            onOpenInDialog: openTurnInDialog,
          }) : null,
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

      ctx.effect(() => () => {
        window.removeEventListener('message', onMessage)
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keydown', onSpaceDown)
        window.removeEventListener('keyup', onSpaceUp)
        themeObserver?.disconnect()
        unsubscribeSessions()
        unsubscribeWorkspaces()
        for (const unsubscribe of liveUnsubscribers.values()) unsubscribe()
        style.remove()
      }, 'synapse: web workspace switch')
    }
    return module.exports
  },
})
