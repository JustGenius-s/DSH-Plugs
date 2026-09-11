import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('uses one camera transform without browser scroll coordinates', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')

  assert.match(source, /canvasCamera: \{ x: 0, y: 0 \}/)
  assert.match(source, /translate\(\$\{state\.canvasCamera\.x\}px, \$\{state\.canvasCamera\.y\}px\) scale\(\$\{state\.zoom\}\)/)
  assert.doesNotMatch(source, /canvasScroll|canvasPadding|canvasDomShift|canvasMetrics|viewport\.scrollLeft|viewport\.scrollTop/)
})

test('reuses the map iframe and initializes the canvas only after iframe load', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const openFlow = source.slice(source.indexOf('function SynapseMapView'), source.indexOf('// Invisible header resident'))

  // The iframe keeps one fixed source: reassigning src would reload the canvas
  // and drop its live state on every re-render.
  assert.doesNotMatch(openFlow, /frame\.src\s*=/)
  assert.match(openFlow, /src: '\/synapse\/'/)
  // The canvas only switches to map mode once the frame reports it is loaded.
  assert.match(openFlow, /onLoad: event => \{/)
  // Posted from the element so a cached frame that loads before the effect
  // assigns `frame` still puts the canvas into map mode.
  assert.match(openFlow, /type: 'synapse:map-opened'/)
  // The live frame reference is published on mount and cleared on unmount, so
  // session sync only targets a frame that is actually mounted.
  assert.match(source, /frame = ref\.current/)
  assert.match(openFlow, /frame = null/)
  assert.match(source, /if \(frame === null\) return/)
  // The veil is controlled by React state as well as the imperative reveal
  // helper, so adding the turn pane cannot make React paint it back over the
  // already-rendered iframe.
  assert.match(openFlow, /useState\(false\)/)
  assert.match(openFlow, /dsh-synapse-veil-hidden/)
})

test('keeps the canvas viewport across dialog/map toggles and recenters on real session switches', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const mapOpened = source.slice(source.indexOf("if (data.type === 'synapse:map-opened')"), source.indexOf("if (data.type === 'synapse:workspaces')"))
  const currentSession = source.slice(source.indexOf("if (data.type === 'synapse:current-session')"), source.indexOf("if (data.type === 'synapse:live-reply'"))

  // Reopening the map for the same session must NOT reset the camera: only a
  // real session switch (current-session id change) re-centers the canvas.
  assert.doesNotMatch(mapOpened, /resetCanvasCamera\(\)/)
  assert.match(mapOpened, /state\.mode = 'canvas'\s+render\(\)/)
  assert.match(currentSession, /previousId !== data\.session\?\.id/)
  assert.match(currentSession, /focusActiveCard\(\)/)
})

test('lets the card answer scroll with the native wheel instead of adding deltaY', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const wheel = source.slice(source.indexOf("app.addEventListener('wheel'"), source.indexOf("app.addEventListener('click'"))

  assert.match(wheel, /native wheel/)
  assert.doesNotMatch(wheel, /scrollTop\s*\+=/)
})

