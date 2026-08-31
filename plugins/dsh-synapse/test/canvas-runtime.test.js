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

test('selecting a session in the sidebar syncs the DSH current session', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const selectThread = source.slice(source.indexOf("button.dataset.action === 'select-thread'"), source.indexOf("button.dataset.action === 'show-thread'"))

  assert.match(selectThread, /synapse:activate-session/)
})

test('clicking a session card syncs the DSH current session', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const cardClick = source.slice(source.indexOf('if (!(button instanceof HTMLElement)) {'), source.indexOf("if (button.dataset.action === 'close')"))

  assert.match(cardClick, /post\('synapse:activate-session', \{ sessionId: thread\.dshSessionId \}\)/)
})

test('switching sessions from a map card keeps the current camera position', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const cardClick = source.slice(source.indexOf('if (!(button instanceof HTMLElement)) {'), source.indexOf("if (button.dataset.action === 'close')"))
  const currentSession = source.slice(source.indexOf("if (data.type === 'synapse:current-session')"), source.indexOf("if (data.type === 'synapse:live-reply'"))

  assert.match(cardClick, /mapCardSessionSwitches\.add\(thread\.dshSessionId\)/)
  assert.match(currentSession, /mapCardSessionSwitches\.delete\(data\.session\?\.id\)/)
  assert.match(currentSession, /openCurrentWorkspace\(\{ preserveCanvasCamera \}\)/)
  assert.match(currentSession, /if \(!preserveCanvasCamera\) focusActiveCard\(\)/)
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
  assert.match(cardClick, /state\.selectedCardId = cardId/)
  assert.match(selectThread, /state\.selectedCardId = null/)
  assert.match(styles, /\.connectors path\.active-connector \{ stroke: #3478f6; \}/)
  assert.match(styles, /\[data-theme="dark"\] \.connectors path\.active-connector \{ stroke: #5b8def; \}/)
  assert.doesNotMatch(styles, /\.thread-card\.active/)
})

test('opens the clicked card in a tool-aware detail inspector', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8')
  const cardClick = source.slice(source.indexOf('if (!(button instanceof HTMLElement)) {'), source.indexOf("if (button.dataset.action === 'close')"))
  const inspector = source.slice(source.indexOf('function messagesForCard'), source.indexOf('function renderThread'))

  assert.match(source, /inspectorCardId: null/)
  assert.match(source, /function openCardInspector/)
  assert.match(cardClick, /openCardInspector\(cardId\)/)
  assert.match(inspector, /function messagesForCard/)
  assert.match(inspector, /function inspectorProcessEntries/)
  assert.match(inspector, /processRecords\(process/)
  assert.doesNotMatch(inspector, /threadMessage\(thread, message\)/)
  assert.match(inspector, /class="card-inspector/)
  assert.match(inspector, /data-action="open-continue"/)
  assert.doesNotMatch(inspector, /完整对话/)
  assert.match(inspector, /<svg aria-hidden="true" viewBox="0 0 16 16">/)
  assert.match(inspector, /card\.canContinue === true/)
  assert.match(inspector, /card-inspector-error/)
  assert.match(source, /button\.dataset\.action === 'close-card-inspector'/)
  assert.match(source, /event\.key !== 'Escape'/)
  assert.match(source, /processCount/)
  assert.match(styles, /\.card-inspector \{ position: absolute/)
  assert.match(styles, /\.card-inspector\.is-opening, \.card-inspector\.is-closing/)
  assert.match(styles, /\.card-inspector-answer/)
  assert.doesNotMatch(styles, /\.card-inspector \{[^}]*box-shadow/)
  assert.match(styles, /\.card-inspector-actions button svg/)
  assert.doesNotMatch(styles, /\.card-inspector-head \{[^}]*border-bottom/)
  assert.match(styles, /\.card-inspector \{ top: auto; width: 100%/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(styles, /\.thread-meta \.card-process-count/)
})

test('switching the workspace in the map syncs DSH to its first session', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const select = source.slice(source.indexOf("app.addEventListener('change'"), source.indexOf("app.addEventListener('input'"))

  assert.match(select, /choice\.rootSessionIds\?\.\[0\] \?\? choice\.sessionIds\[0\]/)
  assert.match(select, /post\('synapse:activate-session'/)
})

test('renders markdown tables and allows higher canvas zoom', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const markdown = source.slice(source.indexOf('function markdownBlock'), source.indexOf('function overlapsCard'))

  assert.match(markdown, /<table><thead>/)
  assert.match(markdown, /isTableDelimiter/)
  // Zoom bounds are named constants, not the upstream 0.6-4 literals, and
  // clamp every zoom path (buttons, pinch, fit) even without the injection.
  assert.match(source, /const MIN_ZOOM = 0\.2/)
  assert.match(source, /const MAX_ZOOM = 2/)
  assert.match(source, /Math\.min\(MAX_ZOOM, Math\.max\(MIN_ZOOM, nextZoom\)\)/)
  assert.doesNotMatch(source, /Math\.min\(4, Math\.max\(\.6,/)
})

test('renders the refactored detail view with role-based messages', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const thread = source.slice(source.indexOf('function renderThread'), source.indexOf('function render()'))
  const message = source.slice(source.indexOf('function threadMessage'), source.indexOf('function processRecords'))

  assert.match(thread, /detail-scroll/)
  assert.match(thread, /detail-head/)
  assert.match(message, /message-avatar/)
  assert.match(message, /message-body/)
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
  // turn. The title is no longer a control.
  assert.match(card, /data-action="watch-turn"/)
  assert.match(card, /<strong class="thread-title">/)
  assert.doesNotMatch(card, /thread-title"[^>]*data-action/)
  assert.doesNotMatch(card, /data-action="show-thread"/)
  assert.doesNotMatch(card, /data-action="archive-thread"/)
  assert.match(click, /button\.dataset\.action === 'watch-turn'/)
  assert.match(click, /watchCardTurn\(thread, button\.dataset\.card\)/)
  assert.doesNotMatch(click, /closest\('\.thread-title'\)/)
  assert.doesNotMatch(click, /openButton\.click\(\)/)
  assert.match(app, /function watchCardTurn/)
  assert.match(app, /'synapse:watch-turn'/)
  assert.match(app, /'synapse:activate-session'/)
  // The host binds the live session and mounts the read-only pane.
  assert.match(source, /'synapse:watch-turn'\)/)
  assert.match(source, /function SynapseTurnPane/)
  assert.match(source, /turnWatch\.set\(/)
  assert.match(source, /onOpenInDialog/)
  const pane = source.slice(source.indexOf('function SynapseTurnPane'), source.indexOf('const turnWatch'))
  assert.doesNotMatch(pane, /session\.prompt/)
  assert.match(source, /send\('synapse:close-inspector'\)/)
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
  new Function('exports', `${source.slice(start, end)}\nexports.seqOf = seqOf\nexports.sliceTurnNodes = sliceTurnNodes\nexports.isLastUserTurn = isLastUserTurn`)(exports)

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
  new Function('exports', `const CARD_WIDTH = 310; const CARD_HEIGHT = 276; const MINIMAP_WIDTH = 176; const MINIMAP_HEIGHT = 118; const MINIMAP_INSET = 6; const state = { draft: null }; function draftPlacement() { return null }\n${source.slice(start, end)}\nexports.canvasWorldExtents = canvasWorldExtents\nexports.minimapProjection = minimapProjection\nexports.minimapProject = minimapProject\nexports.minimapUnproject = minimapUnproject`)(exports)
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
  // The pane is viewport-bounded so a long turn scrolls inside the transcript.
  assert.match(source, /\.dsh-synapse-turn-pane\{[^}]*position:absolute;top:0;right:0;bottom:0/)
  assert.match(source, /\.dsh-synapse-turn-pane\{[^}]*max-height:100%;overflow:hidden/)
  assert.match(source, /\.dsh-synapse-turn-pane \.dsh-codex-sidechat-transcript\{[^}]*overflow-y:auto/)

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

test('shows only the current conversation cards on the canvas', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const pan = source.slice(source.indexOf('const CANVAS_TWEAKS_SCRIPT'), source.indexOf('const injectCanvasStyle'))

  // conversationCards is re-bound (it is a top-level function declaration, so
  // the app's own call sites pick up the wrapper) instead of patching upstream.
  assert.match(pan, /var originalConversationCards = window\.conversationCards/)
  assert.match(pan, /window\.conversationCards = function \(threads\)/)
  assert.match(pan, /originalConversationCards\(\[current\]\)/)
  // Resolved from state with the active id as a fallback, so 整理/定位 (which
  // re-render) keep seeing only the current conversation.
  assert.match(pan, /state\?\.currentDsh\?\.id \?\? state\?\.activeId/)
  // An unresolvable current session must never widen the view: falling back to
  // the unfiltered list would put every conversation back on the canvas.
  assert.match(pan, /typeof currentId !== 'string' \|\| currentId === ''\) return \[\]/)
  assert.match(pan, /if \(current === undefined\) return \[\]/)
  assert.match(pan, /catch \(error\) \{ return \[\] \}/)
  assert.doesNotMatch(pan, /catch \(error\) \{ return originalConversationCards\(threads\) \}/)
})

test('hides the host message rail and side panels only while the map view is mounted', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const mount = source.slice(source.indexOf('function SynapseMapView'), source.indexOf('// Invisible header resident'))

  // The codex rail and right-side panels are host chrome that would overlay
  // the canvas; they are hidden for the lifetime of the map view only.
  assert.match(source, /CHROME_HIDE_SELECTORS = \['\.dsh-codex-nav-rail', '\.dsh-side-panels', '\.dsh-side-panels-launcher'\]/)
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
  assert.match(card, /const branchButton = !Number\.isInteger\(card\.answer\?\.sourceSeq\) \? ''/)
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

test('persists graph collapse choices and renders connectors from visible cards only', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const canvas = source.slice(source.indexOf('function renderCanvas'), source.indexOf('function isProcessMessage'))
  const toggle = source.slice(source.indexOf("button.dataset.action === 'toggle-card-children'"), source.indexOf("button.dataset.action === 'open-continue'"))

  assert.match(source, /COLLAPSED_CARDS_KEY/)
  assert.match(source, /localStorage\.setItem\(COLLAPSED_CARDS_KEY/)
  assert.match(canvas, /const graph = conversationGraphView\(allCards\)/)
  assert.match(canvas, /const cards = graph\.cards/)
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

test('scopes the canvas to the current DSH session family', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const scope = source.slice(source.indexOf('function threadFamily'), source.indexOf('function workspaceChoices'))
  const canvas = source.slice(source.indexOf('function renderCanvas'), source.indexOf('function isProcessMessage'))

  assert.match(scope, /function threadFamily/)
  assert.match(scope, /threadFamily\(threads, current\)/)
  // Without a current session, or before it is projected, keep the workspace
  // instead of emptying the canvas.
  assert.match(scope, /if \(typeof id !== 'string'\) return threads/)
  assert.match(scope, /if \(current === undefined\) return threads/)
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
  assert.deepEqual(exports.threadFamily(threads, threads[1]).map(thread => thread.id), ['root', 'child', 'cousin'])
  assert.deepEqual(exports.threadFamily(threads, threads[3]).map(thread => thread.id), ['other'])
  assert.deepEqual(exports.threadFamily(threads, undefined), [])
})

test('keeps a just-forked child on the map after the host switches session', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const submit = source.slice(source.indexOf('async function submitDraft'), source.indexOf('function threadsById'))
  const load = source.slice(source.indexOf('async function threadsForDshWorkspace'), source.indexOf('async function openDshWorkspace'))

  assert.match(submit, /state\.mapCardSessionSwitches\.add\(session\.id\)/)
  assert.match(submit, /post\('synapse:activate-session', \{ sessionId: result\.thread\.dshSessionId \}\)/)
  assert.match(load, /loadedIds\.has\(thread\.parentId\)/)
})

test('re-centers the camera when the current session replaces the canvas', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const current = source.slice(source.indexOf("data.type === 'synapse:current-session'"), source.indexOf("data.type === 'synapse:live-reply'"))

  // A switch swaps the whole canvas content, so the old camera would point at
  // empty space; reset unless the switch came from a card click in the map.
  assert.match(current, /resetCanvasCamera\(\)/)
  assert.match(current, /state\.mapCardSessionSwitches\.delete\(data\.session\?\.id\)/)
  assert.match(current, /focusActiveCard\(\)/)
})

test('does not ship a card archive action', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /archive-thread/)
  assert.doesNotMatch(source, /async function archiveThread/)
})

test('treats forks as children of the main session and can delete one branch node', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const card = source.slice(source.indexOf('function conversationCard'), source.indexOf('function draftActions'))
  const inspector = source.slice(source.indexOf('function renderCardInspector'), source.indexOf('function renderThread'))
  const remove = source.slice(source.indexOf('async function removeBranch'), source.indexOf('function dshRpc'))

  assert.match(client, /rootSessionIds: rootIdsOf/)
  assert.match(client, /increaseTitle: false/)
  assert.match(client, /'synapse:archive-session'/)
  assert.match(client, /ctx\.workspaces\.archiveSession/)
  assert.match(source, /sidebarThreads = threads\.filter\(thread => thread\.parentId === null\)/)
  assert.match(source, /function latestRootThread/)
  assert.match(card, /data-action="remove-branch"/)
  assert.match(card, /card\.turnIndex === 0 && card\.sourceParentId !== null/)
  assert.match(inspector, /删除分支/)
  assert.match(inspector, /thread\.parentId === null \? ''/)
  assert.match(remove, /window\.confirm\('删除这个分支？主会话会保留。'\)/)
  assert.match(remove, /'synapse:archive-session'/)
  assert.match(remove, /`\/synapse\/api\/threads\/\$\{thread\.id\}`/)
  assert.match(remove, /post\('synapse:activate-session', \{ sessionId: parent\.dshSessionId \}\)/)
})