test('preserves each card answer scroll across canvas re-renders', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const render = source.slice(source.indexOf('function render() {'), source.indexOf('function renderPreservingDetailScroll'))

  assert.match(render, /cardScrollTops/)
  assert.match(render, /card\.dataset\.cardId/)
  assert.match(render, /\.thread-card\[data-card-id=/)
  assert.match(render, /\.thread-answer`\)\s*if \(answer instanceof HTMLElement\) answer\.scrollTop = scrollTop/)
})

test('activating a session from the map syncs DSH without closing the map', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const activate = source.slice(source.indexOf("'synapse:activate-session'"), source.indexOf("'synapse:fork-session'"))

  assert.match(activate, /ctx\.sessions\.open\(event\.data\.sessionId\)/)
  assert.doesNotMatch(activate, /close\(\)/)
})

test('a failed fork settles the matching canvas RPC immediately', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const fork = source.slice(source.indexOf("'synapse:fork-session'"), source.indexOf("'synapse:send-message'"))

  // dshRpc waits by request id. Omitting it here leaves a failed fork hanging
  // until the generic 20-second timeout instead of restoring the branch draft.
  assert.match(fork, /send\('synapse:bridge-error', \{ requestId: event\.data\.requestId, message: '会话分支创建失败/)
})

test('selecting a session in the sidebar syncs the DSH current session', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const selectThread = source.slice(source.indexOf("button.dataset.action === 'select-thread'"), source.indexOf("button.dataset.action === 'show-thread'"))

  assert.match(selectThread, /synapse:activate-session/)
})

test('clicking a session card opens its inspector without activating the DSH session', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const cardClick = source.slice(source.indexOf('if (!(button instanceof HTMLElement)) {'), source.indexOf("if (button.dataset.action === 'close')"))

  assert.match(cardClick, /openCardInspector\(selection\.inspectorCardId\)/)
  assert.doesNotMatch(cardClick, /synapse:activate-session/)
})

test('a plain card selection has no host-session activation effect', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const start = source.indexOf('function canvasCardSelection')
  const end = source.indexOf('function watchCardTurn', start)
  const selection = new Function(`${source.slice(start, end)}; return canvasCardSelection`)()

  assert.deepEqual(selection({ id: 'fork-thread', dshSessionId: 'fork-session' }, 'fork-thread:turn:7'), {
    activeId: 'fork-thread',
    selectedCardId: 'fork-thread:turn:7',
    inspectorCardId: 'fork-thread:turn:7',
  })
})

test('an idle live snapshot publishes the committed assistant answer after partial text clears', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const start = source.indexOf('const nodeOfChat')
  const end = source.indexOf('const turnNumberOf', start)
  const replyTextOfSnapshot = new Function(`${source.slice(start, end)}; return replyTextOfSnapshot`)()
  const chat = {
    order: ['user', 'assistant'],
    nodes: new Map([
      ['user', { kind: 'user', data: { content: [{ type: 'text', text: '问题' }] } }],
      ['assistant', { kind: 'assistant-step', data: { status: 'settled', blocks: [{ kind: 'text', text: '最终回答' }] } }],
    ]),
  }

  assert.equal(replyTextOfSnapshot({ running: false, partial: undefined, chat }), '最终回答')
  assert.equal(replyTextOfSnapshot({ running: true, partial: { blocks: [{ kind: 'text', text: '流式回答' }] }, chat }), '流式回答')

  chat.order.push('next-user')
  chat.nodes.set('next-user', { kind: 'user', data: { content: [{ type: 'text', text: '尚未回答的问题' }] } })
  assert.equal(replyTextOfSnapshot({ running: false, partial: undefined, chat }), '', 'must not reuse the previous turn answer')
})

test('keeps conversation highlighting separate from the exact selected card', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8')
  const connectors = source.slice(source.indexOf('function canvasConnectors'), source.indexOf('function conversationCard(card, graph)'))
  const card = source.slice(source.indexOf('function conversationCard(card, graph)'), source.indexOf('function draftActions'))
  const cardClick = source.slice(source.indexOf('if (!(button instanceof HTMLElement)) {'), source.indexOf("if (button.dataset.action === 'close')"))
  const selectThread = source.slice(source.indexOf("button.dataset.action === 'select-thread'"), source.indexOf("button.dataset.action === 'show-thread'"))

  assert.match(source, /selectedCardId: null/)
  assert.match(card, /card\.id === state\.selectedCardId/)
  assert.doesNotMatch(card, /dshThreadId === state\.activeId/)
  assert.match(connectors, /card\.dshThreadId === state\.activeId && parent\.dshThreadId === state\.activeId/)
  assert.match(connectors, /active-connector/)
  assert.match(cardClick, /state\.selectedCardId = selection\.selectedCardId/)
  assert.match(selectThread, /state\.selectedCardId = null/)
  assert.match(styles, /\.connectors path\.active-connector \{ stroke: #3478f6; \}/)
  assert.match(styles, /\[data-theme="dark"\] \.connectors path\.active-connector \{ stroke: #5b8def; \}/)
  assert.doesNotMatch(styles, /\.thread-card\.active/)
})

test('keeps blank branches on the canvas as outlined placeholder cards', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8')
  const blanks = source.slice(source.indexOf('if (turns.length === 0)'), source.indexOf('turns.at(-1).canContinue = true'))
  const card = source.slice(source.indexOf('function conversationCard(card, graph)'), source.indexOf('function draftActions'))

  // Visibility is gated by the branch link, not by a freshness window: a fork
  // the user created stays on the family tree even before its first message.
  assert.match(blanks, /thread\.parentId != null \|\| \(typeof thread\.sourceParentSessionId === 'string'/)
  assert.doesNotMatch(blanks, /if \(!isFreshBlankFork\(thread\)/)
  assert.match(blanks, /blank: true/)
  assert.match(blanks, /'空分支'/)
  // The placeholder carries its own copy and no misleading state badge.
  assert.match(card, /card\.blank === true \? ' card-blank'/)
  assert.match(card, /card\.blank === true \? '' : cardStateBadge/)
  assert.match(card, /这个分支还没有消息/)
  assert.match(styles, /\.thread-card\.card-blank \{ border-style: dashed/)
  assert.match(styles, /\[data-theme="dark"\] \.thread-card\.card-blank/)
})

test('opens the clicked card in a focused detail inspector', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8')
  const cardClick = source.slice(source.indexOf('if (!(button instanceof HTMLElement)) {'), source.indexOf("if (button.dataset.action === 'close')"))
  const inspector = source.slice(source.indexOf('function renderCardInspector'), source.indexOf('function renderThread'))

  assert.match(source, /inspectorCardId: null/)
  assert.match(source, /function openCardInspector/)
  assert.match(cardClick, /openCardInspector\(selection\.inspectorCardId\)/)
  // v5: the inspector reads the full turn back from DSH instead of keeping a
  // local message copy. Tool/process diagnostics stay in the live turn view;
  // this reading surface shows only the question, final answer, and error.
  assert.match(inspector, /historyForCard\(thread, card\.id\)/)
  assert.doesNotMatch(inspector, /detail\?\.process/)
  assert.doesNotMatch(inspector, /processRecords\(/)
  assert.doesNotMatch(inspector, /processCount/)
  assert.doesNotMatch(inspector, /过程记录/)
  assert.doesNotMatch(inspector, /工具 \$\{/)
  assert.doesNotMatch(inspector, /threadMessage\(thread, message\)/)
  assert.match(inspector, /class="card-inspector/)
  assert.match(inspector, /data-action="open-continue"/)
  assert.doesNotMatch(inspector, /完整对话/)
  assert.match(inspector, /<svg aria-hidden="true" viewBox="0 0 16 16">/)
  assert.match(inspector, /card\.canContinue === true/)
  assert.match(inspector, /card-inspector-error/)
  assert.match(source, /button\.dataset\.action === 'close-card-inspector'/)
  assert.match(source, /event\.key !== 'Escape'/)
  assert.match(styles, /\.card-inspector \{ position: absolute/)
  assert.match(styles, /\.card-inspector\.is-opening, \.card-inspector\.is-closing/)
  assert.match(styles, /\.card-inspector-answer/)
  assert.doesNotMatch(styles, /\.card-inspector \{[^}]*box-shadow/)
  assert.match(styles, /\.card-inspector-actions button svg/)
  assert.doesNotMatch(styles, /\.card-inspector-head \{[^}]*border-bottom/)
  assert.match(styles, /\.card-inspector \{ top: auto; width: 100%/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(styles, /\.thread-meta \.card-process-count/)

  assert.match(inspector, /data-action="toggle-inspector-toc"/)
  assert.match(inspector, /data-action="toggle-inspector-expand"/)
  assert.match(inspector, /data-action="add-to-notes"/)
  assert.match(inspector, /card-inspector-resize/)
  assert.match(inspector, /card-inspector-tools/)
  assert.match(inspector, /card-inspector-body/)
  // Meta/actions share the first row; the title is their sibling on row two
  // and spans the whole drawer, so it wraps only at the drawer's right edge.
  assert.match(inspector, /card-inspector-meta[\s\S]*card-inspector-tools[\s\S]*<h2>/)
  assert.match(styles, /\.card-inspector-head h2 \{[^}]*grid-column: 1 \/ -1/)
  assert.match(styles, /\.card-inspector-head h2 \{[^}]*width: 100%/)
  assert.match(styles, /\.card-inspector-head h2 \{[^}]*white-space: normal/)
  // Long titles clamp to two lines with an ellipsis, on the map card and in
  // the inspector header alike, instead of growing the header without bound.
  assert.match(styles, /\.card-inspector-head h2 \{[^}]*-webkit-line-clamp: 2/)
  assert.match(styles, /\.thread-title \{[^}]*-webkit-line-clamp: 2/)
  assert.match(inspector, /\$\{addToNotes\}\$\{tocButton\}/)
  assert.match(source, /function clampInspectorWidth/)
  assert.match(source, /function installInspectorResize/)
  assert.match(source, /function installInspectorTocResize/)
  assert.match(source, /function inspectorTocIsDocked/)
  assert.match(source, /dsh-synapse:inspector-width:v1/)
  assert.match(source, /dsh-synapse:inspector-toc-width:v1/)
  assert.doesNotMatch(source, /dsh-synapse:inspector-expanded:v1/)
  assert.match(source, /state\.inspectorExpanded = false/)
  assert.match(source, /state\.inspectorTocOpen !== true/)
  assert.match(source, /synapse:add-to-notes/)
  assert.match(source, /function jumpInspectorHeading/)
  assert.match(source, /rememberInspectorScroll\(nextTop\)/)
  assert.match(source, /scroller\.querySelector\(`#\$\{CSS\.escape\(headingId\)}`\)/)
  const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(client, /synapse:add-to-notes/)
  assert.match(client, /dsh-quick-notes:import/)
  assert.match(styles, /\.card-inspector-toc/)
  assert.match(styles, /\.card-inspector-toc\.is-open \{ display: grid/)
  assert.match(styles, /\.card-inspector-toc\[hidden\] \{ display: none/)
  assert.match(styles, /\.card-inspector-body/)
  assert.match(styles, /\.card-inspector-resize/)
  assert.match(styles, /\.card-inspector\.is-expanded/)
  assert.match(styles, /\.card-inspector-toc-resize/)
  assert.match(styles, /--inspector-toc-width/)
  assert.match(styles, /align-content: start/)
  assert.match(styles, /cursor: ew-resize/)
  assert.match(styles, /\.card-inspector-answer h1 \{/)
})

test('card titles use a nonempty visual override without replacing the original question', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const helper = source.slice(source.indexOf('function cardTitleOf'), source.indexOf('function cardQuestionOf'))
  const titleOf = new Function(`${helper}; return cardTitleOf`)()
  const turn = { question: 'Original question', title: '  Short title  ', hidden: true }
  assert.equal(titleOf(turn), 'Short title')
  assert.equal(turn.question, 'Original question')
  assert.equal(titleOf({ title: '  ' }), null)
  assert.equal(titleOf({}), null)
  assert.equal(titleOf(null), null)
})

test('switching the workspace in the map syncs DSH to its first session', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const select = source.slice(source.indexOf("app.addEventListener('change'"), source.indexOf("app.addEventListener('input'"))

  assert.match(select, /choice\.rootSessionIds\?\.\[0\] \?\? choice\.sessionIds\[0\]/)
  assert.match(select, /post\('synapse:activate-session'/)
})

test('renders markdown tables and allows higher canvas zoom', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const markdown = source.slice(source.indexOf('const tableCells'), source.indexOf('function overlapsCard'))

  assert.match(markdown, /md-table-wrap/)
  assert.match(markdown, /<table><thead>/)
  assert.match(markdown, /isTableDelimiter/)
  assert.match(markdown, /function takeTable/)
  // Zoom bounds are named constants, not the upstream 0.6-4 literals, and
  // clamp every zoom path (buttons, pinch, fit) even without the injection.
  assert.match(source, /const MIN_ZOOM = 0\.2/)
  assert.match(source, /const MAX_ZOOM = 2/)
  assert.match(source, /Math\.min\(MAX_ZOOM, Math\.max\(MIN_ZOOM, nextZoom\)\)/)
  assert.doesNotMatch(source, /Math\.min\(4, Math\.max\(\.6,/)
})

test('renders the detail view from turns read back from DSH', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const thread = source.slice(source.indexOf('function renderThread'), source.indexOf('function render()'))

  assert.match(thread, /detail-scroll/)
  assert.match(thread, /detail-head/)
  // v5: one section per stored turn, each filled from its on-demand detail.
  assert.match(thread, /turnsFor\(thread\)/)
  assert.match(thread, /historyForCard\(thread, card\.id\)/)
  assert.match(thread, /detail-turn/)
  assert.doesNotMatch(source, /function threadMessage\(/)
})

test('persists dragged card positions and can focus the current session', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')

  assert.match(source, /localStorage\.setItem\(CARD_POSITIONS_KEY/)
  assert.match(source, /function focusActiveCard\(\)/)
  assert.match(source, /data-action="focus-active"/)
})

test('switching workspaces syncs DSH to the most recently updated session', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const select = source.slice(source.indexOf("app.addEventListener('change'"), source.indexOf("app.addEventListener('input'"))

  assert.match(select, /latestRootThread\(threads\)/)
  assert.match(select, /post\('synapse:activate-session'/)
})

test('mirrors DSH theme changes into the map', async () => {
  const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8')

  assert.match(clientSource, /data-ds-dark-theme/)
  assert.match(clientSource, /synapse:theme/)
  assert.match(appSource, /data\.type === 'synapse:theme'/)
  assert.match(appSource, /document\.documentElement\.dataset\.theme/)
})

test('leaves text selections inside cards intact', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const cardClick = source.slice(source.indexOf('if (!(button instanceof HTMLElement)) {'), source.indexOf("if (button.dataset.action === 'close')"))

  assert.match(cardClick, /event\.detail > 1/)
  assert.match(cardClick, /Math\.hypot/)
  assert.match(source, /pointerDownPosition = \{ x: event\.clientX/)
})

test('opens a card 详情 button as a read-only live-session turn pane', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const card = app.slice(app.indexOf('function conversationCard'), app.indexOf('function draftActions'))
  const click = app.slice(app.indexOf("app.addEventListener('click', async event"))

  // The footer 详情 button stays on the map and asks the host to watch one
  // turn. Title editing does not navigate to the turn pane.
  assert.match(card, /data-action="watch-turn"/)
  assert.doesNotMatch(card, /data-action="show-thread"/)
  assert.doesNotMatch(card, /data-action="archive-thread"/)
  assert.match(click, /button\.dataset\.action === 'watch-turn'/)
  assert.match(click, /dispatchCardSessionAction\(button\.dataset\.action, thread, button\.dataset\.card, button\.dataset\.seq\)/)
  assert.doesNotMatch(click, /closest\('\.thread-title'\)/)
  assert.doesNotMatch(click, /openButton\.click\(\)/)
  assert.match(app, /function watchCardTurn/)
  assert.match(app, /'synapse:watch-turn'/)
  const watchCard = app.slice(app.indexOf('function watchCardTurn'), app.indexOf('function cardHideReason'))
  assert.doesNotMatch(watchCard, /'synapse:activate-session'/)
  // The host binds the live session and mounts the read-only pane.
  assert.match(source, /'synapse:watch-turn'\)/)
  assert.match(source, /function SynapseTurnPane/)
  assert.match(source, /turnWatch\.set\(/)
  assert.match(source, /onOpenInDialog/)
  const pane = source.slice(source.indexOf('function SynapseTurnPane'), source.indexOf('const turnWatch'))
  assert.doesNotMatch(pane, /session\.prompt/)
  assert.match(source, /send\('synapse:close-inspector'\)/)
  assert.match(source, /function OfficialTurnPane/)
  assert.match(source, /useChat\(snapshot => snapshot\?\.order/)
  assert.match(source, /loadTurnThrough/)
  assert.match(source, /function turnPaneSource/)
  assert.match(source, /=== 'official'\) return h\(OfficialTurnPane/)
  // conversation.chat.node is owned by the official Chat view. Declaring it
  // as a child of synapse-map conflicts and drops this tab.
  assert.doesNotMatch(source, /'conversation.chat.node': \{ kind: 'keyed'/)
  assert.doesNotMatch(source, /CHAT_NODE_INJECT/)
})

test('详情 reads another fork without activating that session, with or without chat hooks', async () => {
  const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const watchCard = appSource.slice(appSource.indexOf('function watchCardTurn'), appSource.indexOf('function cardHideReason'))
  const watchHandler = clientSource.slice(clientSource.indexOf("if (event.data.type === 'synapse:watch-turn')"), clientSource.indexOf("if (event.data.type === 'synapse:activate-session')"))
  const remotePane = clientSource.slice(clientSource.indexOf('async function readTurnDetail'), clientSource.indexOf('function turnPaneSource'))
  const sourceStart = clientSource.indexOf('function turnPaneSource')
  const sourceEnd = clientSource.indexOf('function SynapseTurnPane', sourceStart)
  const turnPaneSource = new Function(`${clientSource.slice(sourceStart, sourceEnd)}; return turnPaneSource`)()

  assert.match(watchCard, /synapse:watch-turn/)
  assert.doesNotMatch(watchCard, /synapse:activate-session/)
  assert.doesNotMatch(watchHandler, /ctx\.sessions\.open/)
  assert.doesNotMatch(remotePane, /ctx\.sessions/)
  assert.equal(turnPaneSource('fork-session', 'current-session', true), 'remote')
  assert.equal(turnPaneSource('fork-session', 'current-session', false), 'remote')
  assert.equal(turnPaneSource('current-session', 'current-session', false), 'remote')
  assert.equal(turnPaneSource('current-session', 'current-session', true), 'official')
  assert.equal(turnPaneSource('fork-session', 'current-session', true, true), 'legacy')
  assert.equal(turnPaneSource('fork-session', 'current-session', false, true), 'legacy')
  assert.equal(turnPaneSource('current-session', 'current-session', true, true), 'official')
})

test('详情 renders a non-current fork from the server detail fallback', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const pane = source.slice(source.indexOf('async function readTurnDetail'), source.indexOf('function turnPaneSource'))
  const selector = source.slice(source.indexOf('function SynapseTurnPane'), source.indexOf('const turnWatch'))

  assert.match(pane, /request\('\/synapse\/api\/turn-detail'/)
  assert.match(pane, /subscribeTurnDetail\(watch,/)
  assert.match(pane, /readTurnDetail\(target, fetch, signal\)/)
  assert.match(pane, /sessionId: watch\.sessionId/)
  assert.match(pane, /read\(Number\.isInteger\(watch\.seq\) \? watch\.seq : null\)/)
  assert.match(pane, /detailToChatNodes\(displayDetail\)/)
  assert.match(pane, /h\(TurnNodeSeat/)
  assert.match(selector, /return h\(RemoteTurnPane, \{/)
  assert.match(selector, /source === 'legacy'/)
  assert.match(selector, /return h\(LegacyTurnPane, \{/)
  // The fallback is only for a cold watched session; the current
  // session keeps the official live chat rendering path, and a live
  // non-current session streams through LegacyTurnPane.
  assert.match(selector, /source === 'official'\) return h\(OfficialTurnPane, props\)/)
})

test('keeps the host turn pane and the card inspector mutually exclusive', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const openInspector = source.slice(source.indexOf('function openCardInspector'), source.indexOf('function closeCardInspector'))
  const watch = source.slice(source.indexOf('function watchCardTurn'), source.indexOf('function dshRpc'))

  assert.match(source, /function dismissTurnPane/)
  assert.match(source, /post\('synapse:watch-turn', \{\}\)/)
  assert.match(openInspector, /dismissTurnPane\(\)/)
  assert.match(watch, /closeCardInspector\(\{ animate: false \}\)/)
  assert.match(source, /'synapse:close-inspector'/)
  assert.match(client, /send\('synapse:close-inspector'\)/)
  assert.ok(client.indexOf("send('synapse:close-inspector')") > client.indexOf("event.data.type === 'synapse:watch-turn'"),
    'opening the host pane must ask the iframe to close its inspector')
})

test('sliceTurnNodes keeps one user turn from the live session chat', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const start = source.indexOf('const seqOf = node =>')
  const end = source.indexOf('function MarkdownBody')
  assert.ok(start !== -1 && end > start)
  const exports = {}
  new Function('exports', `${source.slice(start, end)}\nexports.seqOf = seqOf\nexports.sliceTurnNodes = sliceTurnNodes\nexports.sliceTurnKeys = sliceTurnKeys\nexports.sliceTurnKeysLive = sliceTurnKeysLive\nexports.liveTailKeys = liveTailKeys\nexports.keysBetweenUser = keysBetweenUser\nexports.isLastUserTurn = isLastUserTurn`)(exports)

  const chat = {
    order: ['u1', 'think', 'tool', 'a1', 'u2', 'a2'],
    nodes: new Map([
      ['u1', { kind: 'user', anchorSeq: 10, data: { content: [{ type: 'text', text: '第一轮' }] } }],
      ['think', { kind: 'assistant-step', anchorSeq: 11, data: { blocks: [{ kind: 'reasoning', text: '想' }] } }],
      ['tool', { kind: 'tool-call', anchorSeq: 12, data: { root: { name: 'bash' } } }],
      ['a1', { kind: 'assistant-step', anchorSeq: 13, data: { blocks: [{ kind: 'text', text: '答一' }] } }],
      ['u2', { kind: 'user', anchorSeq: 20, data: { content: [{ type: 'text', text: '第二轮' }] } }],
      ['a2', { kind: 'assistant-step', anchorSeq: 21, data: { blocks: [{ kind: 'text', text: '答二' }] } }],
    ]),
  }

  const first = exports.sliceTurnNodes(chat, 10, 0)
  assert.deepEqual(first.map(node => node.kind), ['user', 'assistant-step', 'tool-call', 'assistant-step'])
  assert.equal(exports.isLastUserTurn(chat, 10, 0), false)

  const second = exports.sliceTurnNodes(chat, 20, 1)
  assert.deepEqual(second.map(node => node.kind), ['user', 'assistant-step'])
  assert.equal(exports.isLastUserTurn(chat, 20, 1), true)

  // Hidden users are skipped; a missing seq falls back to turnIndex.
  chat.nodes.get('u1').visibility = 'hidden'
  const fallback = exports.sliceTurnNodes(chat, undefined, 0)
  assert.equal(fallback[0].anchorSeq, 20)
  assert.deepEqual(exports.sliceTurnNodes(null, 10, 0), [])

  const located = {
    order: ['u1', 'think', 'a1', 'u2', 'a2'],
    nodes: new Map([
      ['u1', { kind: 'user', anchorSeq: 10, location: { kind: 'turn', turn: { turn: 1 } } }],
      ['think', { kind: 'assistant-step', anchorSeq: 11, location: { kind: 'step', turn: { turn: 1 } } }],
      ['a1', { kind: 'assistant-step', anchorSeq: 12, location: { kind: 'step', turn: { turn: 1 } } }],
      ['u2', { kind: 'user', anchorSeq: 20, location: { kind: 'turn', turn: { turn: 2 } } }],
      ['a2', { kind: 'assistant-step', anchorSeq: 21, location: { kind: 'step', turn: { turn: 2 } } }],
    ]),
    locations: { getTurn: turn => (turn === 1 ? ['u1', 'think', 'a1'] : turn === 2 ? ['u2', 'a2'] : []) },
  }
  assert.deepEqual(exports.sliceTurnKeys(located, 10, 0), ['u1', 'think', 'a1'])
  assert.deepEqual(exports.sliceTurnKeys(located, undefined, 1), ['u2', 'a2'])

  // A running last turn keeps nodes that land after the frozen location index.
  const streaming = {
    order: ['u2', 'a2', 'tool2'],
    nodes: new Map([
      ['u2', { kind: 'user', anchorSeq: 20, location: { kind: 'turn', turn: { turn: 2 } } }],
      ['a2', { kind: 'assistant-step', anchorSeq: 21, location: { kind: 'step', turn: { turn: 2 } } }],
      ['tool2', { kind: 'tool-call', anchorSeq: 22, data: { root: { name: 'web_search' } } }],
    ]),
    locations: { getTurn: turn => (turn === 2 ? ['u2', 'a2'] : []) },
  }
  assert.deepEqual(exports.sliceTurnKeys(streaming, 20, 1), ['u2', 'a2'])
  assert.deepEqual(exports.sliceTurnKeysLive(streaming, 20, 1, false), ['u2', 'a2'])
  assert.deepEqual(exports.sliceTurnKeysLive(streaming, 20, 1, true), ['u2', 'a2', 'tool2'])
  assert.deepEqual(exports.liveTailKeys(streaming), ['u2', 'a2', 'tool2'])
})

test('covers the canvas until it reports ready so switching tabs never flashes', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const mount = source.slice(source.indexOf('function SynapseMapView'), source.indexOf('// Invisible header resident'))

  // A veil in the canvas colour hides the unstyled first paint and the frame's
  // own sidebar/tab strip until the canvas is laid out.
  assert.match(source, /\.dsh-synapse-veil\{position:absolute;inset:0;z-index:2/)
  assert.match(source, /\.dsh-synapse-veil\.dsh-synapse-veil-hidden\{opacity:0;pointer-events:none\}/)
  assert.match(mount, /dsh-synapse-veil/)
  // Revealed on map-ready, with a timer so it can never stay hidden.
  assert.match(source, /'synapse:map-ready'\) return revealFrame\(\)/)
  assert.match(mount, /revealTimer = window\.setTimeout\(revealFrame, 1500\)/)
  assert.match(mount, /window\.clearTimeout\(revealTimer\)/)
  // map-opened is posted from the element: a cached frame can finish loading
  // before the effect assigns `frame`, which would leave the canvas unready.
  assert.match(mount, /const element = event\.currentTarget/)
  assert.match(mount, /element\?\.contentWindow\?\.postMessage/)
  assert.doesNotMatch(mount, /send\('synapse:map-opened'\)/)
})

test('hides the in-canvas sidebar by injecting a style into the map frame', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

  // The frame only lives while the map tab is active, so the sidebar is hidden
  // unconditionally instead of toggling host chrome.
  assert.match(source, /CANVAS_STYLE = '\.sidebar\{display:none !important\}\.view-switch\{display:none !important\}\.canvas-tabs\{display:none !important\}\.synapse-shell\{--sidebar-width:0px !important\}'/)
  // Footer 详情 opens the host turn pane, so the injected style must not hide it.
  assert.doesNotMatch(source, /CANVAS_STYLE = [^']*data-action="watch-turn"/)
  assert.doesNotMatch(source, /CANVAS_STYLE = [^']*data-action="show-thread"/)
  assert.doesNotMatch(source, /CANVAS_STYLE = [^']*data-action="open-dsh"/)
  // Injected into the frame document (same origin) rather than patching the
  // upstream app.js/styles.css, and guarded against duplicate injection.
  assert.match(source, /injectCanvasStyle\(element\?\.contentDocument\)/)
  assert.match(source, /const injectCanvasStyle = doc =>/)
  assert.match(source, /doc\.getElementById\(CANVAS_STYLE_ID\) !== null\) return/)
  assert.doesNotMatch(source, /\.sidebar\{display: none\}/)
  // The 整理/定位/缩放 controls must stay available, so the injected rule set
  // must never hide .canvas-controls.
  assert.doesNotMatch(source, /CANVAS_STYLE = [^']*canvas-controls/)
  assert.doesNotMatch(source, /CANVAS_STYLE = [^']*canvas-minimap/)
})

test('shows a bottom-right minimap with a live viewport locator', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8')

  assert.match(source, /function renderCanvasMinimap/)
  assert.match(source, /function syncCanvasMinimap/)
  assert.match(source, /function centerCameraOnWorld/)
  assert.match(source, /class="canvas-minimap/)
  assert.match(source, /canvas-minimap-view/)
  assert.match(source, /data-minimap-card/)
  // The locator tracks pan/zoom without rebuilding the canvas.
  assert.match(source, /function applyCanvasTransform[\s\S]*syncCanvasMinimap\(\)/)
  assert.match(source, /installCanvasMinimap\(\)/)
  // Dragging a card updates its thumbnail in place.
  assert.match(source, /syncMinimapCardPosition\(cardId, position\)/)
  // Clicking the thumbnail recenters the camera on that world point.
  assert.match(source, /minimapUnproject\(map, local\.x, local\.y\)/)
  assert.match(source, /centerCameraOnWorld\(world\.x, world\.y\)/)
  // Inspector open: shift left so the thumbnail is not covered.
  assert.match(source, /beside-inspector/)
  assert.match(css, /\.canvas-minimap \{[^}]*right: 16px; bottom: 16px/)
  assert.match(css, /\.canvas-minimap-view \{/)
  assert.match(css, /\.canvas-minimap\.beside-inspector \{/)

  const start = source.indexOf('function canvasWorldExtents')
  const end = source.indexOf('function visibleWorldRect')
  assert.ok(start !== -1 && end > start)
  const exports = {}
  const bounds = source.slice(source.indexOf('function canvasNodeBounds'), source.indexOf('function connectorPath('))
  new Function('exports', `const CARD_WIDTH = 310; const CARD_HEIGHT = 276; const MINIMAP_WIDTH = 176; const MINIMAP_HEIGHT = 118; const MINIMAP_INSET = 6; const state = { draft: null }; function draftPlacement() { return null }\n${bounds}\n${source.slice(start, end)}\nexports.canvasWorldExtents = canvasWorldExtents\nexports.minimapProjection = minimapProjection\nexports.minimapProject = minimapProject\nexports.minimapUnproject = minimapUnproject`)(exports)
  const cards = [{ position: { x: 0, y: 0 } }, { position: { x: 365, y: 0 } }]
  const map = exports.minimapProjection(cards)
  const a = exports.minimapProject(map, 0, 0)
  const back = exports.minimapUnproject(map, a.x, a.y)
  assert.ok(Math.abs(back.x) < 0.001)
  assert.ok(Math.abs(back.y) < 0.001)
  const world = exports.canvasWorldExtents(cards)
  assert.ok(world.w > 365)
  assert.ok(world.h > 0)
})

test('pans the canvas with the wheel and zooms only on ctrl/meta', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const pan = source.slice(source.indexOf('const CANVAS_TWEAKS_SCRIPT'), source.indexOf('const injectCanvasStyle'))
  const wheel = app.slice(app.indexOf("app.addEventListener('wheel'"), app.indexOf('// Track pointer-down'))

  // The wheel PANS, it does not zoom: scrolling moves the view like any
  // scrollable surface. Zooming is ctrl/meta + wheel (pinch) and the buttons.
  assert.match(wheel, /addEventListener\('wheel'/)
  assert.match(wheel, /state\.canvasCamera = \{ x: state\.canvasCamera\.x - dx, y: state\.canvasCamera\.y - dy \}/)
  assert.match(wheel, /applyCanvasTransform\(\)/)
  // No zoom on a plain wheel: zoomCanvas is gone from the wheel handler.
  assert.doesNotMatch(wheel, /zoomCanvas\(viewport, state\.zoom \+/)
  // Shift + wheel is the conventional horizontal scroll for a single-wheel
  // mouse, so it maps the vertical delta onto the X axis.
  assert.match(wheel, /event\.shiftKey === true && event\.deltaX === 0/)
  // A card whose answer overflows still scrolls itself natively; a short card
  // no longer swallows the wheel but falls through to panning the canvas.
  assert.match(wheel, /answer\.scrollHeight > answer\.clientHeight/)
  assert.doesNotMatch(wheel, /A card with no scrollable answer swallows the wheel/)

  // A trackpad pinch is a wheel event with ctrlKey set. It must be handled
  // BEFORE the pan branch: its deltas are only a few pixels, so panning with
  // them would nudge the canvas imperceptibly and read as "pinch does nothing".
  assert.match(wheel, /if \(event\.ctrlKey === true \|\| event\.metaKey === true\)/)
  assert.match(wheel, /zoomCanvas\(viewport, state\.zoom \* Math\.exp\(-event\.deltaY \* 0\.01\), event\.clientX, event\.clientY\)/)
  // The pinch branch precedes the pan branch, or the pan would claim it first.
  assert.ok(wheel.indexOf('ctrlKey === true') < wheel.indexOf('state.canvasCamera = { x: state.canvasCamera.x - dx'),
    'pinch must be handled before the pan branch')
  // The injected script no longer touches the wheel at all: it would run in
  // the capture phase and zoom a second time on top of app.js.
  assert.doesNotMatch(pan, /addEventListener\('wheel'/)
  // The pinch keeps the wide 0.2-8 range, which now lives in app.js so the
  // range applies whether or not the injection ran.
  assert.match(app, /const MIN_ZOOM = 0\.2/)
  assert.match(app, /const MAX_ZOOM = 2/)
  // The anti-blur fix lives with zoomCanvas in app.js.
  assert.match(app, /content\.style\.willChange = 'auto'/)
  // The +/- buttons and the readout still zoom (to the centre / reset 100%).
  assert.match(pan, /target\.tagName === 'SPAN'/)
  assert.match(pan, /zoomAtCenter\(1\)/)
  assert.match(pan, /data-action="zoom-in"\], \[data-action="zoom-out"\]/)
  assert.match(pan, /var fitToWindow = function/)
  assert.match(pan, /var ensureFitButton = function/)
  // The pinch is not gated on panels: the card inspector has no native pinch
  // behaviour to preserve, so zooming there is the expected result.
  assert.match(app, /if \(event\.ctrlKey === true \|\| event\.metaKey === true\) \{[\s\S]{0,260}zoomCanvas/)
  // The pan script guards against running twice and against a missing state.
  assert.match(pan, /window\.__dshSynapsePanInstalled === true\) return/)
  assert.match(pan, /typeof state === 'undefined'/)
  // The hand is a temporary gesture only: the default cursor is the mouse.
  assert.match(pan, /\.canvas-viewport, \.canvas-viewport\.is-panning \{ cursor: default !important; \}/)
  assert.doesNotMatch(pan, /HAND_KEY/)
  assert.doesNotMatch(pan, /handCursor/)
})

test('ships the mouse pointer as the canvas cursor in styles.css itself', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8')
  const viewport = css.match(/\.canvas-viewport \{[^}]*\}/)?.[0] ?? ''
  const panning = css.match(/\.canvas-viewport\.is-panning \{[^}]*\}/)?.[0] ?? ''

  // The stylesheet is the base of truth: relying on the injected script alone
  // left a grab hand on the canvas whenever that injection did not apply.
  assert.match(viewport, /cursor: default/, 'base canvas cursor is the mouse')
  assert.doesNotMatch(viewport, /cursor:\s*url\(/, 'no custom hand cursor image')
  assert.doesNotMatch(viewport, /grab/)
  assert.match(panning, /cursor: default/)
  assert.doesNotMatch(panning, /grab/)
  // The panning rule keeps suppressing text selection; only its cursor changed.
  assert.match(panning, /user-select: none/)
})

test('holds space for the hand mode and pans from anywhere while held', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const pan = source.slice(source.indexOf('const CANVAS_TWEAKS_SCRIPT'), source.indexOf('const injectCanvasStyle'))

  // Space switches the cursor to a grab hand, released on keyup (and on blur,
  // so the mode cannot get stuck after the window loses focus).
  assert.match(pan, /event\.code === 'Space'/)
  assert.match(pan, /synapse-space-pan/)
  assert.match(pan, /\.synapse-space-pan \.canvas-viewport \{ cursor: grab !important; \}/)
  assert.match(pan, /\.synapse-space-dragging \.canvas-viewport, \.synapse-space-dragging \.canvas-viewport \* \{ cursor: grabbing !important; \}/)
  assert.match(pan, /window\.addEventListener\('keyup'/)
  assert.match(pan, /window\.addEventListener\('blur'/)
  // The classes live on #app, not on .canvas-viewport: render() rebuilds
  // app.innerHTML, so a viewport class is destroyed mid-gesture whenever the
  // canvas re-renders (a live reply landing), losing the hand while space is
  // still held. #app survives, and the classes are re-asserted from the held
  // booleans rather than toggled on a cached element.
  assert.match(pan, /var rootOf = function/)
  assert.match(pan, /document\.getElementById\('app'\)/)
  assert.match(pan, /root\.classList\.toggle\('synapse-space-pan', spaceHeld === true\)/)
  assert.match(pan, /root\.classList\.toggle\('synapse-space-dragging', spaceHeld === true && spaceDragging === true\)/)
  assert.doesNotMatch(pan, /viewport\.classList\.add\('synapse-space-dragging'\)/)
  // Focus stays on the host page after switching tabs, so the host forwards
  // space into the frame; the frame also handles it when it holds focus.
  assert.match(source, /type: 'synapse:space-pan'/)
  assert.match(source, /const onSpaceDown = event =>/)
  assert.match(source, /const onSpaceUp = event =>/)
  assert.match(source, /window\.addEventListener\('keydown', onSpaceDown\)/)
  assert.match(source, /window\.removeEventListener\('keyup', onSpaceUp\)/)
  // Typing must keep a real space, and space must not scroll the page.
  assert.match(pan, /var isEditable = function/)
  assert.match(pan, /isEditable\(event\.target\) === true\) return/)
  assert.match(pan, /event\.preventDefault\(\)/)
  // While held, a drag pans the canvas even when it starts over a card.
  assert.match(pan, /if \(spaceHeld !== true\) return/)
  assert.match(pan, /viewport\.contains\(target\) !== true\) return/)
  assert.match(pan, /event\.stopPropagation\(\)/)
  assert.match(pan, /origin\.camera\.x \+ moveEvent\.clientX - origin\.x/)
})

test('rewrites user-facing DSH copy to 会话 without touching code', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

  // The rewrite runs over rendered text and label attributes only.
  assert.match(source, /var replaceCopy = function \(root\)/)
  assert.match(source, /LABEL_ATTRIBUTES = \['title', 'aria-label', 'placeholder'\]/)
  assert.match(source, /replace\(\/DSH\/g, '会话'\)/)
  // Script and style contents are skipped so no executable code is rewritten.
  assert.match(source, /if \(tag === 'SCRIPT' \|\| tag === 'STYLE'\) return NodeFilter\.FILTER_REJECT/)
  // Re-applied as the canvas re-renders, and coalesced to one frame.
  assert.match(source, /new MutationObserver\(scheduleCopy\)/)
  assert.match(source, /window\.requestAnimationFrame\(function \(\) \{\n      copyScheduled = false/)
  // Internal identifiers must keep their dsh prefix (only copy is rewritten).
  assert.ok(source.indexOf('.dsh-codex-nav-rail') !== -1)
  assert.ok(source.indexOf("CHROME_HIDE_CLASS = 'dsh-synapse-chrome-hidden'") !== -1)
  assert.ok(source.indexOf("id: 'dsh-ungrouped'") !== -1)
})

test('renders a card turn with the dsh-codex side-chat look', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

  // The stylesheet mirrors codex's side-chat rules so the rendering matches.
  // It is injected on the HOST (the pane lives next to the iframe, not in it).
  assert.match(source, /const SIDECHAT_TURN_CSS = \[/)
  assert.ok(source.indexOf('.dsh-codex-sidechat-transcript {') !== -1)
  assert.ok(source.indexOf('.dsh-codex-sidechat-user-bubble {') !== -1)
  assert.ok(source.indexOf('.dsh-codex-sidechat-md-body {') !== -1)
  assert.ok(source.indexOf('.dsh-codex-sidechat-toolrow-summary {') !== -1)
  assert.match(source, /SIDECHAT_TURN_CSS,/)
  assert.match(source, /className: 'dsh-synapse-turn-pane'/)
  assert.match(source, /has-turn-pane/)
  // Tool/think rows render a leading icon (primitives when present, else SVG).
  assert.match(source, /const toolIcon = /)
  assert.match(source, /dsh-codex-sidechat-toolrow-leading/)
  assert.match(source, /primitiveIcon\('IconSearchOutline16'\)/)
  assert.match(source, /FALLBACK_ICON/)
  // The pane is pinned to the right edge and the iframe explicitly reserves
  // its width, so a host slot reflow cannot push the pane below the map or
  // collapse the iframe.
  assert.match(source, /\.dsh-synapse-view\{[^}]*position:relative;[^}]*display:flex/)
  assert.match(source, /\.dsh-synapse-view\.has-turn-pane \.dsh-synapse-frame\{[^}]*width:calc\(100% - min\(460px,42%\)\)/)
  assert.match(source, /\.dsh-synapse-turn-pane\{[^}]*position:absolute;inset:0 0 0 auto/)
  assert.match(source, /\.dsh-synapse-turn-pane\{[^}]*width:min\(460px,42%\)/)
  assert.match(source, /\.dsh-synapse-turn-pane\{[^}]*height:100%;[^}]*overflow:hidden/)
  assert.match(source, /\.dsh-synapse-turn-pane \.dsh-codex-sidechat-transcript\{[^}]*overflow-y:auto/)
  assert.match(source, /transcriptRef/)
  assert.match(source, /scrollTopRef/)
  assert.match(source, /scrollTopRef\.current = node\.scrollTop/)
  assert.match(source, /followTailRef\.current = node\.scrollHeight - node\.clientHeight - node\.scrollTop < 48/)

  // One turn is sliced from the live session chat — the same nodes side-chat
  // renders — not from Synapse's projected messages.
  assert.match(source, /const sliceTurnNodes = /)
  assert.match(source, /function ChatNodeView/)
  assert.match(source, /case 'assistant-step'/)
  assert.match(source, /case 'tool-call'/)
  assert.match(source, /block\.kind === 'reasoning'/)
  assert.match(source, /TOOL_VARIANTS = \{ bash: 'bash'/)
  assert.match(source, /TOOL_TITLES = \{ search: 'Search'/)
  assert.ok(source.indexOf('dsh-codex-sidechat-turn-status') !== -1)
  assert.ok(source.indexOf('dsh-codex-sidechat-empty') !== -1)
  // The iframe no longer rebinds renderThread: that path never saw live nodes.
  assert.doesNotMatch(source, /var originalRenderThread = window\.renderThread/)
  assert.doesNotMatch(source, /renderTurnView\(card\)/)
})

test('leaves conversation-family scoping to the canvas runtime', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const pan = source.slice(source.indexOf('const CANVAS_TWEAKS_SCRIPT'), source.indexOf('const injectCanvasStyle'))

  // app.js scopes through visibleThreads(): it needs the ancestor and sibling
  // threads to build the current fork family. A client-side wrapper that calls
  // conversationCards([current]) destroys that tree before layout sees it.
  assert.doesNotMatch(pan, /originalConversationCards/)
  assert.doesNotMatch(pan, /window\.conversationCards\s*=/)
  assert.doesNotMatch(pan, /conversationCards\(\[current\]\)/)
})

test('hides the host message rail and side panels only while the map view is mounted', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const mount = source.slice(source.indexOf('function SynapseMapView'), source.indexOf('// Invisible header resident'))

  // The codex rail and right-side panels are host chrome that would overlay
  // the canvas; they are hidden for the lifetime of the map view only.
  assert.match(source, /CHROME_HIDE_SELECTORS = \['\.dsh-codex-nav-rail', '\.dsh-side-panels', '\.dsh-side-panels-launcher', '\[data-width-handle\]'\]/)
  // DSH's composer dock is removed outright (display:none) so the canvas keeps
  // its space; the codex panels only go invisible to preserve their layout.
  assert.match(source, /COMPOSER_HIDE_SELECTORS = \['\[data-composer-seat\]'\]/)
  assert.match(source, /\.dsh-synapse-composer-hidden\{display:none !important\}/)
  assert.match(mount, /setChromeHidden\(true\)/)
  assert.match(mount, /setChromeHidden\(false\)/)
  assert.match(mount, /chromeObserver\.observe\(document\.body/)
  assert.match(mount, /chromeObserver\.disconnect\(\)/)
  // Hiding must not remove inline styles those panels own (width/position).
  assert.doesNotMatch(source, /removeAttribute\('style'\)/)
  assert.match(source, /\.dsh-synapse-chrome-hidden\{visibility:hidden !important;pointer-events:none !important\}/)
  assert.match(source, /body:has\(\.dsh-synapse-view\) \[data-width-handle\]/)
})

test('the card inspector scrolls its body instead of clipping it', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8')
  const scroll = css.match(/\.card-inspector-scroll \{[^}]*\}/)?.[0] ?? ''

  // The scroll container is a BLOCK, not a flex column: as flex items the
  // answer's children default to flex-shrink:1, so a long <pre> or a wide
  // table compresses rather than overflows -- no scrollbar, clipped content.
  assert.match(scroll, /display: block/)
  assert.doesNotMatch(scroll, /display: flex/)
  assert.doesNotMatch(scroll, /flex-direction: column/)
  // It still fills the space between the head and the footer, and scrolls.
  assert.match(scroll, /flex: 1/)
  assert.match(scroll, /min-height: 0/)
  assert.match(scroll, /overflow-y: auto/)
  assert.match(scroll, /overscroll-behavior: contain/)
  assert.match(scroll, /overflow-anchor: none/)
  // A visible scrollbar: thin, and styled in WebKit.
  assert.match(scroll, /scrollbar-width: thin/)
  assert.match(css, /\.card-inspector-scroll::-webkit-scrollbar-thumb/)
  // The inspector itself is a bounded column so the body is the scroller.
  const inspector = css.match(/\.card-inspector \{[^}]*\}/)?.[0] ?? ''
  assert.match(inspector, /display: flex/)
  assert.match(inspector, /flex-direction: column/)
  assert.match(inspector, /bottom: 0/)
})

test('reclaims the side panel width so the map is not squeezed', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

  // Hiding the panel with visibility leaves its layout box: dsh-codex squeezes
  // #root with margin-right: var(--dsh-side-panels-width), so the map would sit
  // in a narrower box beside an empty strip. Zeroing the variable reclaims it.
  assert.match(source, /SIDE_PANELS_WIDTH_VAR = '--dsh-side-panels-width'/)
  assert.match(source, /root\.style\.setProperty\(SIDE_PANELS_WIDTH_VAR, '0px'\)/)
  // The previous width is captured so leaving the map restores the panel.
  assert.match(source, /savedSidePanelsWidth = document\.documentElement\.style\.getPropertyValue\(SIDE_PANELS_WIDTH_VAR\)/)
  assert.match(source, /root\.style\.setProperty\(SIDE_PANELS_WIDTH_VAR, savedSidePanelsWidth \?\? '0px'\)/)
  // The capture is guarded to once: the MutationObserver re-asserts the hide on
  // every DOM change, and saving again would record the already-zeroed value
  // and collapse the panel permanently on exit.
  assert.match(source, /if \(savedSidePanelsWidth === null\) \{/)
})

test('opens a prefilled follow-up draft from selected answer text', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const selection = source.slice(source.indexOf('function selectionFollowupTarget'), source.indexOf("app.addEventListener('pointerdown', event => {"))
  const click = source.slice(source.indexOf("if (button.dataset.action === 'follow-selection')"), source.indexOf("if (button.dataset.action === 'close')"))

  assert.match(source, /class="selection-followup"/)
  assert.match(selection, /\.thread-answer/)
  assert.match(selection, /\.message-assistant \.message-body/)
  assert.match(selection, /text === '' \|\| text\.length > 4000/)
  assert.match(selection, /text\.length > 4000/)
  assert.match(click, /openContinue\(thread, undefined, followup\.text\)/)
  assert.match(source, /state\.draft = \{ kind: 'continue', parentId: parent\.id, anchorId, text, sending: false \}/)
})

test('renders editable quick phrases in follow-up and branch drafts', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8')

  assert.match(source, /DEFAULT_QUICK_PHRASES = \['展开说明', '举例', '通俗易懂', '对比解释'\]/)
  assert.match(source, /QUICK_PHRASES_KEY/)
  assert.match(source, /data-action="insert-quick-phrase"/)
  assert.match(source, /data-action="open-quick-phrase-editor"/)
  assert.match(source, /data-action="remove-quick-phrase"/)
  assert.match(source, /function insertQuickPhrase/)
  assert.match(source, /persistQuickPhrases\(\)/)
  assert.match(styles, /\.draft-quick-phrases/)
  assert.match(styles, /\[data-theme="dark"\] \.draft-quick-phrase/)
})

test('caches markdown rendering and patches the live card without a full render', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const live = source.slice(source.indexOf('function scheduleLiveCardUpdate'), source.indexOf('async function pollProjection'))

  assert.match(source, /const markdownCache = new Map\(\)/)
  assert.match(source, /MARKDOWN_CACHE_LIMIT/)
  assert.match(source, /function scheduleLiveCardUpdate/)
  assert.match(live, /function applyLiveReplyToCard/)
  assert.match(live, /requestAnimationFrame/)
})

test('renders a follow-up plus on final cards and a branch control on any settled card', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const card = source.slice(source.indexOf('function conversationCard'), source.indexOf('function draftActions'))

  assert.match(card, /class="graph-continue-button"/)
  assert.match(card, /data-action="open-continue"/)
  assert.match(card, /aria-label="添加追问"/)
  assert.match(card, /childCount === 0 \|\| card\.canContinue === true \? ''/)
  assert.match(card, /class="graph-fold-button/)
  assert.match(card, /data-action="toggle-card-children"/)
  assert.match(card, /aria-expanded=/)
  assert.match(card, /M3\.5 8h9/)
  assert.match(card, /M8 3\.5v9/)
  // v5: the card's branch control reads the turn's settled answer seq, which
  // the store now records directly, falling back to the assistant message seq.
  assert.match(card, /const branchSeq = resolvedState !== 'done' \? null : Number\.isSafeInteger\(card\.answerSeq\)/)
  assert.match(card, /const branchButton = branchSeq === null \? ''/)
  assert.match(card, /class="graph-branch-button"/)
  assert.match(card, /aria-label="在新对话中分支"/)
  assert.match(card, /M13\.0762 1\.37207C14\.0846/)
  assert.doesNotMatch(card, />追问<\/button>/)
  assert.doesNotMatch(card, />分支<\/button>/)
  assert.doesNotMatch(card, /class="branch-button"/)
})

test('positions the latest plus at the connector and the branch icon below the fold control', async () => {
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8')

  assert.match(styles, /\.graph-continue-button, \.graph-fold-button \{ top: 50%; transform: translateY\(-50%\); \}/)
  assert.match(styles, /\.graph-branch-button \{ top: calc\(50% \+ 30px\); transform: translateY\(-50%\); \}/)
  assert.match(styles, /\.graph-continue-button svg, \.graph-fold-button svg, \.graph-branch-button svg/)
  assert.match(styles, /\[data-theme="dark"\] \.graph-continue-button, \[data-theme="dark"\] \.graph-fold-button, \[data-theme="dark"\] \.graph-branch-button/)
})

test('renders the canvas itself instead of an empty-state page', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8')
  const canvas = source.slice(source.indexOf('function renderCanvas'), source.indexOf('function processRecords'))

  // No empty state anywhere: a workspace without conversations shows the
  // empty, pannable canvas (with its controls), not a placeholder page.
  assert.doesNotMatch(canvas, /empty-canvas/)
  assert.doesNotMatch(styles, /empty-canvas/)
  assert.match(canvas, /const allCards = conversationCards\(threads\)/)
  // The chrome condition must not hide the controls on an empty canvas.
  assert.match(source, /const showCanvasChrome = state\.mode === 'canvas'/)
})

test('every class interpolated into a card class list is defined', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  // `outsideFamily` was interpolated into the card markup without ever being
  // declared, so EVERY card render threw ReferenceError and the canvas went
  // blank. Guard against the regression.
  assert.doesNotMatch(source, /outsideFamily/)
})

test('persists graph collapse choices and renders connectors from visible cards only', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const canvas = source.slice(source.indexOf('function renderCanvas'), source.indexOf('function processRecords'))
  const toggle = source.slice(source.indexOf("button.dataset.action === 'toggle-card-children'"), source.indexOf("button.dataset.action === 'open-continue'"))

  assert.match(source, /COLLAPSED_CARDS_KEY/)
  assert.match(source, /localStorage\.setItem\(COLLAPSED_CARDS_KEY/)
  assert.match(canvas, /const graph = conversationGraphView\(allCards\)/)
  assert.match(canvas, /const cards = graph\.cards/)
  assert.match(source, /function connectorLinkBox/)
  assert.match(source, /class="connector-link"/)
  assert.match(canvas, /canvasConnectors\(cards\)/)
  assert.match(toggle, /state\.collapsedCardIds\.(?:has|delete|add)/)
  assert.match(toggle, /persistCollapsedCards\(\)/)
})

test('identifies when an anchored draft has no visible parent card', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const placement = source.slice(source.indexOf('function draftPlacement'), source.indexOf('function draftCard'))

  assert.match(placement, /draft\.anchorId === undefined/)
  assert.match(placement, /cards\.find\(card => card\.id === draft\.anchorId\)/)
  assert.match(placement, /if \(parent === undefined\) return null/)
})

test('places a branch draft on the lane the branch card will occupy', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const placement = source.slice(source.indexOf('function draftPlacement'), source.indexOf('function draftCard'))

  // A branch card lands on its own lane BELOW the parent; the draft must
  // anticipate that or the card visibly jumps down on submit. A continue
  // draft stays on the parent's lane, one step right.
  assert.match(placement, /draft\.kind === 'branch'/)
  assert.match(placement, /parent\.position\.y \+ CARD_HEIGHT \+ CARD_GAP_Y/)
})

test('prevents collapse from hiding drafts or the active conversation and restores focus', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const toggle = source.slice(source.indexOf("button.dataset.action === 'toggle-card-children'"), source.indexOf("button.dataset.action === 'open-continue'"))

  assert.match(toggle, /const visibleCards = conversationGraphView\(allCards, nextCollapsed\)\.cards/)
  assert.match(toggle, /draftPlacement\(allCards\)\?\.parent\.id/)
  assert.match(toggle, /请先完成或取消正在编辑的追问或分支/)
  assert.match(toggle, /当前会话位于这个后续分支中/)
  assert.match(toggle, /window\.setTimeout/)
  assert.match(toggle, /\.focus\(\)/)
})

test('reveals hidden ancestor paths when a conversation becomes current', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const reveal = source.slice(source.indexOf('function revealConversationThread'), source.indexOf('function canvasConnectors'))
  const current = source.slice(source.indexOf("data.type === 'synapse:current-session'"), source.indexOf("data.type === 'synapse:live-reply'"))

  assert.match(reveal, /state\.collapsedCardIds\.delete\(parentId\)/)
  assert.match(reveal, /persistCollapsedCards\(\)/)
  assert.match(current, /revealConversationThread\(conversationCards\(visibleThreads\(\)\), thread\.id\)/)
})

test('scopes the canvas to the current session family (ancestors + every fork)', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const scope = source.slice(source.indexOf('function threadFamily'), source.indexOf('function workspaceChoices'))
  const canvas = source.slice(source.indexOf('function renderCanvas'), source.indexOf('function processRecords'))

  assert.match(scope, /function threadFamily/)
  assert.match(scope, /threadFamily\(threads, anchor\)/)
  // Without a current session, or before it is projected, keep the workspace
  // instead of emptying the canvas.
  assert.match(scope, /if \(anchor === undefined\) return threads/)
  assert.match(canvas, /const threads = visibleThreads\(\)/)
  assert.doesNotMatch(canvas, /const threads = state\.workspace\?\.threads \?\? \[\]/)
  const others = source.match(/conversationCards\(state\.workspace\.threads\)/g) ?? []
  assert.equal(others.length, 0, 'no graph call may bypass visibleThreads()')

  const start = source.indexOf('function threadFamily')
  const end = source.indexOf('function visibleThreads')
  assert.ok(start !== -1 && end > start)
  const exports = {}
  new Function('exports', `${source.slice(start, end)}\nexports.threadFamily = threadFamily`)(exports)
  const threads = [
    { id: 'root', parentId: null, dshSessionId: 's-root' },
    { id: 'child', parentId: 'root', dshSessionId: 's-child' },
    { id: 'cousin', parentId: 'root', dshSessionId: 's-cousin' },
    { id: 'other', parentId: null, dshSessionId: 's-other' },
  ]
  // The family is the whole branch tree: ancestors AND every fork taken from
  // any of them. Sibling forks (the cousin) belong to the picture — a branch
  // map that hid them could not show where a conversation forked.
  assert.deepEqual(exports.threadFamily(threads, threads[1]).map(thread => thread.id), ['root', 'child', 'cousin'])
  assert.deepEqual(exports.threadFamily(threads, threads[0]).map(thread => thread.id), ['root', 'child', 'cousin'])
  assert.deepEqual(exports.threadFamily(threads, threads[3]).map(thread => thread.id), ['other'])
  assert.deepEqual(exports.threadFamily(threads, undefined), [])
  // Descendants at ANY depth: a grandchild is part of the conversation.
  const deep = [
    { id: 'root', parentId: null, dshSessionId: 's-root' },
    { id: 'child', parentId: 'root', dshSessionId: 's-child' },
    { id: 'grand', parentId: 'child', dshSessionId: 's-grand' },
    { id: 'other', parentId: null, dshSessionId: 's-other' },
  ]
  assert.deepEqual(exports.threadFamily(deep, deep[0]).map(thread => thread.id), ['root', 'child', 'grand'])
  // Anchoring on the grandchild walks the whole ancestor chain back up.
  assert.deepEqual(exports.threadFamily(deep, deep[2]).map(thread => thread.id), ['root', 'child', 'grand'])
  // A fork whose Synapse parent node is missing still links through DSH's own
  // recorded parent session — the case that used to leave it an orphan root.
  const orphan = [
    { id: 'child', parentId: null, dshSessionId: 's-child', sourceParentSessionId: 's-root' },
    { id: 'root', parentId: null, dshSessionId: 's-root' },
    { id: 'other', parentId: null, dshSessionId: 's-other' },
  ]
  assert.deepEqual(exports.threadFamily(orphan, orphan[0]).map(thread => thread.id), ['child', 'root'])
  assert.deepEqual(exports.threadFamily(orphan, orphan[1]).map(thread => thread.id), ['child', 'root'])
  // A dangling parent id must not throw or pull in unrelated sessions.
  const dangling = [
    { id: 'child', parentId: 'gone', dshSessionId: 's-child' },
    { id: 'other', parentId: null, dshSessionId: 's-other' },
  ]
  assert.deepEqual(exports.threadFamily(dangling, dangling[0]).map(thread => thread.id), ['child'])
})

test('visibleThreads draws the whole family and keeps the active branch in it', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const helperSlice = source.slice(source.indexOf('function currentDshWorkspace'), source.indexOf('function threadFamily'))
  const scopeSlice = source.slice(source.indexOf('function threadFamily'), source.indexOf('function workspaceChoices'))
  const threads = [
    { id: 'root', parentId: null, dshSessionId: 's-root' },
    { id: 'child', parentId: 'root', dshSessionId: 's-child' },
    { id: 'fork', parentId: 'root', dshSessionId: 's-fork' },
    { id: 'other', parentId: null, dshSessionId: 's-other' },
  ]
  const vmModule = await import('node:vm')
  const sandbox = { state: { currentDsh: { id: 's-child' }, activeId: 'fork', workspace: { threads } } }
  vmModule.createContext(sandbox)
  vmModule.runInContext(`${helperSlice}\n${scopeSlice}\nglobalThis.visibleThreads = visibleThreads`, sandbox)
  // Anchored on the current session (child): its family is root + every fork
  // of root — INCLUDING the sibling fork the user is watching. Only the
  // unrelated session stays off the canvas.
  assert.equal(sandbox.visibleThreads().map(thread => thread.id).join(','), 'root,child,fork')
  // Same result without an active selection: the family does not depend on it.
  sandbox.state.activeId = null
  assert.equal(sandbox.visibleThreads().map(thread => thread.id).join(','), 'root,child,fork')
  // With no anchor at all, keep the workspace instead of blanking the canvas.
  sandbox.state.currentDsh = null
  assert.equal(sandbox.visibleThreads().length, 4)
})

test('keeps a just-forked child on the map without switching the host session', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const submit = source.slice(source.indexOf('async function submitDraft'), source.indexOf('function threadsById'))
  const load = source.slice(source.indexOf('async function threadsForDshWorkspace'), source.indexOf('async function openDshWorkspace'))

  assert.match(load, /isWorkspaceThreadDescendant\(thread, loadedIds, loaded\)/)
  assert.match(source, /function keepLiveCanvasThreads/)
  assert.match(source, /keepLiveCanvasThreads\(fetched, nextWorkspaceId\)/)
  // The branch card must exist before the fork round-trips, so a slow or
  // failing RPC cannot leave the user staring at a canvas with no new card.
  assert.match(submit, /workspace\.threads\.push\(thread\)/)
  assert.match(submit, /revealThreadLatestCard\(thread\.id\)\s*\n\s*await runSubmission\(operation\)/)
  assert.match(submit, /revealConversationThread\(conversationCards\(visibleThreads\(\)\), thread\.id\)/)
  // The camera follows the new branch onto its lane: the layout parks it one
  // lane per earlier sibling subtree below its parent, which is off-screen in
  // a branch-heavy conversation ("点发送后画板上没有显示").
  assert.match(submit, /revealThreadLatestCard\(thread\.id\)/)
  assert.doesNotMatch(submit, /revealThreadLatestCard\(result\.thread\.id\)/)
  // The optimistic node keys its pending reply by THREAD id (it has no
  // session yet); the viewport cull must honor both keyings or the new card
  // is unmounted the moment it lands outside the viewport.
  assert.match(source, /state\.pendingReplies\.has\(thread\.dshSessionId\) \|\| state\.pendingReplies\.has\(thread\.id\)/)
  // The fork must NOT be activated: making it DSH's current session makes the
  // host leave the map for the conversation view, which is exactly what the
  // user is trying to avoid when branching from a card.
  assert.doesNotMatch(submit, /post\('synapse:activate-session', \{ sessionId: result\.thread\.dshSessionId \}\)/)
  // The branch still runs and streams: live replies are subscribed per listed
  // session in the host, so the map receives them without a session switch.
  assert.match(submit, /dshRpc\('synapse:send-message', \{ operationId: operation\.id, sessionId: operation\.sessionId, text: operation\.text \}\)/)
  const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(client, /syncLiveSessions/)
})

test('a session DSH no longer lists still draws its fork tree', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const start = source.indexOf('function isWorkspaceThreadDescendant')
  const end = source.indexOf('/**\n * Keep just-created branches')
  const fnSrc = source.slice(start, end)
  assert.ok(start !== -1 && end > start)
  const familySlice = source.slice(source.indexOf('function threadFamily'), source.indexOf('function visibleThreads'))
  const helperSlice = source.slice(source.indexOf('function selectedDshWorkspace'), source.indexOf('function threadFamily'))

  const threads = [
    { id: 'old', parentId: null, dshSessionId: 's-old' },
    { id: 'fork-1', parentId: 'old', dshSessionId: 's-f1' },
    { id: 'fork-2', parentId: 'old', dshSessionId: 's-f2' },
    { id: 'grandchild', parentId: 'fork-1', dshSessionId: 's-g' },
    { id: 'unrelated', parentId: null, dshSessionId: 's-other' },
  ]
  const state = { currentDsh: { id: 's-old' }, activeId: 'old', summaries: [{ id: 'w' }] }
  const sandbox = { state, workspaceGraph: async () => ({ threads }) }
  const vmModule = await import('node:vm')
  vmModule.createContext(sandbox)
  vmModule.runInContext(`${helperSlice}\n${familySlice}\n${fnSrc}\nglobalThis.threadsForDshWorkspace = threadsForDshWorkspace`, sandbox)

  // The current session is absent from DSH's live session list (the user
  // switched back to an older conversation). Its whole fork family must still
  // load, or the canvas renders "无会话" for the branch-heaviest sessions.
  const loaded = await sandbox.threadsForDshWorkspace({ sessionIds: ['s-other'] })
  const ids = Array.from(loaded, thread => thread.id).sort()
  // Cross-realm arrays from the vm sandbox fail deepStrictEqual on prototype,
  // so compare the plain id list.
  assert.equal(ids.join(','), ['fork-1', 'fork-2', 'grandchild', 'old', 'unrelated'].join(','))

  // An empty session list no longer short-circuits to a blank map either.
  const fromEmpty = await sandbox.threadsForDshWorkspace({ sessionIds: [] })
  assert.ok(Array.from(fromEmpty).some(thread => thread.id === 'old'), 'the current session survives an empty session list')
})

test('re-centers the camera when the current session replaces the canvas', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const current = source.slice(source.indexOf("data.type === 'synapse:current-session'"), source.indexOf("data.type === 'synapse:live-reply'"))

  // A switch swaps the whole canvas content, so the old camera would point at
  // empty space; reset unless the switch came from a card click in the map.
  assert.match(current, /resetCanvasCamera\(\)/)
  assert.match(current, /state\.mapCardSessionSwitches\.delete\(data\.session\?\.id\)/)
  assert.match(current, /focusActiveCard\(\)/)
  assert.match(current, /previous\?\.title !== data\.session\?\.title/)
  assert.doesNotMatch(current, /else if \(canReplaceView\(\)\) render\(\)/)
})

test('a session-list refresh no longer resets the map selection', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const current = source.slice(source.indexOf("data.type === 'synapse:current-session'"), source.indexOf("data.type === 'synapse:live-reply'"))
  const load = source.slice(source.indexOf('async function openDshWorkspace'), source.indexOf('async function openCurrentWorkspace'))

  // synapse:current-session arrives on every host session-list change (a fork
  // was created, a title changed). Only a real switch may move activeId —
  // otherwise the canvas scope jumps off a just-created branch, and the open
  // card inspector closes, on every refresh.
  assert.match(current, /if \(sessionSwitched\) \{\s*\n\s*const preserveSelectedCard = state\.activeId === thread\.id/)
  // The 1s poll reload takes the same care: an activeId that still resolves
  // in the reloaded workspace wins over the current session's thread.
  assert.match(load, /state\.activeId = state\.workspace\.threads\.some\(thread => thread\.id === state\.activeId\) \? state\.activeId : \(currentThread\?\.id/)
})

test('the workspace fallback follows the current session, not store order', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const summaries = source.slice(source.indexOf('async function refreshSummaries'), source.indexOf('async function openWorkspace'))

  // `state.summaries` is in store order, so summaries[0] is an unrelated
  // project (measured: e-pi, 3 threads). Opening it flashed a foreign
  // conversation onto the canvas and made the real session unresolvable —
  // which is exactly how a fork rendered as "just the one turn card".
  assert.doesNotMatch(summaries, /await openWorkspace\(state\.summaries\[0\]\.id\)/)
  // Instead the projection whose cwd matches the current session is opened.
  assert.match(summaries, /summary\.cwd === cwd/)
  assert.match(summaries, /await openWorkspace\(match\.id/)
})

test('currentDshWorkspace prefers the project workspace over the ungrouped bucket', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const start = source.indexOf('function currentDshWorkspace')
  const end = source.indexOf('function selectedDshWorkspace')
  assert.ok(start !== -1 && end > start)
  const exports = {}
  new Function('state', 'exports', `${source.slice(start, end)}\nexports.currentDshWorkspace = currentDshWorkspace`)({}, exports)
  const sessionId = 's-fork'
  const cwd = '/proj/spaces'
  const state = {
    currentDsh: { id: sessionId, cwd },
    dshWorkspaces: [
      { id: 'dsh-ungrouped', title: '未分组', path: null, sessionIds: [sessionId] },
      { id: 'ws-spaces', title: 'SPACES', path: cwd, sessionIds: [sessionId] },
    ],
  }
  // dsh-ungrouped is a mixed bucket spanning many projects; scoping the canvas
  // to it broke fork-family resolution. The cwd match must win.
  const picked = new Function('state', `${source.slice(start, end)}\nreturn currentDshWorkspace()`)(state)
  assert.equal(picked.id, 'ws-spaces')
  // …and when the session really is ungrouped, the bucket is still used.
  const onlyBucket = new Function('state', `${source.slice(start, end)}\nreturn currentDshWorkspace()`)({
    currentDsh: { id: sessionId, cwd: '/proj/spaces' },
    dshWorkspaces: [{ id: 'dsh-ungrouped', title: '未分组', path: null, sessionIds: [sessionId] }],
  })
  assert.equal(onlyBucket.id, 'dsh-ungrouped')
})

test('list ticks do not remount the canvas or pin the inspector to the top', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const workspaces = source.slice(source.indexOf("data.type === 'synapse:workspaces'"), source.indexOf("data.type === 'synapse:current-session'"))
  const open = source.slice(source.indexOf('async function openDshWorkspace'), source.indexOf('async function openCurrentWorkspace'))
  const render = source.slice(source.indexOf('function render() {'), source.indexOf('function renderPreservingDetailScroll'))
  const wheel = source.slice(source.indexOf("app.addEventListener('wheel'"), source.indexOf("app.addEventListener('click'"))
  const live = source.slice(source.indexOf('function applyLiveReplyToCard'), source.indexOf('function scheduleLiveRender'))

  assert.match(source, /function workspacesFingerprint/)
  assert.match(source, /function threadsLayoutFingerprint/)
  assert.match(source, /function nextLiveCardAnswer/)
  assert.match(source, /function rememberInspectorScroll/)
  assert.match(source, /function restoreInspectorScroll/)
  assert.match(workspaces, /if \(unchanged && state\.workspace !== null\) return/)
  assert.match(open, /sameLayout/)
  assert.match(open, /if \(!sameLayout \|\| contentChanged \|\| revealed\) state\.canvasDirty = true/)
  assert.match(open, /if \(renderAfter\) flushCanvasRefresh\(\)/)
  assert.doesNotMatch(render, /state\.inspectorScrollByCard\.set\(state\.inspectorCardId, inspector\.scrollTop\)/)
  assert.match(render, /restoreInspectorScroll\(inspectorScrollTop\)/)
  assert.match(source, /event\.target\.classList\.contains\('card-inspector-scroll'\)/)
  assert.match(wheel, /closest\('\.card-inspector'\)/)
  assert.match(live, /nextLiveCardAnswer\(/)
  assert.match(live, /answer\.scrollTop = scrollTop/)
})

test('does not ship a card archive action', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /archive-thread/)
  assert.doesNotMatch(source, /async function archiveThread/)
})

test('card actions keep single-card hiding in the footer without a rename button', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const helpers = source.slice(source.indexOf('function cardHideReason'), source.indexOf('function visibilityTargetMatches'))
  const actions = new Function('cardState', `${helpers}; return cardActions`)(() => 'done')
  for (const parentId of [null, 'parent', 'nested-parent']) {
    assert.deepEqual(actions({ id: 'card', parentId, visibilityTarget: {} }, null, null), [
      { action: 'hide-card', placement: 'footer', icon: 'hidden', text: '隐藏', label: '从地图隐藏', reason: null },
    ])
  }
  assert.deepEqual(actions({ blank: true }, null, null), [])
})

test('footer hiding keeps in-flight and draft guards', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const helpers = source.slice(source.indexOf('function cardHideReason'), source.indexOf('function visibilityTargetMatches'))
  const actions = new Function('cardState', `${helpers}; return cardActions`)((_card, status) => status ?? 'done')
  const card = { id: 'card', dshThreadId: 'thread', visibilityTarget: {} }
  const cases = [
    ...['creating', 'queued', 'running', 'needs-input'].map(status => [card, status, null]),
    [{ ...card, operationId: 'operation' }, 'failed', null],
    [card, null, { kind: 'continue', anchorId: 'card' }],
    [card, null, { kind: 'branch', anchorId: 'card' }],
    [{ ...card, isTail: true }, null, { kind: 'continue', parentId: 'thread' }],
    [{ ...card, visibilityTarget: undefined }, null, null],
  ]
  for (const args of cases) {
    const [hide] = actions(...args)
    assert.equal(hide.placement, 'footer')
    assert.equal(typeof hide.reason, 'string')
  }
  assert.equal(actions(card, null, { kind: 'branch', anchorId: 'another-card' })[0].reason, null)
})

test('a fork not yet on the DSH workspace list still loads through its parent session', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const start = source.indexOf('function isWorkspaceThreadDescendant')
  const end = source.indexOf('async function threadsForDshWorkspace')
  assert.ok(start !== -1 && end > start)
  const exports = {}
  new Function('exports', `${source.slice(start, end)}\nexports.isWorkspaceThreadDescendant = isWorkspaceThreadDescendant`)(exports)
  const loaded = [{ id: 'p', dshSessionId: 's-p' }]
  const loadedIds = new Set(['p'])
  assert.equal(exports.isWorkspaceThreadDescendant({ parentId: 'p' }, loadedIds, loaded), true)
  assert.equal(exports.isWorkspaceThreadDescendant({ parentId: null, sourceParentSessionId: 's-p' }, loadedIds, loaded), true)
  assert.equal(exports.isWorkspaceThreadDescendant({ parentId: null, sourceParentSessionId: 's-other' }, loadedIds, loaded), false)
  assert.equal(exports.isWorkspaceThreadDescendant({ parentId: null }, loadedIds, loaded), false)
})

test('a just-created branch connector box covers both cards and the curve', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const start = source.indexOf('function connectorLinkBox')
  const end = source.indexOf('function connectorLinkSvg')
  assert.ok(start !== -1 && end > start)
  const exports = {}
  new Function('CARD_WIDTH', 'CARD_HEIGHT', 'exports', `${source.slice(start, end)}\nexports.connectorLinkBox = connectorLinkBox`)(310, 276, exports)
  const parent = { x: 86, y: 82 }
  const branch = { x: 2000, y: 400 }
  const box = exports.connectorLinkBox(parent, branch)
  const fromX = parent.x + 310
  const fromY = parent.y + 276 / 2
  const toX = branch.x
  const toY = branch.y + 276 / 2
  assert.ok(box.left <= fromX && box.left + box.width >= fromX, 'box must include the parent exit')
  assert.ok(box.left <= toX && box.left + box.width >= toX, 'box must include the branch entry')
  assert.ok(box.top <= fromY && box.top + box.height >= fromY)
  assert.ok(box.top <= toY && box.top + box.height >= toY)
})
