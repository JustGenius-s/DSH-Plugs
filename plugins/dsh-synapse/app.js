const app = document.querySelector('#app')
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
const LEGACY_CARD_POSITIONS_KEY = 'dsh-synapse:card-positions'
const CARD_POSITIONS_KEY = 'dsh-synapse:card-positions:v4'
const COLLAPSED_CARDS_KEY = 'dsh-synapse:collapsed-cards:v1'
const QUICK_PHRASES_KEY = 'dsh-synapse:quick-phrases:v1'
const INSPECTOR_WIDTH_KEY = 'dsh-synapse:inspector-width:v1'
const INSPECTOR_TOC_WIDTH_KEY = 'dsh-synapse:inspector-toc-width:v1'
const INSPECTOR_DEFAULT_WIDTH = 460
const INSPECTOR_MIN_WIDTH = 360
const INSPECTOR_TOC_DEFAULT_WIDTH = 240
const INSPECTOR_TOC_MIN_WIDTH = 180
const INSPECTOR_TOC_MAX_WIDTH = 480
const DEFAULT_QUICK_PHRASES = ['展开说明', '举例', '通俗易懂', '对比解释']
const MAX_QUICK_PHRASES = 12
const MAX_QUICK_PHRASE_LENGTH = 16
function normalizeQuickPhrases(value) {
  if (!Array.isArray(value)) return []
  const phrases = []
  for (const item of value) {
    const phrase = typeof item === 'string' ? item.trim().slice(0, MAX_QUICK_PHRASE_LENGTH) : ''
    if (phrase !== '' && !phrases.includes(phrase)) phrases.push(phrase)
    if (phrases.length === MAX_QUICK_PHRASES) break
  }
  return phrases
}
const savedQuickPhrases = (() => {
  try {
    const stored = localStorage.getItem(QUICK_PHRASES_KEY)
    return stored === null ? DEFAULT_QUICK_PHRASES : normalizeQuickPhrases(JSON.parse(stored))
  } catch { return DEFAULT_QUICK_PHRASES }
})()
const savedBranchAnchors = (() => {
  try {
    const value = JSON.parse(localStorage.getItem('dsh-synapse:branch-anchors') ?? '[]')
    return Array.isArray(value) ? value.filter(item => Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'string') : []
  } catch { return [] }
})()
const savedCardPositions = (() => {
  try {
    // Drop formats that were never persisted; the current key stores drags.
    localStorage.removeItem(LEGACY_CARD_POSITIONS_KEY)
    localStorage.removeItem('dsh-synapse:card-positions:v2')
    localStorage.removeItem('dsh-synapse:card-positions:v3')
    const value = JSON.parse(localStorage.getItem(CARD_POSITIONS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(item => Array.isArray(item) && typeof item[0] === 'string' && item[1] !== null && Number.isFinite(item[1].x) && Number.isFinite(item[1].y)) : []
  } catch { return [] }
})()
const savedCollapsedCards = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(COLLAPSED_CARDS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
  } catch { return [] }
})()
const savedCardIds = (() => {
  try {
    const value = JSON.parse(localStorage.getItem('dsh-synapse:card-identities:v1') ?? '[]')
    return Array.isArray(value) ? value.filter(item => Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'string') : []
  } catch { return [] }
})()
const savedInspectorWidth = (() => {
  try {
    const value = Number(localStorage.getItem(INSPECTOR_WIDTH_KEY))
    return Number.isFinite(value) && value >= INSPECTOR_MIN_WIDTH ? value : INSPECTOR_DEFAULT_WIDTH
  } catch { return INSPECTOR_DEFAULT_WIDTH }
})()
const savedInspectorTocWidth = (() => {
  try {
    const value = Number(localStorage.getItem(INSPECTOR_TOC_WIDTH_KEY))
    return Number.isFinite(value) && value >= INSPECTOR_TOC_MIN_WIDTH ? value : INSPECTOR_TOC_DEFAULT_WIDTH
  } catch { return INSPECTOR_TOC_DEFAULT_WIDTH }
})()
const CARD_WIDTH = 310
const CARD_HEIGHT = 276
const CARD_GAP_Y = 42
const CAMERA_INSET_X = 56
const CAMERA_INSET_Y = 56
// Cards outside the viewport (plus this world-space margin) are not mounted
// into the DOM; the margin pre-mounts cards just before they scroll into view
// so panning never flashes empty space.
const VIEWPORT_MARGIN = 1400

/**
 * Card states, in the order the resolver checks them.
 *
 * - `needs-input` — the session is BLOCKED on a human (an approval, a plan
 *   review, or a question). Nothing will progress until the user answers in the
 *   conversation, so this outranks everything else.
 * - `running` — the agent is actively working; the card streams its answer.
 * - `failed` — the turn ended in an error and never produced an answer.
 * - `done` — the turn has an answer and the session is idle.
 * - `waiting` — no answer yet and nothing is running (a fresh card, or a
 *   session the plugin has not heard from).
 */
const CARD_STATES = ['creating', 'queued', 'needs-input', 'running', 'failed', 'cancelled', 'done', 'waiting']
const CARD_STATE_LABELS = {
  creating: '创建中',
  queued: '排队中',
  'needs-input': '待处理',
  running: '进行中',
  failed: '失败',
  cancelled: '已取消',
  done: '已完成',
  waiting: '等待中',
}
// `pendingInteraction` kinds DSH reports; each maps to 待处理 with its own hint.
const PENDING_INTERACTION_HINTS = {
  approval: '需要审批',
  'plan-review': '需要确认计划',
  question: '需要回答问题',
}

/**
 * Resolve one card's state.
 *
 * `sessionStatus` is the live status DSH reports for the card's session, or
 * `null` when the session is no longer listed (archived, or a cold session the
 * host has not loaded). The card's own fields cover those cases: a stored error
 * marks a failed turn and a stored answer marks a finished one.
 *
 * Session-level `running` belongs to the in-flight card only: a settled card
 * stays done (or failed) while a LATER turn of the same session streams, or
 * every card on a running session would flip to 进行中 the moment the user
 * asks a follow-up.
 */
function cardState(card, sessionStatus) {
  if (card?.status === 'creating' || card?.status === 'queued') return card.status
  if (card?.status === 'cancelled') return 'cancelled'
  if (card?.status === 'done' || card?.status === 'failed') return card.status
  const activeTurn = card?.isTail === true || card?.answer?.pending === true
    || (card?.isTail !== false && card?.answer == null && card?.error == null)
  if (activeTurn && sessionStatus?.pendingInteraction != null) return 'needs-input'
  if (activeTurn && sessionStatus?.running === true) return 'running'
  if (card?.answer?.pending === true) return 'running'
  if (card?.error != null) return 'failed'
  if (card?.status === 'running' && card?.isTail !== false) return 'running'
  if (card?.answer != null) return 'done'
  return 'waiting'
}

function cardStateLabel(card, sessionStatus) {
  const resolved = cardState(card, sessionStatus)
  if (resolved !== 'needs-input') return CARD_STATE_LABELS[resolved]
  const kind = sessionStatus?.pendingInteraction
  return PENDING_INTERACTION_HINTS[kind] ?? CARD_STATE_LABELS['needs-input']
}

/**
 * The live status DSH reports for a thread's session, or `null` when the host
 * no longer lists it. `state.sessionStatusById` is rebuilt on every session
 * sync, so a card reflects the host's own running/waiting/done signals.
 */
function sessionStatusFor(thread) {
  if (thread?.dshSessionId === null || thread?.dshSessionId === undefined) return null
  return state.sessionStatusById?.get(thread.dshSessionId) ?? null
}

/**
 * A fingerprint of the states the cards actually render, so a host list change
 * that leaves every card's state alone costs no redraw.
 */
function statusFingerprint(statusById) {
  const parts = []
  for (const [id, status] of statusById) {
    parts.push(`${id}:${status?.running === true ? 1 : 0}${status?.pendingInteraction ?? ''}${status?.completed === true ? 1 : 0}`)
  }
  return parts.sort().join('|')
}

/** The state badge markup for one card, or '' when the state needs no badge. */
function cardStateBadge(card, sessionStatus) {
  const resolved = cardState(card, sessionStatus)
  return `<span class="card-state card-state-${resolved}" data-card-state="${resolved}" title="${escapeHtml(cardStateLabel(card, sessionStatus))}">${escapeHtml(cardStateLabel(card, sessionStatus))}</span>`
}

const state = {
  summaries: [], workspace: null, activeId: null, selectedCardId: null, mode: 'canvas', zoom: 1, currentDsh: null, sidebarCollapsed: false,
  dshWorkspaces: [], selectedDshWorkspaceId: null,
  historyBySession: new Map(), historyRequests: new Map(), pendingReplies: new Map(), pendingRpc: new Map(), liveReplies: new Map(), sessionStatusById: new Map(),
  historyRevisions: new Map(), cardIds: new Map(savedCardIds), submissions: new Map(),
  layoutLanes: new Map(), layoutPositions: new Map(),
  visibilityMutation: null, visibilityVersion: 0, canvasAllCards: [],
  draft: null, error: '', workspaceLoad: 0, branchAnchors: new Map(savedBranchAnchors), cardPositions: new Map(savedCardPositions), collapsedCardIds: new Set(savedCollapsedCards), quickPhrases: savedQuickPhrases, quickPhraseEditorOpen: false,
  dragging: false, canvasGesture: false, canvasRefreshAfter: 0, canvasViewInitialized: false, canvasCamera: { x: 0, y: 0 }, mapCardSessionSwitches: new Set(),
  expandedMessageIds: new Set(),
  canvasCards: undefined, canvasCardsById: undefined, canvasGraph: undefined, mountedCardIds: new Set(), canvasNeedsCenter: false,
  detailScrollByThread: new Map(), detailThreadId: null, detailTargetCardId: null,
  inspectorCardId: null, inspectorOpening: false, inspectorScrollByCard: new Map(), inspectorScrollRestoring: false, renamingCardId: null,
  inspectorTocOpen: false, inspectorNoteSave: null,
  inspectorWidth: savedInspectorWidth, inspectorExpanded: false, inspectorTocWidth: savedInspectorTocWidth,
  dshWorkspacesFingerprint: '', workspaceThreadsFingerprint: '', workspaceContentFingerprint: '', canvasDirty: false,
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
const formatTime = value => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const currentThread = () => state.workspace?.threads.find(thread => thread.id === state.activeId) ?? state.workspace?.threads[0] ?? null
const threadListTitle = thread => firstUserQuestion(thread) ?? (isSessionLabelQuestion(thread.dshSessionTitle) || isSessionLabelQuestion(thread.title) ? '等待用户提问' : (thread.dshSessionTitle ?? thread.title ?? questionFor(thread)))

function rememberBranchAnchor(sessionId, cardId) {
  if (typeof sessionId !== 'string' || sessionId === '' || typeof cardId !== 'string' || cardId === '') return
  state.branchAnchors.set(sessionId, cardId)
  try { localStorage.setItem('dsh-synapse:branch-anchors', JSON.stringify([...state.branchAnchors])) } catch { /* Private browsing may disable local storage. */ }
}

function persistCardPositions() {
  try { localStorage.setItem(CARD_POSITIONS_KEY, JSON.stringify([...state.cardPositions])) } catch { /* Private browsing may disable local storage. */ }
}

function persistCollapsedCards() {
  try { localStorage.setItem(COLLAPSED_CARDS_KEY, JSON.stringify([...state.collapsedCardIds])) } catch { /* Private browsing may disable local storage. */ }
}

function persistQuickPhrases() {
  try { localStorage.setItem(QUICK_PHRASES_KEY, JSON.stringify(state.quickPhrases)) } catch { /* Private browsing may disable local storage. */ }
}

function persistInspectorLayout() {
  try {
    localStorage.setItem(INSPECTOR_WIDTH_KEY, String(state.inspectorWidth))
    localStorage.setItem(INSPECTOR_TOC_WIDTH_KEY, String(state.inspectorTocWidth))
  } catch { /* Private browsing may disable local storage. */ }
}

function inspectorMaxWidth() {
  const view = document.querySelector('.canvas-view')
  return view instanceof HTMLElement && view.clientWidth > 0 ? view.clientWidth : window.innerWidth
}

function clampInspectorWidth(width) {
  const max = Math.max(INSPECTOR_MIN_WIDTH, inspectorMaxWidth())
  return Math.min(max, Math.max(INSPECTOR_MIN_WIDTH, Math.round(Number(width) || INSPECTOR_DEFAULT_WIDTH)))
}

function clampInspectorTocWidth(width) {
  const inspector = document.querySelector('.card-inspector')
  const available = inspector instanceof HTMLElement && inspector.clientWidth > 0
    ? inspector.clientWidth - 360
    : INSPECTOR_TOC_MAX_WIDTH
  const max = Math.max(INSPECTOR_TOC_MIN_WIDTH, Math.min(INSPECTOR_TOC_MAX_WIDTH, available))
  return Math.min(max, Math.max(INSPECTOR_TOC_MIN_WIDTH, Math.round(Number(width) || INSPECTOR_TOC_DEFAULT_WIDTH)))
}

function applyInspectorTocLayout() {
  const width = clampInspectorTocWidth(state.inspectorTocWidth)
  const inspector = document.querySelector('.card-inspector')
  const toc = document.querySelector('.card-inspector-toc')
  if (inspector instanceof HTMLElement) inspector.style.setProperty('--inspector-toc-width', `${width}px`)
  if (toc instanceof HTMLElement) toc.style.setProperty('--inspector-toc-width', `${width}px`)
}

function applyInspectorLayout() {
  const width = clampInspectorWidth(state.inspectorWidth)
  const view = document.querySelector('.canvas-view')
  const inspector = document.querySelector('.card-inspector')
  const shell = document.querySelector('.synapse-shell')
  if (view instanceof HTMLElement) {
    view.classList.toggle('inspector-expanded', state.inspectorExpanded)
    if (state.inspectorExpanded) view.style.removeProperty('--inspector-width')
    else view.style.setProperty('--inspector-width', `${width}px`)
  }
  if (shell instanceof HTMLElement) {
    if (state.inspectorCardId === null || state.inspectorExpanded) shell.style.removeProperty('--inspector-width')
    else shell.style.setProperty('--inspector-width', `${width}px`)
  }
  if (inspector instanceof HTMLElement) {
    inspector.classList.toggle('is-expanded', state.inspectorExpanded)
    inspector.style.width = state.inspectorExpanded ? '100%' : `${width}px`
  }
  applyInspectorTocLayout()
}

function toggleInspectorExpanded() {
  state.inspectorExpanded = !state.inspectorExpanded
  persistInspectorLayout()
  applyInspectorLayout()
  const button = document.querySelector('[data-action="toggle-inspector-expand"]')
  if (button instanceof HTMLElement) {
    const label = state.inspectorExpanded ? '还原' : '铺满'
    button.classList.toggle('is-active', state.inspectorExpanded)
    button.setAttribute('aria-label', label)
    button.setAttribute('title', label)
    button.setAttribute('aria-pressed', state.inspectorExpanded ? 'true' : 'false')
    const svg = button.querySelector('svg')
    if (svg instanceof SVGElement) {
      svg.innerHTML = state.inspectorExpanded
        ? '<path d="M6 3.5h6.5V10M3.5 6v6.5H10"/>'
        : '<path d="M3.5 6.5V3.5h3M12.5 6.5V3.5h-3M3.5 9.5v3h3M12.5 9.5v3h-3"/>'
    }
  }
  const minimap = document.querySelector('.canvas-minimap')
  if (minimap instanceof HTMLElement) minimap.classList.toggle('is-full', state.inspectorExpanded)
}

function rememberCardPosition(cardId, position, aliases = []) {
  state.cardPositions.set(cardId, { x: Math.round(position.x), y: Math.round(position.y) })
  for (const alias of aliases) state.cardPositions.set(alias, { x: Math.round(position.x), y: Math.round(position.y) })
  persistCardPositions()
}

function resetCardPositions() {
  state.layoutLanes.clear()
  state.layoutPositions.clear()
  state.cardPositions.clear()
  persistCardPositions()
  try {
    localStorage.removeItem(LEGACY_CARD_POSITIONS_KEY)
    localStorage.removeItem('dsh-synapse:card-positions:v2')
    localStorage.removeItem('dsh-synapse:card-positions:v3')
  } catch { /* Private browsing may disable local storage. */ }
}

function resetCanvasCamera() {
  state.canvasViewInitialized = false
  state.canvasCamera = { x: 0, y: 0 }
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body.error ?? '请求失败')
    error.status = response.status
    throw error
  }
  // Any mutation invalidates the cached workspace graphs: the next read must
  // observe what this write just changed.
  if (options.method !== undefined && options.method !== 'GET' && !['/synapse/api/turn-detail', '/synapse/api/turn-cursor'].includes(path)) invalidateGraphCache()
  return body
}

function post(type, payload = {}) {
  if (window.parent !== window) window.parent.postMessage({ source: 'dsh-synapse', type, ...payload }, window.location.origin)
}

// The host turn pane and the in-canvas inspector occupy the same right rail.
// Opening one must dismiss the other; they never share the screen.
function dismissTurnPane() {
  post('synapse:watch-turn', {})
}

function rootThreadOf(thread, threads = state.workspace?.threads ?? []) {
  if (thread === undefined) return undefined
  const byId = new Map(threads.map(item => [item.id, item]))
  const seen = new Set()
  let cursor = thread
  while (cursor.parentId !== null && !seen.has(cursor.id)) {
    seen.add(cursor.id)
    const parent = byId.get(cursor.parentId)
    if (parent === undefined) break
    cursor = parent
  }
  return cursor
}

function latestRootThread(threads) {
  return threads
    .filter(thread => thread.dshSessionId !== null && thread.parentId === null)
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))[0]
}

/**
 * The card footer's 详情: watch this one turn in the host's turn pane.
 *
 * The pane is the side-chat surface, rendered from the session's live chat
 * nodes, so a running turn streams into it. It is a DIFFERENT surface from the
 * card drawer: the drawer shows the turn's final output, read back from DSH's
 * event log, while this pane replays the whole turn step by step. The two never
 * share the right rail — opening one dismisses the other.
 */
function canvasCardSelection(thread, cardId) {
  if (thread === undefined || typeof cardId !== 'string' || cardId === '') return null
  return { activeId: thread.id, selectedCardId: cardId, inspectorCardId: cardId }
}

function watchCardTurn(thread, cardId) {
  if (typeof thread?.dshSessionId !== 'string' || thread.dshSessionId === '' || typeof cardId !== 'string') return
  const card = state.canvasCardsById?.get(cardId)
  if (card === undefined || card.dshThreadId !== thread.id) return
  if (!Number.isSafeInteger(card.sourceSeq)) return
  if (state.inspectorCardId !== null) closeCardInspector({ animate: false })
  // Reading another fork is local to the map. The host pane subscribes to the
  // requested session directly, so opening 详情 must not change DSH's current
  // session or move the canvas to that branch.
  const seq = Number.isInteger(card?.sourceSeq) ? card.sourceSeq : undefined
  const turnIndex = Number.isInteger(card?.turnIndex) ? card.turnIndex : undefined
  const turns = Array.isArray(thread.turns) ? thread.turns : []
  const turn = turns.find(item => item.seq === seq)
  const reference = turn === undefined ? undefined : {
    messageId: turn.messageId,
    question: turn.question,
    root: thread.parentId === null && thread.sourceParentSessionId == null,
    unique: turns.filter(item => item.question === turn.question).length === 1,
  }
  post('synapse:watch-turn', {
    sessionId: thread.dshSessionId,
    seq,
    turnIndex,
    cardId,
    ...(reference === undefined ? {} : {
      reference,
      preview: { question: turn.question, answer: turn.answer, error: turn.error, completed: ['done', 'failed', 'cancelled'].includes(cardState(card, sessionStatusFor(thread))) },
    }),
  })
}

function dispatchCardSessionAction(action, thread, cardId, seq) {
  if (action === 'watch-turn') {
    watchCardTurn(thread, cardId)
    return true
  }
  if (action !== 'open-dsh') return false
  if (typeof thread?.dshSessionId === 'string' && thread.dshSessionId !== '') {
    post('synapse:open-session', {
      sessionId: thread.dshSessionId,
      seq: seq !== undefined && seq !== '' && Number.isSafeInteger(Number(seq)) ? Number(seq) : undefined,
    })
  }
  return true
}

function cardHideReason(card, sessionStatus, draft) {
  if (card?.blank || card?.visibilityTarget === undefined) return '这张卡片还没有可隐藏的消息'
  if (card.operationId) return '请先完成、重试或放弃这次发送'
  if (['creating', 'queued', 'running', 'needs-input'].includes(cardState(card, sessionStatus))) return '请等待这轮对话结束后再隐藏'
  if (draft != null && draft.kind !== 'new' && (draft.anchorId === card.id
    || draft.anchorId === undefined && draft.parentId === card.dshThreadId && card.isTail)) {
    return '请先完成或取消正在编辑的追问或分支'
  }
  return null
}

function cardTitleIntent(card, event, busy = false) {
  if (card == null || card.blank || card.hidden || busy || event.defaultPrevented) return null
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null
  if (event.type === 'dblclick' && event.button === 0) return 'rename-card'
  if (event.type === 'keydown' && !event.isComposing && !event.repeat && ['Enter', ' ', 'F2'].includes(event.key)) return 'rename-card'
  return null
}

function cardActions(card, sessionStatus, draft) {
  if (card?.blank) return []
  return [
    { action: 'hide-card', placement: 'footer', icon: 'hidden', text: '隐藏', label: '从地图隐藏', reason: cardHideReason(card, sessionStatus, draft) },
  ]
}

function visibilityTargetMatches(thread, turn, index, target) {
  if (thread.id !== target.threadId) return false
  if (target.messageId) return turn.messageId === target.messageId
  if (target.cardId) return (turn.cardId ?? `${thread.id}:turn:${turn.seq ?? `i${index}`}`) === target.cardId
  return (Number.isSafeInteger(turn.seq) ? String(turn.seq) : `i${index}`) === target.cardKey
}

/** Merge only visual metadata; a late PATCH must not replace newer answers. */
function applyCardVisibilityUpdates(threads, updates) {
  return threads.map(thread => {
    const relevant = updates.filter(update => update.threadId === thread.id)
    if (relevant.length === 0) return thread
    return { ...thread, turns: (thread.turns ?? []).map((turn, index) => {
      const update = relevant.find(target => visibilityTargetMatches(thread, turn, index, target))
      if (update === undefined) return turn
      const next = { ...turn }
      if (update.hidden) next.hidden = true
      else delete next.hidden
      return next
    }) }
  })
}

async function changeCardVisibility(cardIds, hidden) {
  if (state.visibilityMutation !== null) throw new Error('正在保存卡片状态，请稍候')
  const ids = new Set(cardIds)
  const cards = (state.canvasAllCards ?? []).filter(card => ids.has(card.id))
  if (cards.length === 0 || cards.length !== ids.size) throw new Error('卡片已变化，请重新选择')
  if (hidden) {
    for (const card of cards) {
      const thread = state.workspace?.threads.find(item => item.id === card.dshThreadId)
      const reason = cardHideReason(card, sessionStatusFor(thread), state.draft)
      if (reason !== null) throw new Error(reason)
    }
  }
  const workspaceId = state.workspace?.id
  const mutation = { workspaceId, cardIds: ids, hidden, targets: cards.map(card => card.visibilityTarget) }
  state.visibilityMutation = mutation
  state.visibilityVersion++
  state.error = ''
  if (hidden) {
    if (ids.has(state.inspectorCardId)) closeCardInspector({ animate: false })
    if (ids.has(state.selectedCardId)) state.selectedCardId = null
    state.renamingCardId = null
  }
  render()
  try {
    // Keep each batch below the API body limit. Successful batches remain
    // restored if a later batch fails; only unconfirmed changes roll back.
    for (let index = 0; index < mutation.targets.length; index += 100) {
      const body = await api('/synapse/api/cards/visibility', {
        method: 'PATCH', body: JSON.stringify({ cards: mutation.targets.slice(index, index + 100), hidden }),
      })
      if (!Array.isArray(body.updates)) throw new Error('卡片状态保存结果无效，请刷新确认')
      if (state.workspace?.id === workspaceId) {
        state.workspace.threads = applyCardVisibilityUpdates(state.workspace.threads, body.updates)
      }
    }
    if (state.workspace?.id === workspaceId) {
      if (!hidden) {
        state.collapsedCardIds = expandedForRestoredCards(state.canvasAllCards, ids, state.collapsedCardIds)
        persistCollapsedCards()
      }
    }
  } finally {
    state.visibilityMutation = null
    state.visibilityVersion++
    invalidateGraphCache()
    requestCanvasRefresh()
  }
}

function dshRpc(type, payload = {}) {
  if (window.parent === window) return Promise.reject(new Error('请从 DSH 页面打开 Synapse 后再操作会话'))
  const requestId = crypto.randomUUID()
  post(type, { requestId, ...payload })
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      state.pendingRpc.delete(requestId)
      reject(new Error('DSH 未在规定时间内响应'))
    }, 20_000)
    state.pendingRpc.set(requestId, { resolve, reject, timer })
  })
}

function settleRpc(requestId, value, error) {
  const pending = state.pendingRpc.get(requestId)
  if (pending === undefined) return
  state.pendingRpc.delete(requestId)
  window.clearTimeout(pending.timer)
  if (error === undefined) pending.resolve(value)
  else pending.reject(error instanceof Error ? error : new Error(String(error)))
}

function setError(error = '') { state.error = error instanceof Error ? error.message : error; render() }

function messagesFromEvents(events) {
  if (!Array.isArray(events)) return []
  return events.flatMap(event => {
    const content = event?.data?.message?.content ?? event?.data?.content
    const text = Array.isArray(content) ? content.filter(block => block?.type === 'text').map(block => block.text).filter(Boolean).join('\n') : ''
    // Runtime-context snapshots and <system-reminder> blocks arrive as
    // user-role messages but are not real user turns: they must not become
    // their own conversation card.
    const kind = event?.data?.source?.kind ?? event?.data?.message?.source?.kind
    if (event?.type === 'user/message' && text && (kind === undefined || kind === 'user') && !isInjectedCardText(text)) return [{ kind: 'user', text, at: event.time, sourceSeq: event.seq }]
    if (event?.type === 'assistant/message' && text) return [{ kind: 'assistant', text, at: event.time, sourceSeq: event.seq }]
    return []
  })
}

/**
 * Load the full text of one turn on demand.
 *
 * v5 keeps only a display-sized summary on the card, so opening the detail
 * view re-reads the real question, every assistant step, and each tool call
 * (arguments and output) from the DSH session. Results are cached per turn so
 * reopening a card is instant and re-renders do not refetch.
 */
async function loadThreadHistory(thread, cardId = undefined) {
  if (thread?.dshSessionId === null || thread?.dshSessionId === undefined) return
  const cards = cardId === undefined ? turnsFor(thread).map((turn, index) => ({ id: turn.cardId ?? `${thread.id}:turn:${turn.seq ?? `i${index}`}`, turn })) : null
  const targets = cards ?? [{ id: cardId, turn: turnForCardId(thread, cardId) }]
  state.historyRevisions ??= new Map()
  for (const target of targets) {
    if (target.turn === null || target.turn === undefined) continue
    const key = `${thread.dshSessionId}:${target.id}`
    const revision = JSON.stringify([target.turn.seq, target.turn.answerSeq, target.turn.endSeq, target.turn.status, target.turn.processCount])
    const cached = state.historyRevisions.get(key)
    if (cached?.revision === revision && (cached.complete || Date.now() - cached.at < 1000)) continue
    if (state.historyRequests.has(key)) {
      await state.historyRequests.get(key)
      continue
    }
    // A pending turn exists only in the browser; there is nothing to read yet.
    if (target.turn.pending === true) continue
    if (!Number.isSafeInteger(target.turn.seq) && !Number.isInteger(target.turn.turnIndex)) continue
    const request = (async () => {
      try {
        const body = await api('/synapse/api/turn-detail', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: thread.dshSessionId,
            seq: Number.isSafeInteger(target.turn.seq) ? target.turn.seq : null,
            turnIndex: Number.isInteger(target.turn.turnIndex) ? target.turn.turnIndex : null,
          }),
        })
        state.historyBySession.set(key, body.detail ?? null)
        state.historyRevisions.set(key, { revision, at: Date.now(), complete: body.detail?.complete === true })
      } catch (error) {
        // A session that left the store (archived, or a DSH restart) simply
        // has no detail to read; the card summary still renders.
        if (!state.historyBySession.has(key)) state.historyBySession.set(key, null)
        state.historyRevisions.set(key, { revision, at: Date.now(), complete: false })
      } finally {
        state.historyRequests.delete(key)
      }
    })()
    state.historyRequests.set(key, request)
    await request
  }
}

function turnForCardId(thread, cardId) {
  if (typeof cardId !== 'string') return null
  const index = turnsFor(thread).findIndex((turn, turnIndex) => (turn.cardId ?? `${thread.id}:turn:${turn.seq ?? `i${turnIndex}`}`) === cardId)
  return index === -1 ? null : turnsFor(thread)[index]
}

function historyForCard(thread, cardId) {
  return state.historyBySession.get(`${thread.dshSessionId}:${cardId}`) ?? null
}

function canReplaceView() {
  // renamingCardId: a background re-render would remount the rename input and
  // drop the text being typed, same class of bug as the draft composer.
  return state.draft === null && state.renamingCardId === null && !state.dragging && !state.canvasGesture && Date.now() >= state.canvasRefreshAfter && !document.activeElement?.matches('textarea')
}

function deferCanvasRefresh(delay = 700) {
  state.canvasRefreshAfter = Math.max(state.canvasRefreshAfter, Date.now() + delay)
}

function rememberInspectorScroll(scrollTop) {
  if (state.inspectorCardId === null || state.inspectorScrollRestoring) return
  if (typeof scrollTop === 'number' && Number.isFinite(scrollTop)) {
    state.inspectorScrollByCard.set(state.inspectorCardId, scrollTop)
    return
  }
  const inspector = document.querySelector('.card-inspector-scroll')
  if (inspector instanceof HTMLElement) state.inspectorScrollByCard.set(state.inspectorCardId, inspector.scrollTop)
}

function restoreInspectorScroll(scrollTop) {
  if (scrollTop === null || scrollTop === undefined) return
  const inspector = document.querySelector('.card-inspector-scroll')
  if (!(inspector instanceof HTMLElement)) return
  state.inspectorScrollRestoring = true
  inspector.scrollTop = scrollTop
  window.requestAnimationFrame(() => {
    const next = document.querySelector('.card-inspector-scroll')
    if (next instanceof HTMLElement) next.scrollTop = scrollTop
    state.inspectorScrollRestoring = false
  })
}

/**
 * The DSH workspace the current session belongs to.
 *
 * `dsh-ungrouped` is a mixed bucket: every session the host has not bound to a
 * project lands in it (measured: 237 sessions spanning 10 different projects).
 * Scoping the canvas to it wrecked family resolution — a fork's parent and
 * sibling sessions are grouped by their own cwd, so inside the mixed bucket the
 * fork could only resolve to itself, which rendered as "just the one turn card
 * after the fork". Only fall back to the bucket when the session really is
 * ungrouped (no cwd of its own to match).
 */
function currentDshWorkspace() {
  const id = state.currentDsh?.id
  if (typeof id !== 'string') return undefined
  const cwd = state.currentDsh?.cwd
  if (typeof cwd === 'string' && cwd !== '') {
    const byCwd = state.dshWorkspaces.find(workspace => workspace.path === cwd && workspace.sessionIds.includes(id))
    if (byCwd !== undefined) return byCwd
  }
  const containing = state.dshWorkspaces.filter(workspace => workspace.sessionIds.includes(id))
  return containing.find(workspace => workspace.id !== 'dsh-ungrouped') ?? containing[0]
}

function selectedDshWorkspace() {
  return state.dshWorkspaces.find(workspace => workspace.id === state.selectedDshWorkspaceId)
}

function currentDshThread(threads = state.workspace?.threads ?? []) {
  const id = state.currentDsh?.id
  return typeof id === 'string' ? threads.find(thread => thread.dshSessionId === id) : undefined
}

/**
 * The one conversation a card belongs to: a session, its ancestors, and every
 * fork taken from any of them.
 *
 * `thread.parentId` is Synapse's own node id, which only exists once the
 * parent has been projected into this workspace. DSH also records the fork on
 * the session itself (`sourceParentSessionId`), and that link survives the
 * parent's projection being missing — a fork restored from an archived session,
 * or one whose parent has not been synced yet. Following both is what keeps a
 * branch attached to its conversation instead of floating as an orphan root
 * (which is also what sends it to the canvas origin).
 *
 * @param threads - the workspace's threads.
 * @param start - the thread to build the family around.
 * @returns the family's threads, in the workspace's own order.
 */
function threadFamily(threads, start) {
  if (start === undefined) return []
  const byId = new Map(threads.map(thread => [thread.id, thread]))
  const bySessionId = new Map()
  for (const thread of threads) {
    if (typeof thread.dshSessionId === 'string' && thread.dshSessionId !== '') bySessionId.set(thread.dshSessionId, thread)
  }
  const ids = new Set()
  const seen = new Set()
  const queue = [start]
  while (queue.length > 0) {
    const cursor = queue.shift()
    if (cursor === undefined || seen.has(cursor.id)) continue
    seen.add(cursor.id)
    ids.add(cursor.id)
    // Up: Synapse's parent node, then DSH's own parent session.
    const parentId = cursor.parentId ?? null
    if (parentId !== null && parentId !== undefined && byId.has(parentId)) queue.push(byId.get(parentId))
    const sourceParentSessionId = cursor.sourceParentSessionId
    if (typeof sourceParentSessionId === 'string' && sourceParentSessionId !== '') {
      const viaSession = bySessionId.get(sourceParentSessionId)
      if (viaSession !== undefined) queue.push(viaSession)
    }
  }
  // Down: every fork taken from any member, at any depth. Repeated until the
  // set stops growing so a grandchild links even when its parent is only added
  // on a later pass.
  let changed = true
  while (changed) {
    changed = false
    for (const thread of threads) {
      if (ids.has(thread.id)) continue
      const parentId = thread.parentId ?? null
      const linkedByNode = parentId !== null && parentId !== undefined && ids.has(parentId)
      const linkedBySession = typeof thread.sourceParentSessionId === 'string'
        && thread.sourceParentSessionId !== ''
        && [...ids].some(id => byId.get(id)?.dshSessionId === thread.sourceParentSessionId)
      if (!linkedByNode && !linkedBySession) continue
      ids.add(thread.id)
      changed = true
    }
  }
  return threads.filter(thread => ids.has(thread.id))
}

/**
 * The threads the canvas draws.
 *
 * Scoped to the fork FAMILY of DSH's CURRENT session (see `threadFamily`):
 * the current session's ancestors, plus every fork taken from any of them.
 * The map is the whole branch tree the user is in — ancestor sessions AND
 * their fork branches — so sibling branches are part of the picture, never
 * hidden. Unrelated conversations stay off the canvas (a workspace holds
 * dozens of them); they remain reachable by switching the DSH session.
 *
 * The active thread joins as a second anchor: it is where the user just
 * clicked, and a just-created branch stays anchored on it while the host
 * keeps the parent as the current session. It is also the fallback when
 * `currentDsh` names a session whose thread has not been projected yet —
 * falling back to the whole workspace there would flash every conversation
 * onto the canvas.
 */
function visibleThreads() {
  const threads = state.workspace?.threads ?? []
  const current = currentDshThread(threads)
  const active = state.activeId === null || state.activeId === undefined ? undefined : threads.find(thread => thread.id === state.activeId)
  const anchor = current ?? active
  if (anchor === undefined) return threads
  const visible = new Set()
  for (const thread of threadFamily(threads, anchor)) visible.add(thread.id)
  // A just-created branch is anchored on the active thread; union it in so
  // the branch the user is watching is never the one node left off the map.
  if (active !== undefined && !visible.has(active.id)) {
    for (const thread of threadFamily(threads, active)) visible.add(thread.id)
  }
  return threads.filter(thread => visible.has(thread.id))
}

function workspaceChoices() {
  if (state.dshWorkspaces.length > 0) return state.dshWorkspaces.map(workspace => ({ ...workspace, source: 'dsh' }))
  return state.summaries.map(workspace => ({ id: workspace.id, title: workspace.title, path: workspace.cwd, sessionIds: [], source: 'projection' }))
}

/**
 * Fetch one workspace's graph, caching in-flight and recent results.
 *
 * The 1s poll calls this for every workspace. Caching the in-flight promise
 * collapses the concurrent calls of one tick into a single request, and the
 * settled value is kept briefly so a tick that repeats before anything changed
 * costs no request at all.
 */
const GRAPH_CACHE_MS = 1_500
const graphCache = new Map()
function invalidateGraphCache() {
  graphCache.clear()
}
function workspaceGraph(workspaceId) {
  const cached = graphCache.get(workspaceId)
  const summary = state.summaries.find(item => item.id === workspaceId)
  const revision = summary === undefined ? undefined : `${summary.revision ?? ''}:${summary.updatedAt ?? ''}:${summary.threadCount}`
  if (cached !== undefined && (revision !== undefined && cached.revision === revision || Date.now() - cached.at < GRAPH_CACHE_MS)) return cached.value
  const value = api(`/synapse/api/workspaces/${workspaceId}`).then(body => body.workspace)
  graphCache.set(workspaceId, { at: Date.now(), revision, value })
  // A failed fetch must not be cached: the next tick retries it.
  value.catch(() => { if (graphCache.get(workspaceId)?.value === value) graphCache.delete(workspaceId) })
  return value
}

/**
 * Whether a projected thread belongs to a workspace that has already loaded
 * its parent — by Synapse node id or by DSH's own parent session id.
 *
 * A just-forked child can land in the store before DSH adds it to
 * `workspace.sessionIds`. Following only `parentId` dropped those whose
 * Synapse parent link had not been written yet, so the branch card and its
 * connector vanished until the next poll.
 */
function isWorkspaceThreadDescendant(thread, loadedIds, loaded) {
  const parentId = thread.parentId ?? null
  if (parentId !== null && loadedIds.has(parentId)) return true
  const sourceParentSessionId = thread.sourceParentSessionId
  if (typeof sourceParentSessionId !== 'string' || sourceParentSessionId === '') return false
  return loaded.some(item => item.dshSessionId === sourceParentSessionId)
}

async function threadsForDshWorkspace(workspace) {
  const requested = new Set(workspace.sessionIds ?? [])
  // Only the current session's own graph can answer "is there anything to
  // draw", so an empty DSH session list is allowed to fall through to the
  // current-session lookup below instead of short-circuiting to a blank map.
  if (requested.size === 0 && state.currentDsh?.id === undefined && state.activeId === null) return []
  // Every workspace's full graph used to be fetched to find the sessions of
  // one workspace. v5 payloads are small, but the 1s poll still re-fetched all
  // of them, so the per-workspace graph is cached for the duration of a tick.
  const projections = await Promise.all(state.summaries.map(summary => workspaceGraph(summary.id)))
  const all = projections.flatMap(projection => projection.threads)
  const loaded = []
  const loadedIds = new Set()
  for (const thread of all) {
    if (!requested.has(thread.dshSessionId)) continue
    loaded.push(thread)
    loadedIds.add(thread.id)
  }
  // A just-forked child can land in the projection before DSH adds it to the
  // workspace session list. Keep those descendants so the map can draw them.
  let changed = true
  while (changed) {
    changed = false
    for (const thread of all) {
      if (loadedIds.has(thread.id) || !isWorkspaceThreadDescendant(thread, loadedIds, loaded)) continue
      loaded.push(thread)
      loadedIds.add(thread.id)
      changed = true
    }
  }
  // A session DSH no longer lists — one the user switched back to, or an
  // archived conversation — still owns a fork tree the map must draw.
  // Filtering strictly by the live session list dropped that whole family and
  // left the canvas empty ("无会话") for exactly the conversations that have
  // the most branches, so the current session's family is always kept.
  const anchorSessionIds = [state.currentDsh?.id, all.find(thread => thread.id === state.activeId)?.dshSessionId]
  for (const sessionId of anchorSessionIds) {
    if (typeof sessionId !== 'string' || sessionId === '') continue
    const anchor = all.find(thread => thread.dshSessionId === sessionId)
    if (anchor === undefined) continue
    for (const thread of threadFamily(all, anchor)) {
      if (loadedIds.has(thread.id)) continue
      loaded.push(thread)
      loadedIds.add(thread.id)
    }
  }
  return loaded
}

/**
 * Keep just-created branches that a workspace reload has not projected yet.
 *
 * Forking writes the node locally (and to the store) then the host immediately
 * re-sends the workspace list. That fetch can race `store.branch`: the new
 * session is missing, or it arrives as an unlinked root. Replacing
 * `state.workspace.threads` then drops the card and its connector until the
 * next poll. Re-attach the local parent/anchor, and keep pending/fresh forks
 * the fetch omitted.
 */
function keepLiveCanvasThreads(fetched, workspaceId = state.workspace?.id) {
  const local = state.workspace?.id === workspaceId ? [...state.workspace.threads] : []
  for (const operation of state.submissions?.values() ?? []) {
    if (operation.workspaceId === workspaceId && !local.some(thread => thread.id === operation.thread.id)) local.push(operation.thread)
  }
  if (local.length === 0) return fetched
  const localById = new Map(local.map(thread => [thread.id, thread]))
  const localBySession = new Map()
  for (const thread of local) {
    if (typeof thread.dshSessionId === 'string' && thread.dshSessionId !== '') localBySession.set(thread.dshSessionId, thread)
  }
  const adoptLink = (thread, localThread) => {
    if (localThread === undefined) return thread
    let next = thread
    if ((next.parentId === null || next.parentId === undefined) && localThread.parentId != null) next = { ...next, parentId: localThread.parentId }
    if ((next.sourceParentSessionId === null || next.sourceParentSessionId === undefined) && typeof localThread.sourceParentSessionId === 'string') next = { ...next, sourceParentSessionId: localThread.sourceParentSessionId }
    if ((next.anchorCardId === null || next.anchorCardId === undefined) && typeof localThread.anchorCardId === 'string') next = { ...next, anchorCardId: localThread.anchorCardId }
    if (!Number.isSafeInteger(next.sourceAnchorSeq) && Number.isSafeInteger(localThread.sourceAnchorSeq)) next = { ...next, sourceAnchorSeq: localThread.sourceAnchorSeq }
    return next
  }
  const merged = fetched.map(thread => {
    const next = adoptLink(thread, localById.get(thread.id) ?? (typeof thread.dshSessionId === 'string' ? localBySession.get(thread.dshSessionId) : undefined))
    const operation = state.pendingReplies.get(next.dshSessionId)
    if (operation?.thread !== undefined && operation.workspaceId === workspaceId && operation.thread.id !== next.id) replaceSubmissionThread(operation, next)
    return next
  })
  const seenIds = new Set(merged.map(thread => thread.id))
  const seenSessions = new Set(merged.map(thread => thread.dshSessionId).filter(id => typeof id === 'string' && id !== ''))
  const extras = []
  for (const thread of local) {
    if (seenIds.has(thread.id)) continue
    if (typeof thread.dshSessionId === 'string' && thread.dshSessionId !== '' && seenSessions.has(thread.dshSessionId)) continue
    const pending = state.pendingReplies.has(thread.dshSessionId) || state.pendingReplies.has(thread.id)
    if (!pending && !isFreshBlankFork(thread)) continue
    extras.push(thread)
    seenIds.add(thread.id)
    if (typeof thread.dshSessionId === 'string' && thread.dshSessionId !== '') seenSessions.add(thread.dshSessionId)
  }
  return extras.length === 0 ? merged : [...merged, ...extras]
}

async function openDshWorkspace(id, { renderAfter = true, preserveCanvasCamera = false } = {}) {
  const workspace = state.dshWorkspaces.find(item => item.id === id)
  if (workspace === undefined) return false
  const load = ++state.workspaceLoad
  const visibilityVersion = state.visibilityVersion
  state.selectedDshWorkspaceId = id
  const fetched = await threadsForDshWorkspace(workspace)
  if (load !== state.workspaceLoad) return true
  if (visibilityVersion !== state.visibilityVersion) return openDshWorkspace(id, { renderAfter, preserveCanvasCamera })
  const nextWorkspaceId = `dsh:${workspace.id}`
  for (const operation of state.submissions?.values() ?? []) {
    if (operation.workspaceId.startsWith('pending-workspace:') && operation.cwd === workspace.path) operation.workspaceId = nextWorkspaceId
  }
  const threads = keepLiveCanvasThreads(fetched, nextWorkspaceId)
  reconcilePendingReplies(threads)
  const nextLayout = threadsLayoutFingerprint(threads)
  const sameLayout = state.workspace?.id === nextWorkspaceId && nextLayout === state.workspaceThreadsFingerprint
  const content = JSON.stringify(threads)
  const contentChanged = state.workspace?.id !== nextWorkspaceId || content !== state.workspaceContentFingerprint
  if (state.workspace?.id !== nextWorkspaceId && !preserveCanvasCamera) resetCanvasCamera()
  state.workspace = { id: nextWorkspaceId, title: workspace.title, cwd: workspace.path, threads }
  state.workspaceThreadsFingerprint = nextLayout
  state.workspaceContentFingerprint = content
  const currentThread = currentDshThread(state.workspace.threads)
  // Keep the user's selection across poll reloads: a just-created branch is
  // anchored on it, and resetting to the current session here would drop the
  // branch's chain from `visibleThreads` a beat after it appeared. Real
  // session switches still move `activeId` — via the current-session message
  // handler, not this reload path.
  state.activeId = state.workspace.threads.some(thread => thread.id === state.activeId) ? state.activeId : (currentThread?.id ?? state.workspace.threads[0]?.id ?? null)
  const revealed = currentThread !== undefined && revealConversationThread(conversationCards(visibleThreads()), currentThread.id)
  // List ticks and the 1s poll reopen this workspace constantly. Remounting
  // the canvas there is what snapped the card inspector back to the top and
  // flashed every card scrollbar. Same graph → keep the live DOM.
  if (!sameLayout || contentChanged || revealed) state.canvasDirty = true
  if (renderAfter) flushCanvasRefresh()
  return true
}

async function openCurrentWorkspace({ preserveCanvasCamera = false } = {}) {
  const workspace = currentDshWorkspace()
  if (workspace === undefined || workspace.id === state.selectedDshWorkspaceId) return false
  return openDshWorkspace(workspace.id, { preserveCanvasCamera })
}

/**
 * A content fingerprint of the workspace summaries.
 *
 * The 1s poll used to compare `JSON.stringify(summaries)`, so any session
 * whose `updatedAt` moved (every live turn) looked like a change and triggered
 * a full re-fetch of every workspace. This fingerprint covers only the fields
 * that actually alter what the map shows, so an in-progress turn no longer
 * forces a reload on every tick.
 */
function summariesFingerprint(summaries) {
  return summaries.map(summary => `${summary.id}:${summary.title}:${summary.cwd ?? ''}:${summary.threadCount}:${summary.revision ?? ''}:${summary.updatedAt ?? ''}`).join('|')
}

function workspacesFingerprint(workspaces) {
  return (workspaces ?? []).map(workspace => `${workspace.id}:${workspace.title}:${workspace.path ?? ''}:${(workspace.sessionIds ?? []).join(',')}`).join('|')
}

function threadsLayoutFingerprint(threads) {
  return (threads ?? []).map(thread => {
    const turns = Array.isArray(thread.turns) ? thread.turns : []
    return `${thread.id}:${thread.parentId ?? ''}:${thread.dshSessionId ?? ''}:${turns.map((turn, index) => `${turn.seq ?? `i${index}`}:${turn.pending ? 1 : 0}`).join(',')}`
  }).join('|')
}

function nextLiveCardAnswer({ hasContent, hasPending, liveText, nextText }) {
  const text = typeof nextText === 'string' ? nextText : ''
  if (text === '') {
    if (hasContent) return hasPending ? { action: 'keep' } : { action: 'append-pending' }
    return { action: 'pending' }
  }
  if (liveText === text) return { action: 'keep' }
  return { action: 'replace', text }
}

function nextLiveReply(previous, running, nextText) {
  const text = typeof nextText === 'string' ? nextText : ''
  if (running === true) return { ...previous, running: true, text }
  const finalText = text !== '' ? text : (typeof previous?.text === 'string' ? previous.text : '')
  return finalText === '' ? null : { ...previous, running: false, text: finalText }
}

function projectedReplyHasSettled(thread, pending) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : []
  const target = Number.isSafeInteger(pending?.seq) ? turns.find(turn => turn.seq === pending.seq)
    : pending != null && typeof pending === 'object'
      ? turns.find((turn, index) => index >= (pending.baseCount ?? 0) && Number.isSafeInteger(turn.seq) && turn.seq > (pending.baseSeq ?? -1))
      : turns.at(-1)
  return target !== undefined && (['done', 'failed', 'cancelled'].includes(target.status) || Number.isSafeInteger(target.endSeq))
}

async function refreshSummaries({ renderAfter = true } = {}) {
  const before = summariesFingerprint(state.summaries)
  const revisions = new Map(state.summaries.map(summary => [summary.id, summariesFingerprint([summary])]))
  const body = await api('/synapse/api/workspaces')
  state.summaries = body.workspaces
  const changed = before !== summariesFingerprint(state.summaries)
  if (changed) {
    for (const summary of state.summaries) {
      if (revisions.get(summary.id) !== summariesFingerprint([summary])) graphCache.delete(summary.id)
    }
  }
  const current = state.workspace?.id
  if (state.selectedDshWorkspaceId === null && typeof current === 'string' && !current.startsWith('pending-workspace:') && !state.summaries.some(item => item.id === current)) state.workspace = null
  const selected = selectedDshWorkspace()
  if (selected !== undefined && (changed || state.workspace === null)) await openDshWorkspace(selected.id, { renderAfter })
  else if (state.workspace === null && state.summaries.length > 0) {
    // Never fall back to an arbitrary workspace: `state.summaries` is in store
    // order, so summaries[0] is some unrelated project (measured: e-pi, 3
    // threads) — opening it flashed a foreign conversation onto the canvas and
    // left the real one unresolvable. Prefer the projection whose cwd matches
    // the current session; otherwise wait for the host's workspace list.
    const cwd = state.currentDsh?.cwd
    const match = typeof cwd === 'string' && cwd !== '' ? state.summaries.find(summary => summary.cwd === cwd) : undefined
    if (match !== undefined) await openWorkspace(match.id, { renderAfter })
  }
  else if (renderAfter && changed && canReplaceView()) render()
  return changed
}

async function openWorkspace(id, { renderAfter = true } = {}) {
  const load = ++state.workspaceLoad
  const visibilityVersion = state.visibilityVersion
  const body = await api(`/synapse/api/workspaces/${id}`)
  if (load !== state.workspaceLoad) return
  if (visibilityVersion !== state.visibilityVersion) return openWorkspace(id, { renderAfter })
  if (state.workspace?.id !== body.workspace.id) resetCanvasCamera()
  state.workspace = { ...body.workspace, threads: keepLiveCanvasThreads(body.workspace.threads, body.workspace.id) }
  reconcilePendingReplies(state.workspace.threads)
  state.activeId = state.workspace.threads.some(thread => thread.id === state.activeId) ? state.activeId : state.workspace.threads[0]?.id ?? null
  state.canvasDirty = true
  if (renderAfter) flushCanvasRefresh()
}

async function refreshProjection() {
  const summariesChanged = await refreshSummaries({ renderAfter: false })
  if (summariesChanged && state.workspace !== null && state.selectedDshWorkspaceId === null && !state.workspace.id.startsWith('pending-workspace:')) {
    await openWorkspace(state.workspace.id, { renderAfter: false })
  }
  if (state.inspectorCardId !== null) {
    const thread = state.workspace?.threads.find(item => turnForCardId(item, state.inspectorCardId) !== null)
    if (thread !== undefined) {
      await loadThreadHistory(thread, state.inspectorCardId)
      state.canvasDirty = true
    }
  }
  flushCanvasRefresh()
  return summariesChanged
}

async function refreshCompletedReply(sessionId, question, attempt = 0) {
  try {
    invalidateGraphCache()
    const workspaceId = state.selectedDshWorkspaceId ?? currentDshWorkspace()?.id
    if (typeof workspaceId === 'string' && workspaceId !== '') {
      await openDshWorkspace(workspaceId, { renderAfter: false, preserveCanvasCamera: true })
    } else if (typeof state.workspace?.id === 'string' && !state.workspace.id.startsWith('dsh:')) {
      await openWorkspace(state.workspace.id, { renderAfter: false })
    }
  } catch {
    // The projection queue may still be committing this final event. The
    // bounded retry below will read it once the in-memory store catches up.
  }
  const thread = state.workspace?.threads.find(item => item.dshSessionId === sessionId)
  const pending = state.pendingReplies.get(sessionId)
  const settled = projectedReplyHasSettled(thread, pending)
  if (settled) {
    state.pendingReplies.delete(sessionId)
    state.liveReplies.delete(sessionId)
  }
  requestCanvasRefresh()
  if (!settled && attempt < 2) {
    const delay = attempt === 0 ? 250 : 750
    window.setTimeout(() => { void refreshCompletedReply(sessionId, question, attempt + 1) }, delay)
  }
}

function openNewSession() {
  if (state.draft !== null) return
  state.mode = 'canvas'
  state.activeId = null
  state.selectedCardId = null
  state.inspectorCardId = null
  state.inspectorOpening = false
  state.quickPhraseEditorOpen = false
  state.draft = { kind: 'new', text: '', sending: false }
  state.error = ''
  resetCanvasCamera()
  render()
  window.setTimeout(() => document.querySelector('[data-draft] textarea')?.focus(), 0)
}

function focusDraftInput() {
  const input = document.querySelector('[data-draft] textarea')
  if (!(input instanceof HTMLTextAreaElement)) return
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
}

function openContinue(parent, anchorId = undefined, text = '') {
  if (parent.dshSessionId === null) return setError('该节点没有关联的 DSH 会话')
  if (state.pendingReplies.has(parent.dshSessionId) || sessionStatusFor(parent)?.running === true) return setError('请等待本轮完成后继续追问')
  state.activeId = parent.id
  state.quickPhraseEditorOpen = false
  state.draft = { kind: 'continue', parentId: parent.id, anchorId, text, sending: false }
  render()
  window.setTimeout(focusDraftInput, 0)
}

function branchTargetFor(thread, cardId) {
  const turns = turnsFor(thread)
  const turn = turns.find((item, index) => (item.cardId ?? `${thread.id}:turn:${item.seq ?? `i${index}`}`) === cardId)
  if (turn === undefined || turn.pending === true) throw new Error('无法定位分支来源卡片，请刷新后重试')
  return {
    seq: turn.seq,
    reference: {
      messageId: turn.messageId,
      question: turn.question,
      root: thread.parentId === null && thread.sourceParentSessionId == null,
      unique: turns.filter(item => item.question === turn.question).length === 1,
    },
  }
}

function openBranch(parent, anchorId) {
  if (parent.dshSessionId === null) return setError('该节点没有关联的 DSH 会话')
  const target = branchTargetFor(parent, anchorId)
  state.activeId = parent.id
  state.quickPhraseEditorOpen = false
  state.draft = { kind: 'branch', parentId: parent.id, anchorId, target, text: '', sending: false }
  render()
  window.setTimeout(() => document.querySelector('[data-draft] textarea')?.focus(), 0)
}

async function sendMessage(thread, text) {
  if (thread.dshSessionId === null) throw new Error('该节点没有关联的 DSH 会话')
  if (state.pendingReplies.has(thread.dshSessionId)) throw new Error('该会话正在回复，请稍后再发送')
  state.draft = { kind: 'continue', parentId: thread.id, text, sending: false }
  await submitDraft()
}

async function submitDraft() {
  const draft = state.draft
  const text = draft?.text.trim()
  if (draft == null || draft.sending || !text) return
  const parent = state.workspace?.threads.find(thread => thread.id === draft.parentId)
  if (draft.kind !== 'new' && parent === undefined) return setError('来源会话不存在')
  if (draft.kind === 'continue' && state.pendingReplies.has(parent.dshSessionId)) return setError('请先等待当前提交完成，或重试失败的卡片')
  const target = draft.kind === 'branch' ? draft.target ?? branchTargetFor(parent, draft.anchorId) : undefined
  const position = draft.kind === 'new' ? { x: 86, y: 82 } : draftPlacement(conversationCards(visibleThreads()))?.position
  const id = crypto.randomUUID()
  if (state.workspace === null) {
    state.workspace = { id: `pending-workspace:${id}`, title: '新会话', cwd: state.currentDsh?.cwd ?? null, threads: [] }
  }
  const workspace = state.workspace
  const anchor = state.canvasCardsById?.get(draft.anchorId)
  const thread = draft.kind === 'continue' ? parent : {
    id: `pending:${id}`, title: text.slice(0, 42),
    parentId: parent?.id ?? null, sourceParentSessionId: parent?.dshSessionId ?? null,
    dshSessionId: null, anchorCardId: draft.anchorId,
    color: parent?.color ?? '#3478f6', position,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    turns: [], optimistic: true,
  }
  const operation = {
    id, cardId: `submission:${id}`, text, at: Date.now(), kind: draft.kind,
    workspace, workspaceId: workspace.id, hostWorkspaceId: state.selectedDshWorkspaceId,
    cwd: workspace.cwd ?? state.currentDsh?.cwd,
    parentId: parent?.id, parentSessionId: parent?.dshSessionId,
    anchorId: draft.anchorId, target,
    sourceAnchorSeq: anchor?.answerSeq ?? anchor?.sourceSeq,
    position, thread, sessionId: thread.dshSessionId,
    baseSeq: Math.max(-1, ...(thread.turns ?? []).map(turn => Number.isSafeInteger(turn.seq) ? turn.seq : -1)),
    baseCount: (thread.turns ?? []).length,
    phase: draft.kind === 'continue' ? 'queued' : 'creating',
  }
  state.submissions ??= new Map()
  state.submissions.set(id, operation)
  if (draft.kind !== 'continue') workspace.threads.push(thread)
  state.pendingReplies.set(thread.dshSessionId ?? thread.id, operation)
  draft.sending = true
  state.draft = null
  state.activeId = thread.id
  state.selectedCardId = operation.cardId
  state.error = ''
  revealConversationThread(conversationCards(visibleThreads()), thread.id)
  render()
  revealThreadLatestCard(thread.id)
  await runSubmission(operation)
}

function replaceSubmissionThread(operation, nextThread) {
  const previousId = operation.thread.id
  operation.thread = nextThread
  const lane = state.layoutLanes?.get(previousId)
  if (lane !== undefined) {
    state.layoutLanes.set(nextThread.id, lane)
    if (previousId !== nextThread.id) state.layoutLanes.delete(previousId)
  }
  const owners = new Set([operation.workspace])
  if (state.workspace?.id === operation.workspaceId) owners.add(state.workspace)
  for (const workspace of owners) {
    const index = workspace.threads.findIndex(thread => thread.id === previousId || thread.dshSessionId === nextThread.dshSessionId && nextThread.dshSessionId !== null)
    workspace.threads = workspace.threads.filter((thread, at) => at === index || (thread.id !== previousId && (nextThread.dshSessionId === null || thread.dshSessionId !== nextThread.dshSessionId)))
    if (index === -1) workspace.threads.push(nextThread)
    else {
      const kept = workspace.threads.findIndex(thread => thread.id === previousId || thread.dshSessionId === nextThread.dshSessionId)
      workspace.threads[kept] = nextThread
    }
  }
  if (state.workspace?.id === operation.workspaceId && state.activeId === previousId) state.activeId = nextThread.id
}

async function runSubmission(operation) {
  if (operation.inFlight) return
  operation.inFlight = true
  operation.error = null
  try {
    if (operation.sessionId === null) {
      operation.phase = 'creating'
      const session = operation.kind === 'branch'
        ? await dshRpc('synapse:fork-session', { operationId: operation.id, sessionId: operation.parentSessionId, target: operation.target })
        : await dshRpc('synapse:create-session', { operationId: operation.id, workspaceId: operation.hostWorkspaceId, cwd: operation.cwd })
      operation.sessionId = session.id
      if (Number.isSafeInteger(session.sourceAnchorSeq)) operation.sourceAnchorSeq = session.sourceAnchorSeq
      state.pendingReplies.delete(operation.thread.id)
      state.pendingReplies.set(session.id, operation)
      replaceSubmissionThread(operation, { ...operation.thread, dshSessionId: session.id, dshSessionTitle: session.title })
    }
    if (operation.kind === 'branch' && !operation.linked) {
      rememberBranchAnchor(operation.sessionId, operation.anchorId)
      const result = await api(`/synapse/api/threads/${operation.parentId}/branch`, {
        method: 'POST',
        body: JSON.stringify({
          title: operation.text.slice(0, 42), dshSessionId: operation.sessionId,
          position: operation.position, anchorCardId: operation.anchorId,
          sourceAnchorSeq: operation.sourceAnchorSeq,
        }),
      })
      replaceSubmissionThread(operation, { ...result.thread, anchorCardId: result.thread.anchorCardId ?? operation.anchorId, sourceParentSessionId: operation.parentSessionId })
      operation.linked = true
    }
    operation.phase = 'queued'
    if (!operation.cursorRead) {
      try {
        const cursor = await api('/synapse/api/turn-cursor', { method: 'POST', body: JSON.stringify({ sessionId: operation.sessionId }) })
        // A migrated log can have smaller seqs than the cached canvas.
        if (Number.isSafeInteger(cursor.lastUserSeq)) operation.baseSeq = cursor.lastUserSeq
      } catch (error) {
        // A client HMR can precede a host reload. Only an absent route uses
        // the already captured baseline; an unreadable session is an error.
        if (error?.status !== 404 || error?.message !== '接口不存在') throw error
      }
      operation.cursorRead = true
    }
    if (state.workspace?.id === operation.workspaceId) requestCanvasRefresh()
    await dshRpc('synapse:send-message', { operationId: operation.id, sessionId: operation.sessionId, text: operation.text })
    operation.accepted = true
    void refreshProjection().catch(() => {})
  } catch (error) {
    operation.phase = 'failed'
    operation.error = error instanceof Error ? error.message : String(error)
    if (state.workspace?.id === operation.workspaceId) {
      state.error = operation.error
      requestCanvasRefresh()
    }
  } finally {
    operation.inFlight = false
  }
}

function threadsById() { return new Map((state.workspace?.threads ?? []).map(thread => [thread.id, thread])) }

/**
 * The turn cards to render for one thread.
 *
 * v5 stores the cards themselves, so this is normally the stored list. While a
 * message the user just sent is still in flight (DSH has not committed its
 * events yet), the pending question and its streaming answer are appended as a
 * synthetic tail card so the canvas never blinks back to the previous turn.
 */
function pendingReplyFor(thread) {
  const bySession = state.pendingReplies.get(thread.dshSessionId)
  if (bySession !== undefined) return { key: thread.dshSessionId, pending: bySession }
  const byThread = state.pendingReplies.get(thread.id)
  if (byThread !== undefined) return { key: thread.id, pending: byThread }
  return undefined
}

function pendingTurnIndex(turns, pending) {
  if (Number.isSafeInteger(pending.seq)) return turns.findIndex(turn => turn.seq === pending.seq)
  if (typeof pending.messageId === 'string') return turns.findIndex(turn => turn.messageId === pending.messageId)
  const baseline = Number.isSafeInteger(pending.baseSeq) ? pending.baseSeq : -1
  const count = Number.isInteger(pending.baseCount) ? pending.baseCount : 0
  return turns.findIndex((turn, index) => index >= count && Number.isSafeInteger(turn.seq) && turn.seq > baseline)
}

function turnsFor(thread) {
  const turns = (Array.isArray(thread.turns) ? thread.turns : []).map(turn => {
    const id = state.cardIds?.get(`${thread.dshSessionId}:${turn.seq}`)
    return id === undefined ? turn : { ...turn, cardId: id }
  })
  const found = pendingReplyFor(thread)
  if (found === undefined) return turns
  const { key, pending } = found
  const projectedIndex = pendingTurnIndex(turns, pending)
  if (projectedIndex !== -1) {
    turns[projectedIndex] = { ...turns[projectedIndex], cardId: pending.cardId ?? turns[projectedIndex].cardId }
    return turns
  }
  const live = state.liveReplies.get(key)
  const tail = {
    seq: null,
    cardId: pending.cardId,
    operationId: pending.id,
    at: new Date(pending.at).toISOString(),
    question: pending.text,
    human: true,
    answer: typeof live?.text === 'string' && live.text !== '' ? live.text : null,
    answerSeq: null,
    error: pending.error ?? null,
    status: pending.phase === 'failed' ? 'failed'
      : pending.phase === 'creating' ? 'creating'
        : pending.phase === 'running' ? 'running' : 'queued',
    processCount: 0,
    processIds: [],
    pending: pending.phase !== 'failed' && live?.running !== false,
  }
  return [...turns, tail]
}

function reconcilePendingReplies(threads) {
  let identitiesChanged = false
  for (const thread of threads) {
    const found = pendingReplyFor(thread)
    if (found === undefined) continue
    const { key, pending } = found
    const turns = thread.turns ?? []
    const index = pendingTurnIndex(turns, pending)
    if (index === -1) continue
    const turn = turns[index]
    pending.seq = turn.seq
    if (pending.cardId !== undefined) {
      const identity = `${thread.dshSessionId}:${turn.seq}`
      state.cardIds ??= new Map()
      if (state.cardIds.get(identity) !== pending.cardId) {
        state.cardIds.set(identity, pending.cardId)
        identitiesChanged = true
      }
    }
    const finalText = typeof pending.finalText === 'string' ? pending.finalText : ''
    const legacySettled = turn.status === undefined && pending.completed === true
      && (turn.error != null || typeof turn.answer === 'string' && finalText !== ''
        && (turn.answer === finalText || turn.answer.endsWith('…') && finalText.startsWith(turn.answer.slice(0, -1))))
    if (legacySettled || ['done', 'failed', 'cancelled'].includes(turn.status) || Number.isSafeInteger(turn.endSeq)) {
      state.pendingReplies.delete(key)
      state.liveReplies.delete(key)
      state.submissions?.delete(pending.id)
    } else if (pending.phase !== 'failed') pending.phase = 'running'
  }
  if (identitiesChanged) {
    try { localStorage.setItem('dsh-synapse:card-identities:v1', JSON.stringify([...state.cardIds])) } catch { /* Visual identities remain in memory. */ }
  }
}

function persistedMessagesFor(thread) { return state.historyBySession.get(thread.dshSessionId) ?? thread.messages ?? [] }

function latestMessage(thread, kind) {
  const turns = turnsFor(thread)
  if (kind === 'user') {
    const question = turns.at(-1)?.question
    return question === undefined || question === '' ? undefined : { text: question, sourceSeq: turns.at(-1)?.seq }
  }
  const turn = [...turns].reverse().find(item => item.answer !== null && item.answer !== undefined)
  return turn === undefined ? undefined : { text: turn.answer, sourceSeq: turn.answerSeq }
}

function questionFor(thread) {
  const latest = latestMessage(thread, 'user')?.text
  if (isHumanCardQuestion(latest)) return latest
  return firstUserQuestion(thread) ?? '等待用户提问'
}
function answerFor(thread) { return latestMessage(thread, 'assistant') ?? null }

// Inline formatting is applied to already-escaped text, so every rule below
// matches against entity references (&quot;, &amp; …) rather than raw
// characters — and must never produce markup the escaping removed.
function inlineMarkdown(text) {
  return escapeHtml(text)
    // A code span wins over every other rule: `**` inside backticks is literal.
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    // [label](url) — the url is scheme-checked, so a `javascript:` target can
    // never become a clickable link in a rendered answer.
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, url) => (safeLinkUrl(url) === null ? match : `<a href="${safeLinkUrl(url)}" target="_blank" rel="noreferrer noopener">${label}</a>`))
}

/**
 * A link target that is safe to put in an href.
 *
 * Rendered answers are assembled from escaped HTML, so a single permissive
 * link rule would be the one place an attacker-chosen scheme reaches the DOM.
 * Only http(s), mailto and same-page anchors are allowed; everything else is
 * left as literal text.
 */
function safeLinkUrl(rawUrl) {
  const url = String(rawUrl ?? '').trim()
  if (url === '' || /[^\x21-\x7e]/.test(url)) return null
  if (/^(https?:\/\/|mailto:)/i.test(url)) return url
  if (url.startsWith('#')) return url
  if (/^[\w./-]+$/.test(url) && !url.includes(':')) return url
  return null
}

const tableCells = line => {
  const trimmed = String(line ?? '').trim()
  if (trimmed === '' || !trimmed.includes('|')) return []
  return trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
}

const isTableDelimiter = line => {
  const cells = tableCells(line)
  return cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell.replace(/\s+/g, '')))
}

const tableAlignments = line => tableCells(line).map(cell => {
  const mark = cell.replace(/\s+/g, '')
  const left = mark.startsWith(':')
  const right = mark.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  return 'left'
})

const isStructuralBoundary = line => /^ {0,3}#{1,6}\s+/.test(line)
  || /^ {0,3}[-*+]\s+/.test(line)
  || /^ {0,3}\d+[.)]\s+/.test(line)
  || isQuoteLine(line)
  || isHorizontalRule(line)

const isTableRow = line => {
  if (typeof line !== 'string' || isStructuralBoundary(line)) return false
  return tableCells(line).length >= 2
}

function renderMarkdownTable(headerLine, bodyLines, alignments) {
  const headers = tableCells(headerLine)
  if (headers.length === 0) return ''
  const aligns = Array.isArray(alignments) ? alignments : headers.map(() => 'left')
  const alignClass = index => {
    const align = aligns[index] ?? 'left'
    return align === 'left' ? '' : ` class="md-table-${align}"`
  }
  const cellsOf = row => headers.map((_, index) => tableCells(row)[index] ?? '')
  const head = headers.map((cell, index) => `<th${alignClass(index)}>${inlineMarkdown(cell)}</th>`).join('')
  const body = bodyLines.map(row => `<tr>${cellsOf(row).map((cell, index) => `<td${alignClass(index)}>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')
  return `<div class="md-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

function takeTable(lines, index) {
  const line = lines[index]
  if (!isTableRow(line) || index + 1 >= lines.length) return null
  const next = lines[index + 1]
  if (isTableDelimiter(next) && tableCells(next).length > 0) {
    const alignments = tableAlignments(next)
    const body = []
    let cursor = index + 2
    while (cursor < lines.length && isTableRow(lines[cursor]) && !isTableDelimiter(lines[cursor])) {
      body.push(lines[cursor])
      cursor += 1
    }
    return { html: renderMarkdownTable(line, body, alignments), next: cursor }
  }
  // Fallback: two or more pipe rows with the same column count, even when the
  // model omitted the GFM delimiter. A single `A | B` line stays a paragraph.
  const columns = tableCells(line).length
  if (!isTableRow(next) || isTableDelimiter(next) || tableCells(next).length !== columns) return null
  const body = [next]
  let cursor = index + 2
  while (cursor < lines.length && isTableRow(lines[cursor]) && !isTableDelimiter(lines[cursor]) && tableCells(lines[cursor]).length === columns) {
    body.push(lines[cursor])
    cursor += 1
  }
  return { html: renderMarkdownTable(line, body), next: cursor }
}

function headingPlainText(text) {
  return String(text ?? '').replace(/[`*_~]/g, '').trim()
}

function markdownHeadings(text) {
  const headings = []
  let index = 0
  const parts = String(text ?? '').split(/```/)
  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    if (partIndex % 2 === 1) continue
    for (const line of parts[partIndex].split('\n')) {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line)
      if (heading === null) continue
      index += 1
      headings.push({ id: `md-h-${index}`, level: heading[1].length, text: headingPlainText(heading[2]) })
    }
  }
  return headings
}

const isHorizontalRule = line => /^ {0,3}(?:-[ \t]*){3,}$/.test(line) || /^ {0,3}(?:\*[ \t]*){3,}$/.test(line) || /^ {0,3}(?:_[ \t]*){3,}$/.test(line)

/**
 * A setext heading: a line of text underlined by `===` (h1) or `---` (h2).
 *
 * `---` is ambiguous — it is also a thematic break — and the difference is
 * whether a paragraph sits directly above it. Checking that here keeps
 * `标题\n---` a heading while an `---` after a blank line stays a rule. Markdown
 * sources produce both constantly, and treating every `---` as a rule is what
 * turned documents' section titles into loose paragraphs.
 */
const setextUnderlineOf = line => {
  if (/^ {0,3}=+[ \t]*$/.test(line)) return 1
  if (/^ {0,3}(?:-[ \t]*){3,}$/.test(line)) return 2
  return null
}

// Block-level openers, checked in order by the parser below. A line that is
// none of these continues whatever block is already open.
const QUOTE_LINE = /^ {0,3}>\s?/
const isQuoteLine = line => QUOTE_LINE.test(line)
const isBlockOpener = line => /^#{1,6}\s+/.test(line)
  || /^ {0,3}[-*+]\s+/.test(line)
  || /^ {0,3}\d+[.)]\s+/.test(line)
  || isHorizontalRule(line)
  || isQuoteLine(line)

// List items in the wild are indented by continuation text (`- a\n  b`) and by
// nesting (`  - a`). Indenting the marker by up to one tab keeps a nested list
// nested instead of flattening it into the paragraph above.
const LIST_INDENT = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/
const listIndentOf = line => {
  const match = LIST_INDENT.exec(line)
  if (match === null) return null
  // A tab counts as a nesting level; anything wider is a code block, not a list.
  const indent = match[1].replace(/\t/g, '  ').length
  if (indent > 3) return null
  return { indent, ordered: /\d/.test(match[2]), text: match[3], marker: match[2] }
}

/**
 * Render one list, recursing into the items' own body.
 *
 * A list item is not one line: `- 标题` is usually followed by an indented
 * paragraph, a nested list, or a code block. Flattening those into the item's
 * first line is what made rendered answers look like one dense wall of text,
 * so an item collects its continuation lines and re-parses them as blocks.
 *
 * @returns `{ html, next }` — the markup and the next unparsed line index.
 */
function renderMarkdownList(lines, index, baseIndent) {
  const first = listIndentOf(lines[index])
  const ordered = first.ordered
  const start = /^\d+$/.test(first.marker) ? Number(first.marker) : Number.parseInt(first.marker, 10)
  const items = []
  while (index < lines.length) {
    const item = listIndentOf(lines[index])
    if (item === null || item.indent > baseIndent) break
    if (item.indent < baseIndent) break
    // A different marker at the same depth starts a NEW list (`-` then `*`).
    if (items.length > 0 && (item.ordered !== ordered || item.indent !== baseIndent)) break
    const body = [item.text]
    index += 1
    // Two blank lines end the list; one blank line only ends it when the next
    // line is not indented continuation.
    let blankRun = 0
    while (index < lines.length) {
      const line = lines[index]
      if (line.trim() === '') {
        blankRun += 1
        if (blankRun > 1) { index += 1; break }
        const following = lines[index + 1]
        const continuation = following !== undefined && following.trim() !== '' && /^\s{2,}/.test(following.replace(/\t/g, '  '))
        if (!continuation) break
        body.push('')
        index += 1
        continue
      }
      // Any block opener at column 0 ends the item; indented openers continue.
      const indent = /^[ \t]*/.exec(line)[0].replace(/\t/g, '  ').length
      if (indent <= baseIndent && isBlockOpener(line)) break
      if (indent <= baseIndent && listIndentOf(line) !== null) break
      blankRun = 0
      body.push(line.slice(Math.min(line.length, baseIndent + 2)))
      index += 1
    }
    items.push(`<li>${markdownBlock(body.join('\n'))}</li>`)
  }
  const tag = ordered ? 'ol' : 'ul'
  // A list that starts at 3 must stay numbered from 3. Rendering every list
  // from 1 renumbers the author's own steps, which reads as a different answer.
  const startAttribute = ordered && Number.isSafeInteger(start) && start !== 1 ? ` start="${start}"` : ''
  return { html: `<${tag}${startAttribute}>${items.join('')}</${tag}>`, next: index }
}

let headingCounter = 0
function markdownBlock(text) {
  const lines = text.split('\n')
  const output = []
  for (let index = 0; index < lines.length;) {
    const line = lines[index]
    if (line.trim() === '') { index++; continue }
    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading !== null) {
      const level = heading[1].length
      headingCounter += 1
      output.push(`<h${level} id="md-h-${headingCounter}">${inlineMarkdown(heading[2])}</h${level}>`)
      index++
      continue
    }
    if (isHorizontalRule(line)) { output.push('<hr>'); index++; continue }
    if (isQuoteLine(line)) {
      // A blockquote is a document in miniature: headings, lists, code and
      // nested quotes all appear inside it. Strip the marker and re-parse.
      const inner = []
      while (index < lines.length) {
        const current = lines[index]
        if (current.trim() !== '' && !isQuoteLine(current)) break
        inner.push(current.replace(QUOTE_LINE, ''))
        index++
      }
      output.push(`<blockquote>${markdownBlock(inner.join('\n'))}</blockquote>`)
      continue
    }
    const item = listIndentOf(line)
    if (item !== null) {
      const list = renderMarkdownList(lines, index, item.indent)
      output.push(list.html)
      index = list.next
      continue
    }
    const table = takeTable(lines, index)
    if (table !== null) {
      output.push(table.html)
      index = table.next
      continue
    }
    const paragraph = []
    // A paragraph runs until a blank line or the start of another block. A
    // single newline inside it is a soft break: keeping it as a newline (rather
    // than joining the lines) preserves the author's line structure, and the
    // CSS's white-space: pre-wrap renders it without needing <br>.
    while (index < lines.length) {
      const current = lines[index]
      const trimmed = current.trim()
      if (trimmed === '') break
      const indent = /^[ \t]*/.exec(current)[0].replace(/\t/g, '  ').length
      if (paragraph.length > 0 && (isBlockOpener(current) || (indent <= 3 && listIndentOf(current) !== null) || isTableRow(current))) break
      paragraph.push(current)
      index++
    }
    // A single-line paragraph followed by `===`/`---` is a setext heading. The
    // paragraph is rewritten into the heading rather than emitted separately.
    if (paragraph.length === 1) {
      const level = setextUnderlineOf(lines[index] ?? '')
      if (level !== null) {
        headingCounter += 1
        output.push(`<h${level} id="md-h-${headingCounter}">${inlineMarkdown(paragraph[0].trim())}</h${level}>`)
        index += 1
        continue
      }
    }
    // A marker-only line such as PowerShell's "+ " diagnostic is neither a
    // list item nor paragraph content under the rules above. Consume it so
    // the parser always makes progress.
    if (paragraph.length === 0) { paragraph.push(lines[index]); index++ }
    output.push(`<p>${paragraph.map(inlineMarkdown).join('\n')}</p>`)
  }
  return output.join('')
}

// Markdown parsing is pure CPU and repeats for every card on every canvas
// rebuild; cache the rendered HTML by input text so stable answers are never
// re-parsed. Bounded: streaming partial texts churn keys, so evict oldest.
const markdownCache = new Map()
const MARKDOWN_CACHE_LIMIT = 5000
/**
 * Render markdown into HTML.
 *
 * Cached by input text: parsing is pure CPU and repeats for every card on every
 * canvas rebuild. Bounded — streaming partial texts churn keys, so the oldest
 * entry is evicted when the cache fills.
 */
function renderMarkdown(text) {
  const key = String(text)
  const cached = markdownCache.get(key)
  if (cached !== undefined) return cached
  headingCounter = 0
  // Splitting on ``` is what makes fenced code a leaf: everything between an
  // odd and even fence is emitted verbatim, so prose inside a code sample can
  // never be mistaken for a heading or a list.
  const parts = key.split(/```/)
  const rendered = parts.map((part, index) => {
    if (index % 2 === 0) return markdownBlock(part)
    // The fence's info string (` ```js `) names the language; it is metadata,
    // not code, so it is stripped and surfaced as a label instead of being
    // rendered as the first line of the sample.
    const newline = part.indexOf('\n')
    const info = newline === -1 ? part.trim() : part.slice(0, newline).trim()
    const code = newline === -1 ? '' : part.slice(newline + 1)
    const language = /^[\w+#.-]{1,16}$/.test(info) ? info : ''
    const attribute = language === '' ? '' : ` data-lang="${escapeHtml(language)}"`
    return `<pre${attribute}><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`
  }).join('')
  if (markdownCache.size >= MARKDOWN_CACHE_LIMIT) markdownCache.delete(markdownCache.keys().next().value)
  markdownCache.set(key, rendered)
  return rendered
}

function overlapsCard(position, other) {
  return position.x < other.x + CARD_WIDTH && position.x + CARD_WIDTH > other.x
    && position.y < other.y + CARD_HEIGHT && position.y + CARD_HEIGHT > other.y
}

function overlapsHorizontalRange(left, right, otherLeft, otherRight) {
  return left < otherRight && right > otherLeft
}

function firstAvailableCardPosition(position, occupied) {
  const candidate = { x: Math.round(position.x), y: Math.max(82, Math.round(position.y)) }
  while (true) {
    const collisions = occupied.filter(other => overlapsCard(candidate, other))
    if (collisions.length === 0) return candidate
    candidate.y = Math.max(...collisions.map(other => other.y + CARD_HEIGHT + CARD_GAP_Y))
  }
}

function canvasNodeBounds(card) {
  const width = card.hidden === true ? 148 : CARD_WIDTH
  const height = card.hidden === true ? 32 : CARD_HEIGHT
  return {
    x: card.position.x + (CARD_WIDTH - width) / 2,
    y: card.position.y + (CARD_HEIGHT - height) / 2,
    width, height,
  }
}

function connectorPath(fromPosition, toPosition) {
  const fromX = fromPosition.x + (fromPosition.width ?? CARD_WIDTH)
  const fromY = fromPosition.y + (fromPosition.height ?? CARD_HEIGHT) / 2
  const toX = toPosition.x
  const toY = toPosition.y + (toPosition.height ?? CARD_HEIGHT) / 2
  const bend = Math.min(110, Math.max(36, Math.abs(toX - fromX) * .2))
  return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`
}

function connectorPathFromElements(fromCard, toCard) {
  const fromX = Number.parseFloat(fromCard.style.left) + CARD_WIDTH
  const fromY = Number.parseFloat(fromCard.style.top) + CARD_HEIGHT / 2
  const toX = Number.parseFloat(toCard.style.left)
  const toY = Number.parseFloat(toCard.style.top) + CARD_HEIGHT / 2
  if (![fromX, fromY, toX, toY].every(Number.isFinite)) return null
  const bend = Math.min(110, Math.max(36, Math.abs(toX - fromX) * .2))
  return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`
}

function selectorValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// Connector paths are rebuilt together with the canvas DOM; cache the mapping
// from card id to its incident paths so dragging never scans the whole SVG.
let connectorPathsByCard = new Map()
function cacheCardConnectors() {
  connectorPathsByCard = new Map()
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return
  for (const path of viewport.querySelectorAll('.connectors path[data-from]')) {
    const fromId = path.getAttribute('data-from')
    const toId = path.getAttribute('data-to')
    if (fromId === null || toId === null) continue
    for (const id of [fromId, toId]) {
      const paths = connectorPathsByCard.get(id)
      if (paths === undefined) connectorPathsByCard.set(id, new Set([path]))
      else paths.add(path)
    }
  }
}

function refreshCardConnectors(cardId) {
  const paths = connectorPathsByCard.get(cardId)
  if (paths === undefined || paths.size === 0) return
  const byId = state.canvasCardsById
  if (byId === undefined) return
  for (const path of paths) {
    const fromId = path.getAttribute('data-from')
    const toId = path.getAttribute('data-to')
    if (fromId === null || toId === null) continue
    const fromCard = byId.get(fromId)
    const toCard = byId.get(toId)
    if (fromCard === undefined || toCard === undefined) continue
    // Data-driven endpoints: the counterpart card may be unmounted (outside
    // the viewport) but its position is still authoritative.
    const from = canvasNodeBounds(fromCard)
    const to = canvasNodeBounds(toCard)
    path.setAttribute('d', connectorPath(from, to))
    const svg = path.ownerSVGElement
    if (svg instanceof SVGSVGElement) {
      const box = connectorLinkBox(from, to)
      svg.style.left = `${box.left}px`
      svg.style.top = `${box.top}px`
      svg.style.width = `${box.width}px`
      svg.style.height = `${box.height}px`
      svg.setAttribute('viewBox', `${box.left} ${box.top} ${box.width} ${box.height}`)
    }
  }
}

function initialCanvasCamera(cards) {
  const draft = state.draft?.kind === 'new' ? { id: 'draft:new', position: { x: 86, y: 82 } } : draftPlacement(cards)
  // Focus the active conversation's latest turn, not its first: after many
  // rounds the canvas should open where work is happening, at the newest card.
  const activeCards = state.activeId === null || state.activeId === undefined ? [] : cards.filter(card => card.dshThreadId === state.activeId)
  const active = activeCards.at(-1)
  const focus = draft ?? active ?? cards[0]
  const position = focus?.position
  if (position === undefined) return { x: 0, y: 0 }
  return { x: CAMERA_INSET_X - position.x * state.zoom, y: CAMERA_INSET_Y - position.y * state.zoom }
}

function placeConversationCards(cards) {
  state.layoutPositions ??= new Map()
  const saved = new Map(cards.flatMap(card => {
    const position = card.positionLocked === true
      ? state.cardPositions.get(card.id) ?? state.cardPositions.get(card.positionKey)
      : state.layoutPositions.get(card.id)
    return position === undefined ? [] : [[card.id, { x: position.x, y: position.y }]]
  }))
  // Locked cards are authoritative, but they still occupy canvas space. The
  // old pass only registered automatically placed cards, so a re-layout could
  // put a fresh card directly underneath a manually dragged one.
  const occupied = []
  for (const card of cards) {
    const position = saved.get(card.id)
    if (position === undefined) continue
    card.position = position
    occupied.push(position)
  }
  for (const card of cards) {
    if (saved.has(card.id)) continue
    card.position = firstAvailableCardPosition(card.naturalPosition ?? card.position, occupied)
    occupied.push(card.position)
  }
  for (const card of cards) state.layoutPositions.set(card.id, { ...card.position })
  return cards
}

function layoutConversationGraph(cards, threads) {
  // A fork's parent link is Synapse's node id when the parent has been
  // projected, and DSH's own parent session id otherwise. Lanes must follow
  // BOTH: a fork linked only by session id used to be treated as a root here,
  // which parked it in the last lane — far below the conversation it branched
  // from, with its connector stretched across the whole canvas.
  const effectiveParentIdOf = thread => {
    const parentId = thread.parentId ?? null
    if (parentId !== null && parentId !== undefined) return parentId
    return sessionThreadIdOf(threads, thread) ?? null
  }
  const threadIds = new Set(threads.map(thread => thread.id))
  const parentByThread = new Map()
  for (const thread of threads) {
    const parentId = effectiveParentIdOf(thread)
    parentByThread.set(thread.id, parentId !== null && threadIds.has(parentId) && parentId !== thread.id ? parentId : null)
  }
  const byId = new Map(cards.map(card => [card.id, card]))
  const xByCard = new Map()
  const xFor = (card, visiting = new Set()) => {
    if (xByCard.has(card.id)) return xByCard.get(card.id)
    if (visiting.has(card.id)) return 86
    visiting.add(card.id)
    const parent = card.parentId === null ? undefined : byId.get(card.parentId)
    const x = parent === undefined ? 86 : xFor(parent, visiting) + 365
    visiting.delete(card.id)
    xByCard.set(card.id, x)
    return x
  }
  const spanByThread = new Map()
  for (const card of cards) {
    const x = xFor(card)
    const span = spanByThread.get(card.dshThreadId)
    if (span === undefined) spanByThread.set(card.dshThreadId, { left: x, right: x + CARD_WIDTH })
    else {
      span.left = Math.min(span.left, x)
      span.right = Math.max(span.right, x + CARD_WIDTH)
    }
  }

  // Each branch owns a lane for its lifetime. Reusing a short branch's empty
  // horizontal space moves its neighbors when that branch later grows.
  const depthByThread = new Map()
  const depthFor = (threadId, visiting = new Set()) => {
    if (depthByThread.has(threadId)) return depthByThread.get(threadId)
    if (visiting.has(threadId)) return 0
    visiting.add(threadId)
    const parentId = parentByThread.get(threadId)
    const depth = parentId === null ? 0 : depthFor(parentId, visiting) + 1
    visiting.delete(threadId)
    depthByThread.set(threadId, depth)
    return depth
  }
  const orderedThreads = threads
    .map((thread, index) => ({ thread, index }))
    .sort((left, right) => {
      const depthDifference = depthFor(left.thread.id) - depthFor(right.thread.id)
      if (depthDifference !== 0) return depthDifference
      const leftSpan = spanByThread.get(left.thread.id)?.left ?? 86
      const rightSpan = spanByThread.get(right.thread.id)?.left ?? 86
      return leftSpan - rightSpan || left.index - right.index
    })
  state.layoutLanes ??= new Map()
  const laneByThread = new Map(threads.flatMap(thread => {
    const lane = state.layoutLanes.get(thread.id)
    return Number.isInteger(lane) ? [[thread.id, lane]] : []
  }))
  const usedLanes = new Set(laneByThread.values())
  for (const { thread } of orderedThreads) {
    if (laneByThread.has(thread.id)) continue
    const parentId = parentByThread.get(thread.id)
    const firstLane = parentId === null ? 0 : (laneByThread.get(parentId) ?? 0) + 1
    let lane = firstLane
    while (usedLanes.has(lane)) lane += 1
    laneByThread.set(thread.id, lane)
    state.layoutLanes.set(thread.id, lane)
    usedLanes.add(lane)
  }

  for (const card of cards) {
    const position = {
      x: xFor(card),
      y: 82 + (laneByThread.get(card.dshThreadId) ?? 0) * (CARD_HEIGHT + CARD_GAP_Y),
    }
    card.naturalPosition = position
    if (!card.positionLocked) card.position = position
  }
  return placeConversationCards(cards)
}

function isSessionLabelQuestion(text) {
  if (typeof text !== 'string') return false
  const trimmed = text.trim()
  if (trimmed === '' || trimmed === '会话' || trimmed === 'DSH 会话') return true
  if (trimmed === '当前会话' || trimmed === '等待用户提问') return true
  return trimmed.endsWith('分支')
}

/** Whether a card title is a question the human actually asked. */
function isHumanCardQuestion(text) {
  if (typeof text !== 'string') return false
  const trimmed = text.trim()
  if (trimmed === '') return false
  if (isSessionLabelQuestion(trimmed)) return false
  return !isInjectedCardText(trimmed)
}

function isInjectedCardText(text) {
  const trimmed = text.trimStart()
  if (trimmed.startsWith('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.')) return true
  if (trimmed.startsWith('This is an automatically generated checkpoint')) return true
  if (trimmed.startsWith('The approval policy changed from')) return true
  if (trimmed.startsWith('You are repeating the exact same tool call')) return true
  if (trimmed.startsWith('## Main conversation context')) return true
  if (trimmed.startsWith('Background subagent')) return true
  if (/^background job /i.test(trimmed)) return true
  if (/^Cordis (?:run|update)\b/.test(trimmed)) return true
  if (trimmed.startsWith('The user stopped Cordis') || trimmed.startsWith('The user manually ran Cordis')) return true
  return /^<(system-reminder|system|context|environment|reminder|goal_round|goal_complete)\b[^>]*>/i.test(trimmed)
}

function firstUserQuestion(thread) {
  for (const turn of thread?.turns ?? []) {
    if (turn?.human === true || isHumanCardQuestion(turn?.question)) return turn.question
  }
  return null
}

/**
 * A turn's custom title, set by renaming the card. It lives on the turn itself
 * (`turn.title`) so reprojection and reloads keep it; an empty or missing value
 * means the card falls back to the auto-derived question.
 */
function cardTitleOf(storedTurn) {
  if (storedTurn === null || typeof storedTurn !== 'object') return null
  const title = typeof storedTurn.title === 'string' ? storedTurn.title.trim() : ''
  return title === '' ? null : title
}

function cardQuestionOf(thread, storedTurn, inflightQuestion) {
  const stored = typeof storedTurn?.question === 'string' ? storedTurn.question : ''
  if (storedTurn?.human === true && stored.trim() !== '') return stored
  if (isHumanCardQuestion(stored)) return stored
  if (isHumanCardQuestion(inflightQuestion)) return inflightQuestion
  return '等待用户提问'
}

/**
 * Whether an empty fork still counts as "just created".
 *
 * The canvas keeps a placeholder card for every linked branch at any age, so
 * this freshness window no longer gates visibility — it answers two narrower
 * questions: whether a blank placeholder is titled 等待用户提问 (still waiting
 * on its first prompt) or 空分支, and whether `keepLiveCanvasThreads` should
 * survive a workspace refetch that raced the fork's creation and omitted it.
 * Older blank forks are authoritative on the server, so the fetch wins there.
 */
function isFreshBlankFork(thread) {
  if (thread?.parentId == null) return false
  const created = Date.parse(thread.createdAt ?? '')
  if (!Number.isFinite(created)) return true
  return Date.now() - created < 15 * 60 * 1000
}

function conversationCards(threads) {
  const cards = []
  const cardsByThread = new Map()
  for (const thread of threads) {
    // v5: the server already stores one card per turn, so the canvas reads
    // them directly instead of re-deriving turns from a message log.
    const liveReply = state.liveReplies.get(thread.dshSessionId)
    const pendingText = state.pendingReplies?.get(thread.dshSessionId)?.text
    const inflightQuestion = (typeof liveReply?.question === 'string' && liveReply.question !== '' ? liveReply.question : undefined) ?? pendingText
    // The map is a picture of what the user asked. A card whose title is a
    // generated session label (当前会话, "<parent> 分支") or harness-injected
    // text (checkpoints, runtime context) is not a question anyone asked, so
    // it never reaches the canvas. The last card is kept when a real prompt is
    // still in flight: until DSH commits it, that card is the pending question.
    const allTurns = turnsFor(thread)
    const stored = allTurns.filter((storedTurn, turnIndex, list) => {
      if (storedTurn?.human === true && storedTurn.question?.trim()) return true
      if (isHumanCardQuestion(storedTurn?.question)) return true
      return turnIndex === list.length - 1 && isHumanCardQuestion(inflightQuestion)
    })
    const turns = []
    stored.forEach((storedTurn, turnIndex) => {
      const id = storedTurn.cardId ?? `${thread.id}:turn:${storedTurn.seq ?? `i${turnIndex}`}`
      const rawIndex = allTurns.indexOf(storedTurn)
      // turnsFor may attach a browser-only submission ID. Writes must address
      // the persisted turn, not that display alias.
      const persistedTurn = thread.turns?.[rawIndex] ?? storedTurn
      const cardKey = Number.isSafeInteger(storedTurn.seq) ? String(storedTurn.seq) : `i${rawIndex}`
      const mutation = state.visibilityMutation
      const hidden = mutation?.workspaceId === state.workspace?.id && mutation?.targets.some(target => visibilityTargetMatches(thread, persistedTurn, rawIndex, target))
        ? mutation.hidden : storedTurn.hidden === true
      const previous = turns.at(-1)
      const positionKey = `${thread.id}:turn-index:${turnIndex}`
      const naturalPosition = previous === undefined ? { x: 86, y: 82 } : { x: previous.naturalPosition.x + 365, y: previous.naturalPosition.y }
      const savedPosition = state.cardPositions?.get(id) ?? state.cardPositions?.get(positionKey)
      const positionLocked = savedPosition !== undefined
      turns.push({
        id,
        positionKey,
        dshThreadId: thread.id,
        sourceParentId: thread.parentId,
        parentId: null,
        sourceSeq: Number.isSafeInteger(storedTurn.seq) ? storedTurn.seq : undefined,
        answerSeq: Number.isSafeInteger(storedTurn.answerSeq) ? storedTurn.answerSeq : undefined,
        turnIndex,
        hidden,
        visibilityTarget: {
          threadId: thread.id, cardKey,
          cardId: persistedTurn.cardId ?? `${thread.id}:turn:${persistedTurn.seq ?? `i${rawIndex}`}`,
          ...(typeof persistedTurn.messageId === 'string' && persistedTurn.messageId !== '' ? { messageId: persistedTurn.messageId } : {}),
        },
        isTail: turnIndex === stored.length - 1,
        status: storedTurn.status,
        operationId: storedTurn.operationId,
        naturalPosition,
        position: positionLocked ? savedPosition : naturalPosition,
        positionLocked,
        question: cardTitleOf(storedTurn) ?? cardQuestionOf(thread, storedTurn, turnIndex === stored.length - 1 ? inflightQuestion : undefined),
        customTitle: cardTitleOf(storedTurn),
        // The rename API addresses a turn by seq, or by its RAW index in
        // thread.turns — not by the filtered card index used in `id`.
        cardKey,
        answer: storedTurn.answer === null || storedTurn.answer === undefined ? null : { kind: 'assistant', text: storedTurn.answer, sourceSeq: storedTurn.answerSeq, at: storedTurn.at, pending: storedTurn.pending === true },
        error: storedTurn.error === null || storedTurn.error === undefined ? null : { kind: 'error', text: storedTurn.error, at: storedTurn.at },
        processCount: storedTurn.processCount ?? 0,
      })
    })
    const latestTurn = turns.at(-1)
    if (liveReply !== undefined && typeof liveReply.text === 'string' && liveReply.text !== '' && latestTurn !== undefined
      && (liveReply.seq === undefined
        ? latestTurn.answer === null || latestTurn.answer.pending === true || latestTurn.status === 'running'
        : latestTurn.sourceSeq === liveReply.seq)
      && !['done', 'failed', 'cancelled'].includes(latestTurn.status)) {
      latestTurn.answer = { kind: 'assistant', text: liveReply.text, pending: liveReply.running === true, at: new Date().toISOString() }
    }
    if (turns.length === 0) {
      // A branch is part of the family tree even before its first message:
      // the fork exists in DSH's session list, so hiding it would make the
      // map show a lone chain where the user actually created a tree. Blank
      // branches keep a placeholder card at any age — the canvas is already
      // scoped to the current family, so this never pulls in unrelated
      // clutter. Only a blank session with no branch link at all (and no
      // question in flight) stays off the canvas.
      const linked = thread.parentId != null || (typeof thread.sourceParentSessionId === 'string' && thread.sourceParentSessionId !== '')
      if (!linked && !isHumanCardQuestion(inflightQuestion)) continue
      const id = `${thread.id}:turn:empty`
      const positionKey = `${thread.id}:turn-index:0`
      const naturalPosition = { x: 86, y: 82 }
      const savedPosition = state.cardPositions?.get(id) ?? state.cardPositions?.get(positionKey)
      const positionLocked = savedPosition !== undefined
      turns.push({
      id,
      positionKey,
      dshThreadId: thread.id,
      sourceParentId: thread.parentId,
      parentId: null,
      sourceSeq: undefined,
      turnIndex: 0,
      isTail: true,
      naturalPosition,
      position: positionLocked ? savedPosition : naturalPosition,
      positionLocked,
      question: isFreshBlankFork(thread) || isHumanCardQuestion(inflightQuestion) ? cardQuestionOf(thread, null, inflightQuestion) : '空分支',
      answer: null,
      error: null,
      processCount: 0,
      blank: true,
      })
    }
    turns.at(-1).canContinue = true
    cardsByThread.set(thread.id, turns)
    cards.push(...turns)
  }
  for (const card of cards) {
    const siblings = cardsByThread.get(card.dshThreadId)
    if (card.turnIndex > 0) card.parentId = siblings[card.turnIndex - 1].id
    else {
      const sourceThread = threads.find(thread => thread.id === card.dshThreadId)
      // Synapse's own parent node, then DSH's recorded parent SESSION. The
      // second link is what keeps a fork attached when its parent thread has
      // not been projected into this workspace yet (a restored branch, or one
      // whose parent is still syncing) — otherwise it would fall through to a
      // null parent and pile up on the canvas origin.
      const parentCards = cardsByThread.get(card.sourceParentId) ?? cardsByThread.get(sessionThreadIdOf(threads, sourceThread))
      const anchored = branchAnchorFor(sourceThread, parentCards) ?? inheritedTurnFor(sourceThread, parentCards, siblings)
      // A fork cut across different sequence spaces (an old DSH fork whose
      // child re-counts from its own origin) leaves no comparable seq, and no
      // guess is honest. Attach the branch to the parent's first card so it at
      // least hangs beside its conversation instead of collapsing onto the
      // canvas origin where it overlaps the parent chain.
      card.parentId = anchored ?? (parentCards === undefined || parentCards.length === 0 ? null : parentCards[0].id)
      card.anchorInferred = anchored === undefined && card.parentId !== null
    }
  }
  return layoutConversationGraph(cards, threads)
}

/**
 * The Synapse thread id of a session, for linking a fork through DSH's own
 * recorded parent session when Synapse's parent node is missing.
 */
function sessionThreadIdOf(threads, sourceThread) {
  const sessionId = sourceThread?.sourceParentSessionId
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  const parent = threads.find(thread => thread.dshSessionId === sessionId)
  return parent === undefined ? undefined : parent.id
}

/**
 * Resolve where a branch card attaches to its parent conversation.
 *
 * The anchor is the exact turn the user branched from, persisted on the server
 * (`anchorCardId`) or remembered in this browser (`branchAnchors`). It wins
 * over any sequence arithmetic because a fork cut mid-turn leaves several
 * parent turns that all look like valid attachment points.
 * @param sourceThread - the branch's own thread, when it is in the graph.
 * @param parentCards - the parent thread's cards, keyed by thread id lookups.
 * @returns the parent card id, or undefined when no anchor applies.
 */
function branchAnchorFor(sourceThread, parentCards) {
  if (sourceThread === undefined || parentCards === undefined) return undefined
  const persisted = sourceThread.anchorCardId
  if (typeof persisted === 'string' && persisted !== '' && parentCards.some(candidate => candidate.id === persisted)) return persisted
  if (Number.isSafeInteger(sourceThread.sourceAnchorSeq)) {
    const exact = parentCards.find(card => card.answerSeq === sourceThread.sourceAnchorSeq || card.sourceSeq === sourceThread.sourceAnchorSeq)
    if (exact !== undefined) return exact.id
  }
  const remembered = state.branchAnchors.get(sourceThread.id)
  if (typeof remembered === 'string' && remembered !== '' && parentCards.some(candidate => candidate.id === remembered)) return remembered
  // A browser anchor can also name the session rather than the thread.
  if (sourceThread.dshSessionId !== null) {
    const bySession = state.branchAnchors.get(sourceThread.dshSessionId)
    if (typeof bySession === 'string' && bySession !== '' && parentCards.some(candidate => candidate.id === bySession)) return bySession
  }
  return undefined
}

/**
 * Fall back to sequence arithmetic when no anchor was recorded.
 *
 * Two signals, in order of trust:
 *
 * 1. DSH's durable fork cut (`sourceSeedLength`): the branch point is the last
 *    parent turn that ends at or before that boundary. Zero is a legitimate
 *    boundary, so the test must be an explicit integer check rather than a
 *    truthiness check — treating 0 as "no seed" is what used to drop these
 *    branches to the canvas origin, where they piled up on top of the parent
 *    chain instead of sitting beside it.
 * 2. The inherited prefix: a fork replays its parent's history, so a parent
 *    turn whose sequence also appears in the child is part of what the branch
 *    inherited. The last such turn is where the branch left. This rescues the
 *    many old forks whose recorded seed is 0 or absent even though their first
 *    turn is a copy of a parent turn.
 *
 * @param sourceThread - the branch's own thread.
 * @param parentCards - the parent thread's cards.
 * @param siblings - the branch's own cards.
 * @returns the parent card id, or undefined when the cut cannot be placed.
 */
function inheritedTurnFor(sourceThread, parentCards, siblings) {
  if (parentCards === undefined || parentCards.length === 0) return undefined
  const seed = sourceThread?.sourceSeedLength
  if (Number.isSafeInteger(seed) && seed >= 0) {
    const endedAtOrBefore = parentCards.filter(candidate => {
      const end = Number.isSafeInteger(candidate.answerSeq) ? candidate.answerSeq : candidate.sourceSeq
      return Number.isSafeInteger(end) && end <= seed
    })
    const turn = endedAtOrBefore.at(-1)
    if (turn !== undefined) return turn.id
    // The seed claims this branch inherited nothing. That is trustworthy only
    // when the child's numbering continues the parent's (its first turn comes
    // after every parent turn); a child numbered *below* its parent's first
    // turn re-counts from its own origin, so its recorded 0 is noise and the
    // prefix guess below is the only signal left.
    const earliest = Math.min(...parentCards
      .map(candidate => (Number.isSafeInteger(candidate.sourceSeq) ? candidate.sourceSeq : undefined))
      .filter(seq => seq !== undefined))
    const childSeqs = (siblings ?? []).map(sibling => (Number.isSafeInteger(sibling.sourceSeq) ? sibling.sourceSeq : undefined)).filter(seq => seq !== undefined)
    const continuesParent = childSeqs.length === 0 || Math.min(...childSeqs) > earliest
    const parentEnds = parentCards.map(candidate => (Number.isSafeInteger(candidate.answerSeq) ? candidate.answerSeq : candidate.sourceSeq)).filter(seq => Number.isSafeInteger(seq))
    if (continuesParent || (parentEnds.length > 0 && seed > Math.max(...parentEnds))) return undefined
  }
  // A child with no turns of its own inherited nothing we can compare, so leave
  // it unanchored rather than guessing at the parent's first turn.
  if (siblings === undefined || siblings.length === 0) return undefined
  // The child's first own turn begins right after the inherited prefix, so
  // every parent turn that starts at or before it is part of what this branch
  // copied. The last such turn is where the branch left. This covers both a
  // child that replays a parent turn verbatim (equal seq) and one whose seq
  // continues the same numbering (higher seq). A fork that re-counts from its
  // own origin shares neither, and correctly matches nothing.
  const childSeqs = siblings
    .map(sibling => (Number.isSafeInteger(sibling.sourceSeq) ? sibling.sourceSeq : undefined))
    .filter(seq => seq !== undefined)
  if (childSeqs.length === 0) return undefined
  const childStart = Math.min(...childSeqs)
  const inherited = parentCards.filter(candidate => Number.isSafeInteger(candidate.sourceSeq) && candidate.sourceSeq <= childStart)
  const turn = inherited.at(-1)
  return turn === undefined ? undefined : turn.id
}

function conversationGraphView(cards, collapsedCardIds = state.collapsedCardIds) {
  const cardIds = new Set(cards.map(card => card.id))
  // Hiding a folded card affects only that card. Retain its fold preference,
  // but do not let it silently hide the children of the compact marker.
  const manuallyHidden = new Set(cards.filter(card => card.hidden === true).map(card => card.id))
  const collapseRoots = new Set([...collapsedCardIds].filter(id => !manuallyHidden.has(id)))
  const childrenByParent = new Map()
  for (const card of cards) {
    if (card.parentId === null || !cardIds.has(card.parentId)) continue
    const children = childrenByParent.get(card.parentId) ?? []
    children.push(card.id)
    childrenByParent.set(card.parentId, children)
  }

  const hiddenIds = new Set()
  for (const rootId of collapseRoots) {
    if (!cardIds.has(rootId)) continue
    const visited = new Set([rootId])
    const visit = parentId => {
      for (const childId of childrenByParent.get(parentId) ?? []) {
        if (visited.has(childId)) continue
        visited.add(childId)
        hiddenIds.add(childId)
        visit(childId)
      }
    }
    visit(rootId)
  }

  // Persisted collapse roots must remain visible even if malformed metadata
  // contains a cycle where two collapsed nodes otherwise hide each other.
  for (const rootId of collapseRoots) hiddenIds.delete(rootId)

  // Post-order accumulation: each card's descendant count is 1 + the sum of
  // its children's subtree sizes, so the whole graph is O(n) instead of a BFS
  // from every card (O(n²) on deep chains). Malformed parent cycles are
  // detected through the DFS path: every member of a cycle reaches every other
  // member plus the union of their off-cycle subtrees, so when the cycle entry
  // pops last, all members are settled to (cycleSize - 1) + off-cycle total,
  // which matches the per-card BFS' unique-descendant count.
  const descendantCounts = new Map()
  const inStack = new Set()
  for (const card of cards) {
    if (descendantCounts.has(card.id)) continue
    const stack = [{ id: card.id, children: childrenByParent.get(card.id) ?? [], index: 0 }]
    const path = [card.id]
    let cycleEntry = null
    let cycleMembers = null
    let cycleOffCycleTotal = 0
    inStack.add(card.id)
    while (stack.length > 0) {
      const top = stack[stack.length - 1]
      if (top.index < top.children.length) {
        const childId = top.children[top.index++]
        if (descendantCounts.has(childId)) continue
        if (inStack.has(childId)) {
          // Back edge: the nodes from childId up to top.id form a cycle.
          cycleEntry = childId
          cycleMembers = new Set(path.slice(path.indexOf(childId)))
          cycleOffCycleTotal = 0
          continue
        }
        inStack.add(childId)
        path.push(childId)
        stack.push({ id: childId, children: childrenByParent.get(childId) ?? [], index: 0 })
      } else {
        stack.pop()
        path.pop()
        inStack.delete(top.id)
        let count = 0
        for (const childId of top.children) {
          if (cycleMembers !== null && cycleMembers.has(childId)) continue // ring edge; base count added below
          count += 1 + (descendantCounts.get(childId) ?? 0)
        }
        if (cycleMembers !== null && cycleMembers.has(top.id)) cycleOffCycleTotal += count
        if (cycleMembers !== null && top.id === cycleEntry) {
          // All cycle members have popped (the entry pops last in post-order);
          // settle them so ancestors popping next read the final counts.
          const base = cycleMembers.size - 1
          for (const id of cycleMembers) descendantCounts.set(id, base + cycleOffCycleTotal)
          cycleEntry = null
          cycleMembers = null
        } else {
          descendantCounts.set(top.id, count)
        }
      }
    }
  }

  return {
    cards: cards.filter(card => !hiddenIds.has(card.id)),
    hiddenCards: cards.filter(card => manuallyHidden.has(card.id)),
    childCounts: new Map(cards.map(card => [card.id, childrenByParent.get(card.id)?.length ?? 0])),
    descendantCounts,
  }
}

function expandedForRestoredCards(cards, restoredIds, collapsedCardIds) {
  const next = new Set(collapsedCardIds)
  const byId = new Map(cards.map(card => [card.id, card]))
  for (const id of restoredIds) {
    const visited = new Set([id])
    let parent = byId.get(id)?.parentId
    while (parent != null && !visited.has(parent)) {
      visited.add(parent)
      next.delete(parent)
      parent = byId.get(parent)?.parentId
    }
  }
  return next
}

function revealConversationThread(cards, threadId) {
  const byId = new Map(cards.map(card => [card.id, card]))
  let changed = false
  for (const target of cards.filter(card => card.dshThreadId === threadId)) {
    const visited = new Set([target.id])
    let parentId = target.parentId
    while (parentId !== null && !visited.has(parentId)) {
      visited.add(parentId)
      if (state.collapsedCardIds.delete(parentId)) changed = true
      parentId = byId.get(parentId)?.parentId ?? null
    }
  }
  if (changed) persistCollapsedCards()
  return changed
}

/**
 * World-space box for one connector, including bezier handles.
 *
 * Each link is its own absolutely positioned SVG, the same way cards are
 * absolutely positioned. A single viewport-sized SVG used to clip any path
 * that left the first screen of the canvas — a just-created branch often
 * sits in a new lane, so its line vanished until a later layout.
 */
function connectorLinkBox(fromPosition, toPosition) {
  const fromX = fromPosition.x + (fromPosition.width ?? CARD_WIDTH)
  const fromY = fromPosition.y + (fromPosition.height ?? CARD_HEIGHT) / 2
  const toX = toPosition.x
  const toY = toPosition.y + (toPosition.height ?? CARD_HEIGHT) / 2
  const bend = Math.min(110, Math.max(36, Math.abs(toX - fromX) * .2))
  const left = Math.min(fromX, toX, fromX + bend, toX - bend) - 8
  const top = Math.min(fromY, toY) - 8
  const width = Math.max(1, Math.max(fromX, toX, fromX + bend, toX - bend) - left + 8)
  const height = Math.max(1, Math.max(fromY, toY) - top + 8)
  return { left, top, width, height }
}

function connectorLinkSvg(fromCard, toCard, extraClass = '') {
  const from = canvasNodeBounds(fromCard)
  const to = canvasNodeBounds(toCard)
  const box = connectorLinkBox(from, to)
  const klass = extraClass.trim()
  return `<svg class="connector-link" data-from="${escapeHtml(fromCard.id)}" data-to="${escapeHtml(toCard.id)}" style="left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px" viewBox="${box.left} ${box.top} ${box.width} ${box.height}" overflow="visible"><path class="${klass}" data-from="${escapeHtml(fromCard.id)}" data-to="${escapeHtml(toCard.id)}" d="${connectorPath(from, to)}"></path></svg>`
}

function canvasConnectors(cards) {
  const index = new Map(cards.map(card => [card.id, card]))
  const links = []
  for (const card of cards) {
    const parent = card.parentId === null ? null : index.get(card.parentId)
    if (parent === undefined || parent === null) continue
    const active = card.dshThreadId === state.activeId && parent.dshThreadId === state.activeId ? 'active-connector' : ''
    links.push(connectorLinkSvg(parent, card, active))
  }
  const placement = draftPlacement(cards)
  if (placement !== null) links.push(connectorLinkSvg(placement.parent, { id: 'draft', position: placement.position }, 'draft-connector'))
  return links.join('')
}

function conversationCard(card, graph) {
  const selected = card.id === state.selectedCardId ? 'selected' : ''
  const status = sessionStatusFor(state.workspace?.threads.find(item => item.id === card.dshThreadId))
  const resolvedState = cardState(card, status)
  const busy = ['creating', 'queued', 'running', 'needs-input'].includes(resolvedState)
  const source = card.parentId === null ? 'DSH 会话' : card.turnIndex === 0 ? 'DSH 分支' : '追问'
  const continueButton = card.canContinue === true
    ? `<button class="graph-continue-button" data-action="open-continue" data-thread="${card.dshThreadId}" data-card="${escapeHtml(card.id)}" aria-label="添加追问" title="${busy ? '等待本轮结束' : '添加追问'}" ${busy ? 'disabled' : ''}><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9"/></svg></button>`
    : ''
  if (card.hidden === true) {
    const bounds = canvasNodeBounds(card)
    return `<div class="hidden-card" data-card-id="${escapeHtml(card.id)}" style="left:${bounds.x}px;top:${bounds.y}px;width:${bounds.width}px;height:${bounds.height}px"><button type="button" class="hidden-card-restore" data-action="restore-card" data-card="${escapeHtml(card.id)}" title="恢复第 ${card.turnIndex + 1} 轮" aria-label="恢复第 ${card.turnIndex + 1} 轮" ${state.visibilityMutation ? 'disabled' : ''}>${visibilityIcon('hidden')}<span>已隐藏 1 轮</span></button>${continueButton}</div>`
  }
  const childCount = graph.childCounts.get(card.id) ?? 0
  const collapsed = state.collapsedCardIds.has(card.id)
  const foldLabel = collapsed ? '展开后续对话' : '折叠后续对话'
  const foldButton = childCount === 0 || card.canContinue === true ? '' : `<button class="graph-fold-button${collapsed ? ' collapsed' : ''}" data-action="toggle-card-children" data-card="${escapeHtml(card.id)}" aria-expanded="${collapsed ? 'false' : 'true'}" aria-label="${foldLabel}" title="${foldLabel}"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3.5 8h9"/>${collapsed ? '<path d="M8 3.5v9"/>' : ''}</svg></button>`
  const branchSeq = resolvedState !== 'done' ? null : Number.isSafeInteger(card.answerSeq) ? card.answerSeq : Number.isInteger(card.answer?.sourceSeq) ? card.answer.sourceSeq : null
  const retry = card.operationId && resolvedState === 'failed'
    ? `<button data-action="retry-submission" data-operation="${escapeHtml(card.operationId)}">重试</button><button data-action="discard-submission" data-operation="${escapeHtml(card.operationId)}">放弃</button>`
    : ''
  const branchButton = branchSeq === null ? '' : `<button class="graph-branch-button" data-action="open-branch" data-thread="${card.dshThreadId}" data-card="${escapeHtml(card.id)}" data-seq="${branchSeq}" aria-label="在新对话中分支" title="在新对话中分支"><svg aria-hidden="true" viewBox="0 0 16 16"><path fill-rule="evenodd" clip-rule="evenodd" d="M13.0762 1.37207C14.0846 1.37228 14.9021 2.19077 14.9023 3.19922C14.9022 4.20772 14.0847 5.02518 13.0762 5.02539C12.2967 5.02539 11.6325 4.53691 11.3701 3.84961H4.35547C4.79397 4.26458 5.15861 4.7644 5.41699 5.33496L7.10645 9.06738C7.88526 10.7875 9.55104 11.9228 11.4189 12.0371C11.7085 11.4109 12.3411 10.9756 13.0762 10.9756C14.0843 10.9759 14.9023 11.7936 14.9023 12.8018C14.9023 13.81 14.0843 14.6277 13.0762 14.6279C12.2534 14.6279 11.5574 14.0832 11.3291 13.335C8.9868 13.1879 6.89981 11.7612 5.92285 9.60352L4.23242 5.87109C3.67503 4.64033 2.44878 3.84961 1.09766 3.84961V2.54883C1.10665 2.54883 1.11601 2.54975 1.125 2.5498L11.3701 2.54883C11.6326 1.86151 12.2969 1.37207 13.0762 1.37207ZM13.0762 12.2764C12.7858 12.2764 12.5508 12.5114 12.5508 12.8018C12.5508 13.0921 12.7858 13.3281 13.0762 13.3281C13.3664 13.3279 13.6025 13.092 13.6025 12.8018C13.6025 12.5115 13.3664 12.2766 13.0762 12.2764ZM13.0762 2.67285C12.7855 2.67285 12.55 2.90861 12.5498 3.19922C12.5499 3.48987 12.7855 3.72559 13.0762 3.72559C13.3667 3.72538 13.6024 3.48975 13.6025 3.19922C13.6023 2.90874 13.3666 2.67306 13.0762 2.67285Z" fill="currentColor"/></svg></button>`
  return `<article class="thread-card ${selected}${card.blank === true ? ' card-blank' : ''} card-${resolvedState}" data-card-id="${escapeHtml(card.id)}" data-position-key="${escapeHtml(card.positionKey)}" data-thread="${card.dshThreadId}" data-state="${resolvedState}" style="left:${card.position.x}px;top:${card.position.y}px;--thread-color:#3478f6">
    <button class="node-handle" data-drag-card="${card.id}" aria-label="拖动 ${escapeHtml(card.question)}" title="拖动卡片"></button>
    ${continueButton}${foldButton}${branchButton}
    <div class="thread-card-head"><span class="topic-dot"></span>${state.renamingCardId === card.id ? cardRenameForm(card, 'thread-title-input') : `<strong class="thread-title"${card.blank === true ? '' : ` data-rename-title="${escapeHtml(card.id)}" tabindex="0" role="button" aria-label="重命名标题：${escapeHtml(card.question)}"`}>${escapeHtml(card.question)}</strong>`}</div>
    <div class="thread-meta"><span>${source}</span><span>第 ${card.turnIndex + 1} 轮</span>${card.blank === true ? '' : cardStateBadge(card, status)}${card.anchorInferred === true ? '<span class="card-anchor-inferred" title="这个分支的分叉点已无法还原，暂时挂在主会话开头">分叉点未知</span>' : ''}${card.processCount > 0 ? `<span class="card-process-count">工具 ${card.processCount}</span>` : ''}</div>
    <div class="thread-answer">${card.answer === null ? (card.error === null ? (card.blank === true ? '<p class="thread-answer-empty">这个分支还没有消息</p>' : '<p class="thread-answer-empty">等待助手回复</p>') : '') : card.answer.pending && card.answer.text === '' ? '<p class="thread-answer-pending">正在回复</p>' : `${renderMarkdown(card.answer.text)}${card.answer.pending ? '<p class="thread-answer-pending">正在回复</p>' : ''}`}${card.error === null ? '' : `<p class="thread-answer-error" title="${escapeHtml(card.error.text)}">本轮失败：${escapeHtml(card.error.text)}</p>`}</div>
    <footer>${retry}${cardActionButtons(card, status, 'footer')}<button data-action="watch-turn" data-thread="${card.dshThreadId}" data-card="${escapeHtml(card.id)}" title="详情" aria-label="详情" ${Number.isSafeInteger(card.sourceSeq) ? '' : 'disabled'}><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2 8.5 8 2.5l6 6V13.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5Z"/><path d="M6.2 14v-3.6a1.8 1.8 0 0 1 3.6 0V14" /></svg>详情</button><button data-action="open-dsh" data-thread="${card.dshThreadId}" data-seq="${Number.isInteger(card.sourceSeq) ? card.sourceSeq : ''}" title="在 DSH 中打开" aria-label="在 DSH 中打开"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.5H4.5A1.5 1.5 0 0 0 3 5v6.5A1.5 1.5 0 0 0 4.5 13H11a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M9.5 3.5h3v3M12.4 3.6 7.5 8.5"/></svg>DSH</button></footer>
  </article>`
}

function cardActionButtons(card, status, placement) {
  const actions = cardActions(card, status, state.draft).filter(item => item.placement === placement)
  return actions.map(item => `<button type="button" class="card-${item.placement}-action" data-action="${item.action}" data-card="${escapeHtml(card.id)}" aria-label="${escapeHtml(item.label)}" title="${escapeHtml(item.reason ?? item.label)}" ${item.reason !== null || state.visibilityMutation ? 'disabled' : ''}>${visibilityIcon(item.icon)}${escapeHtml(item.text)}</button>`).join('')
}

/** The editing state of a card title: Enter commits, Escape cancels, blur commits. */
function cardRenameForm(card, inputClass) {
  return `<form class="card-rename-form" data-rename="${escapeHtml(card.id)}"><input class="${inputClass}" data-rename-input="${escapeHtml(card.id)}" maxlength="120" value="${escapeHtml(card.question)}" aria-label="卡片标题"></form>`
}

function draftActions(draft) {
  const disabled = draft.sending ? 'disabled' : ''
  return `<div class="draft-actions"><button type="button" data-action="cancel-draft" ${disabled} aria-label="取消" title="取消"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button><button class="primary" type="submit" ${disabled} aria-label="发送" title="发送"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7"/></svg></button></div>`
}

function quickPhraseEditor(draft) {
  const disabled = draft.sending ? 'disabled' : ''
  const phrases = state.quickPhrases.map((phrase, index) => `<div class="draft-quick-phrase-editor-row"><input data-quick-phrase-index="${index}" maxlength="${MAX_QUICK_PHRASE_LENGTH}" value="${escapeHtml(phrase)}" aria-label="快捷词 ${index + 1}" ${disabled}><button type="button" data-action="remove-quick-phrase" data-quick-phrase-index="${index}" aria-label="删除 ${escapeHtml(phrase)}" title="删除" ${disabled}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button></div>`).join('')
  return `<section class="draft-quick-editor" aria-label="编辑快捷词"><div class="draft-quick-editor-list">${phrases}</div><div class="draft-quick-phrase-add"><input maxlength="${MAX_QUICK_PHRASE_LENGTH}" placeholder="添加快捷词" aria-label="添加快捷词" ${disabled}><button class="primary" type="button" data-action="add-quick-phrase" aria-label="添加快捷词" title="添加快捷词" ${disabled}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg></button></div><button class="draft-quick-editor-close" type="button" data-action="close-quick-phrase-editor" ${disabled}>完成</button></section>`
}

function draftQuickPhrases(draft) {
  const disabled = draft.sending ? 'disabled' : ''
  if (state.quickPhraseEditorOpen) return quickPhraseEditor(draft)
  const phrases = state.quickPhrases.map(phrase => `<button class="draft-quick-phrase" type="button" data-action="insert-quick-phrase" data-quick-phrase="${escapeHtml(phrase)}" ${disabled}>${escapeHtml(phrase)}</button>`).join('')
  return `<div class="draft-quick-phrases" aria-label="常用补充词">${phrases}<button class="draft-quick-phrase-add-button" type="button" data-action="open-quick-phrase-editor" aria-label="管理快捷词" title="管理快捷词" ${disabled}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg></button></div>`
}

function insertQuickPhrase(phrase) {
  const input = document.querySelector('[data-draft] textarea')
  if (!(input instanceof HTMLTextAreaElement) || state.draft === null) return
  const start = input.selectionStart
  const end = input.selectionEnd
  const prefix = input.value.slice(0, start)
  const suffix = input.value.slice(end)
  const separator = prefix !== '' && !prefix.endsWith('\n') ? '\n' : ''
  const text = `${prefix}${separator}${phrase}${suffix}`
  if (text.length > input.maxLength) return setError('追问内容不能超过 4000 个字符')
  const caret = prefix.length + separator.length + phrase.length
  input.value = text
  state.draft.text = text
  input.focus()
  input.setSelectionRange(caret, caret)
}

function addQuickPhrase(value) {
  const phrase = value.trim().slice(0, MAX_QUICK_PHRASE_LENGTH)
  if (phrase === '') return false
  if (state.quickPhrases.includes(phrase)) return setError('这个快捷词已经存在')
  if (state.quickPhrases.length >= MAX_QUICK_PHRASES) return setError(`最多保留 ${MAX_QUICK_PHRASES} 个快捷词`)
  state.quickPhrases.push(phrase)
  persistQuickPhrases()
  return true
}

function updateQuickPhrase(index, value) {
  if (!Number.isInteger(index) || index < 0 || index >= state.quickPhrases.length) return
  const phrase = value.trim().slice(0, MAX_QUICK_PHRASE_LENGTH)
  if (phrase === '') {
    state.quickPhrases.splice(index, 1)
  } else if (state.quickPhrases.some((item, itemIndex) => itemIndex !== index && item === phrase)) {
    return setError('这个快捷词已经存在')
  } else {
    state.quickPhrases[index] = phrase
  }
  persistQuickPhrases()
  render()
}

function draftPlacement(cards) {
  const draft = state.draft
  if (draft === null || draft.kind === 'new') return null
  const parent = draft.anchorId === undefined
    ? cards.filter(card => card.dshThreadId === draft.parentId).at(-1)
    : cards.find(card => card.id === draft.anchorId)
  if (parent === undefined) return null
  // A continue card lands on the parent's own lane, one step to the right. A
  // branch card gets its own lane BELOW the parent (see
  // layoutConversationGraph), so place its draft there too — otherwise the
  // card visibly jumps down the moment the draft is submitted.
  const natural = draft.kind === 'branch'
    ? { x: parent.position.x + 365, y: parent.position.y + CARD_HEIGHT + CARD_GAP_Y }
    : { x: parent.position.x + 365, y: parent.position.y }
  return { parent, position: firstAvailableCardPosition(natural, cards.map(card => card.position)) }
}

function draftCard(cards) {
  const draft = state.draft
  if (draft?.kind === 'new') return `<article class="thread-card draft-card first-session-card" data-card-id="draft" style="left:86px;top:82px;--thread-color:#3478f6">
    <div class="thread-card-head"><span class="topic-dot"></span><strong>新会话</strong></div>
    <form class="draft-branch-form" data-draft><textarea maxlength="4000" placeholder="输入第一条消息" ${draft.sending ? 'disabled' : ''}>${escapeHtml(draft.text)}</textarea>${draftActions(draft)}</form>
  </article>`
  const placement = draftPlacement(cards)
  if (draft === null || placement === null) return ''
  const continuing = draft.kind === 'continue'
  return `<article class="thread-card draft-card" data-card-id="draft" style="left:${placement.position.x}px;top:${placement.position.y}px;--thread-color:#3478f6">
    <div class="thread-card-head"><span class="topic-dot"></span><strong>${continuing ? '新的追问' : '新的分支'}</strong></div>
    <form class="draft-branch-form" data-draft>${draftQuickPhrases(draft)}<textarea maxlength="4000" placeholder="${continuing ? '输入追问' : '输入这个分支的新问题'}" ${draft.sending ? 'disabled' : ''}>${escapeHtml(draft.text)}</textarea>${draftActions(draft)}</form>
  </article>`
}

function selectionFollowupButton() {
  return `<button class="selection-followup" type="button" data-action="follow-selection" hidden aria-label="基于所选内容创建追问" title="基于所选内容追问"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 3.5h10v6.25H7.2L4 12.5V9.75H3Z"/><path d="M8 4.9v3.4M6.3 6.6h3.4"/></svg><span>追问</span></button>`
}

// Cards are mounted into the DOM only when they intersect the viewport
// (inflated by VIEWPORT_MARGIN) in world coordinates. The camera transform is
// translate(camera) scale(zoom), so screen = world * zoom + camera.
function visibleCardIds(cards) {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return new Set(cards.map(card => card.id))
  const bounds = viewport.getBoundingClientRect()
  const left = (-state.canvasCamera.x - VIEWPORT_MARGIN) / state.zoom
  const right = (bounds.width - state.canvasCamera.x + VIEWPORT_MARGIN) / state.zoom
  const top = (-state.canvasCamera.y - VIEWPORT_MARGIN) / state.zoom
  const bottom = (bounds.height - state.canvasCamera.y + VIEWPORT_MARGIN) / state.zoom
  const visible = new Set()
  for (const card of cards) {
    const thread = state.workspace?.threads.find(item => item.id === card.dshThreadId)
    // A pending reply holds its card mounted even off-screen. The optimistic
    // branch node keys its pending reply by THREAD id (it has no session yet),
    // so both keyings must count — otherwise the just-created branch is culled
    // the moment it lands outside the viewport.
    const held = thread !== undefined && (state.pendingReplies.has(thread.dshSessionId) || state.pendingReplies.has(thread.id))
    if (held) {
      visible.add(card.id)
      continue
    }
    const { x, y } = card.position
    if (x + CARD_WIDTH < left || x > right || y + CARD_HEIGHT < top || y > bottom) continue
    visible.add(card.id)
  }
  return visible
}

// Incrementally mount cards entering the viewport and unmount cards leaving
// it, without rebuilding the canvas. Called after pan/zoom/focus camera moves.
function syncCanvasViewport() {
  if (state.mode !== 'canvas' || state.canvasCards === undefined) return
  const layer = document.querySelector('.cards-layer')
  if (!(layer instanceof HTMLElement)) return
  const visible = visibleCardIds(state.canvasCards)
  for (const cardId of [...state.mountedCardIds]) {
    if (visible.has(cardId)) continue
    const element = layer.querySelector(`[data-card-id="${selectorValue(cardId)}"]`)
    if (element instanceof HTMLElement) element.remove()
    state.mountedCardIds.delete(cardId)
  }
  for (const card of state.canvasCards) {
    if (!visible.has(card.id) || state.mountedCardIds.has(card.id)) continue
    const wrapper = document.createElement('div')
    wrapper.innerHTML = conversationCard(card, state.canvasGraph)
    const element = wrapper.firstElementChild
    if (element instanceof HTMLElement) {
      layer.appendChild(element)
      const handle = element.querySelector('[data-drag-card]')
      if (handle instanceof HTMLElement) bindDragHandle(handle)
    }
    state.mountedCardIds.add(card.id)
  }
}

function requestCanvasRefresh() {
  state.canvasDirty = true
  flushCanvasRefresh()
}

function canvasStructureSignature(cards) {
  return JSON.stringify(cards.map(card => [card.id, card.parentId, card.position.x, card.position.y, card.hidden === true]))
}

function patchCardContents(element, card, graph) {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = conversationCard(card, graph)
  const next = wrapper.firstElementChild
  if (!(next instanceof HTMLElement)) return
  if (card.hidden === true || element.classList.contains('hidden-card')) {
    if (element.outerHTML !== next.outerHTML) {
      element.replaceWith(next)
      const handle = next.querySelector('[data-drag-card]')
      if (handle instanceof HTMLElement) bindDragHandle(handle)
    }
    return
  }
  element.className = next.className
  element.dataset.thread = next.dataset.thread
  element.dataset.state = next.dataset.state
  element.dataset.positionKey = next.dataset.positionKey
  element.style.left = `${card.position.x}px`
  element.style.top = `${card.position.y}px`
  for (const selector of ['.thread-card-head', '.thread-meta', 'footer', '.graph-continue-button', '.graph-fold-button', '.graph-branch-button']) {
    const previous = element.querySelector(selector)
    const replacement = next.querySelector(selector)
    if ((previous?.synapseMarkup ?? previous?.outerHTML) === replacement?.outerHTML) continue
    if (replacement !== null) replacement.synapseMarkup = replacement.outerHTML
    if (replacement === null) previous?.remove()
    else if (previous === null) element.appendChild(replacement)
    else previous.replaceWith(replacement)
  }
  const answer = element.querySelector('.thread-answer')
  const nextAnswer = next.querySelector('.thread-answer')
  if (answer instanceof HTMLElement && nextAnswer !== null && answer.innerHTML !== nextAnswer.innerHTML) {
    const scrollTop = answer.scrollTop
    answer.innerHTML = nextAnswer.innerHTML
    answer.scrollTop = scrollTop
    delete answer.dataset.liveText
  }
}

function flushCanvasRefresh() {
  if (!state.canvasDirty || !canReplaceView()) return
  if (state.mode !== 'canvas' || !state.canvasViewInitialized || document.querySelector('.cards-layer') === null) {
    render()
    return
  }
  const allCards = conversationCards(visibleThreads())
  const graph = conversationGraphView(allCards)
  state.canvasAllCards = allCards
  const signature = canvasStructureSignature(graph.cards)
  const changed = signature !== state.canvasStructureSignature
  state.canvasCards = graph.cards
  state.canvasCardsById = new Map(graph.cards.map(card => [card.id, card]))
  state.canvasGraph = graph
  syncCanvasViewport()
  for (const card of graph.cards) {
    if (!state.mountedCardIds.has(card.id)) continue
    const element = app.querySelector(`[data-card-id="${CSS.escape(card.id)}"]`)
    if (element instanceof HTMLElement) patchCardContents(element, card, graph)
  }
  if (changed) {
    const connectors = document.querySelector('.connectors')
    if (connectors !== null) connectors.innerHTML = canvasConnectors(graph.cards)
    cacheCardConnectors()
    const minimap = document.querySelector('.canvas-minimap')
    if (minimap !== null) {
      minimap.outerHTML = renderCanvasMinimap()
      installCanvasMinimap()
    }
  }
  const selected = state.canvasCardsById.get(state.inspectorCardId)
  const inspector = document.querySelector('.card-inspector')
  if ((selected === undefined || selected.hidden) && state.inspectorCardId !== null) {
    closeCardInspector({ animate: false })
    inspector?.remove()
    applyInspectorLayout()
  } else if (selected !== undefined && inspector instanceof HTMLElement) {
    const wrapper = document.createElement('div')
    wrapper.innerHTML = renderCardInspector(selected)
    const scroll = inspector.querySelector('.card-inspector-scroll')
    const nextScroll = wrapper.querySelector('.card-inspector-scroll')
    if (scroll instanceof HTMLElement && nextScroll !== null && scroll.innerHTML !== nextScroll.innerHTML) {
      const scrollTop = scroll.scrollTop
      scroll.innerHTML = nextScroll.innerHTML
      scroll.scrollTop = scrollTop
    }
    for (const selector of ['.card-inspector-meta', '.card-inspector-actions', '.card-inspector-tools']) {
      const previous = inspector.querySelector(selector)
      const next = wrapper.querySelector(selector)
      if (previous !== null && next !== null && previous.innerHTML !== next.innerHTML) previous.innerHTML = next.innerHTML
    }
  }
  state.canvasStructureSignature = signature
  state.canvasDirty = false
  syncCanvasMinimap()
}

function renderCanvas() {
  // No empty state: the canvas itself is the home screen. A workspace with no
  // conversations simply renders an empty, pannable canvas; the sidebar's
  // 新会话 button is the entry point.
  const threads = visibleThreads()
  const allCards = conversationCards(threads)
  state.canvasAllCards = allCards
  const graph = conversationGraphView(allCards)
  const cards = graph.cards
  state.canvasCards = cards
  state.canvasCardsById = new Map(cards.map(card => [card.id, card]))
  if (state.canvasCardsById.get(state.selectedCardId)?.hidden) state.selectedCardId = null
  state.canvasGraph = graph
  state.canvasStructureSignature = canvasStructureSignature(cards)
  if (state.inspectorCardId !== null && (!state.canvasCardsById.has(state.inspectorCardId) || state.canvasCardsById.get(state.inspectorCardId).hidden)) {
    state.inspectorCardId = null
    state.inspectorOpening = false
  }
  if (!state.canvasViewInitialized) {
    state.canvasCamera = initialCanvasCamera(cards)
    state.canvasViewInitialized = true
    // The viewport is not laid out yet while renderCanvas builds its HTML;
    // center the focused card once the DOM is mounted (render tail).
    state.canvasNeedsCenter = true
  }
  const visible = visibleCardIds(cards)
  state.mountedCardIds = new Set(visible)
  const mounted = cards.filter(card => visible.has(card.id))
  const inspector = state.inspectorCardId === null ? '' : renderCardInspector(state.canvasCardsById.get(state.inspectorCardId))
  const viewClass = `canvas-view${inspector !== '' && state.inspectorExpanded ? ' inspector-expanded' : ''}`
  const viewStyle = inspector === '' || state.inspectorExpanded ? '' : ` style="--inspector-width:${clampInspectorWidth(state.inspectorWidth)}px"`
  return `<section class="${viewClass}"${viewStyle}><div class="canvas-viewport"><div class="canvas-content" style="transform:translate(${state.canvasCamera.x}px, ${state.canvasCamera.y}px) scale(${state.zoom})"><div class="connectors">${canvasConnectors(cards)}</div><div class="cards-layer">${mounted.map(card => conversationCard(card, graph)).join('')}${draftCard(cards)}</div></div></div>${inspector}</section>`
}

function processRecords(process, messageId) {

  const key = `${messageId}:process`
  const expanded = state.expandedMessageIds.has(key)
  const entries = process.map((entry, index) => {
    const entryKey = `${key}:${index}`
    const entryExpanded = state.expandedMessageIds.has(entryKey)
    const status = entry.error !== null ? '失败' : entry.result === null ? '等待结果' : '完成'
    const argumentsHtml = entry.arguments === null || entry.arguments === '' ? '' : `<pre class="process-args">${escapeHtml(entry.arguments)}</pre>`
    const outcomeHtml = entry.error !== null ? `<pre class="process-error">${escapeHtml(entry.error)}</pre>` : entry.result === null ? '' : `<pre class="process-result">${escapeHtml(entry.result)}</pre>`
    return `<div class="process-entry${entryExpanded ? ' expanded' : ''}"><button class="process-entry-fold" data-action="toggle-message" data-message="${escapeHtml(entryKey)}"><span class="process-entry-name">${escapeHtml(entry.name)}</span><span class="process-status${entry.error !== null ? ' process-status-error' : entry.result === null ? ' process-status-pending' : ' process-status-done'}">${status}</span></button>${entryExpanded ? `<div class="process-entry-body">${argumentsHtml}${outcomeHtml}</div>` : ''}</div>`
  }).join('')
  return `<section class="process-records${expanded ? ' expanded' : ''}"><button class="process-records-fold" data-action="toggle-message" data-message="${escapeHtml(key)}"><span>${expanded ? '收起过程记录' : '过程记录'}</span><span class="process-count">${process.length}</span></button>${expanded ? entries : ''}</section>`
}

/**
 * The turn's last assistant markdown.
 *
 * A turn can emit several assistant steps (a preamble, then the real reply).
 * The drawer shows only the last non-empty one; earlier steps stay in the
 * process log / 详情 pane. An empty fallback is the card summary, which is
 * already the projection's final reply.
 */
function lastAssistantText(steps, fallback) {
  const texts = []
  for (const step of steps ?? []) {
    if (step?.kind === 'assistant' && typeof step.text === 'string' && step.text !== '') texts.push(step.text)
  }
  if (texts.length > 0) return texts[texts.length - 1]
  return typeof fallback === 'string' ? fallback : ''
}

/**
 * The reply body of one inspector card, resolved from its on-demand detail.
 *
 * A settled card keeps its own text even while a LATER turn of the same
 * session streams live: the session-level `running` flag belongs to the
 * in-flight card only, so it must never be read here. When the detail read
 * failed (or has not landed yet) the stored card summary carries the card —
 * the pane degrades, it never breaks.
 *
 * @returns the last output markdown plus whether the reply is still pending.
 */
function inspectorReply(card) {
  const thread = state.workspace?.threads.find(item => item.id === card.dshThreadId)
  const detail = thread === undefined ? null : historyForCard(thread, card.id)
  const steps = detail?.steps ?? []
  const pending = card.answer?.pending === true || card.status === 'running' || card.status === 'queued'
  const outdated = Number.isSafeInteger(card.answerSeq) && (!Number.isSafeInteger(detail?.revision) || detail.revision < card.answerSeq)
  const answerText = (pending || outdated) && card.answer?.text
    ? card.answer.text
    : lastAssistantText(steps, card.answer?.text ?? '')
  return { pending, answerText }
}

function inspectorNoteBody({ question, answer, workspaceTitle, sessionTitle, turnIndex, sessionId }) {
  const title = String(question ?? '').trim() || '会话回复'
  const source = [
    '来源：会话地图',
    workspaceTitle ? `工作区：${workspaceTitle}` : '',
    sessionTitle ? `会话：${sessionTitle}` : '',
    Number.isInteger(turnIndex) ? `轮次：第 ${turnIndex + 1} 轮` : '',
    sessionId ? `会话 ID：${sessionId}` : '',
  ].filter(Boolean).join('\n')
  return `# ${title}\n\n${String(answer ?? '').trim()}\n\n---\n\n${source}\n`
}

function setInspectorTocOpen(open) {
  state.inspectorTocOpen = open
  const toc = document.querySelector('.card-inspector-toc')
  const toggle = document.querySelector('[data-action="toggle-inspector-toc"]')
  if (toc instanceof HTMLElement) {
    toc.hidden = !open
    toc.classList.toggle('is-open', open)
  }
  if (toggle instanceof HTMLElement) {
    toggle.classList.toggle('is-active', open)
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
  }
}

function inspectorTocIsDocked() {
  return state.inspectorExpanded === true && window.matchMedia('(min-width: 761px)').matches
}

function renderInspectorToc(headings) {
  if (headings.length === 0 || state.inspectorTocOpen !== true) return ''
  const items = headings.map(item => `<button type="button" class="card-inspector-toc-item" data-action="jump-heading" data-heading="${escapeHtml(item.id)}" style="--toc-level:${item.level}">${escapeHtml(item.text)}</button>`).join('')
  return `<nav class="card-inspector-toc is-open" aria-label="目录" style="--inspector-toc-width:${clampInspectorTocWidth(state.inspectorTocWidth)}px"><div class="card-inspector-toc-resize" role="separator" aria-orientation="vertical" aria-label="调整目录宽度" title="拖动调整宽度"></div><div class="card-inspector-toc-list">${items}</div></nav>`
}

function renderCardInspector(card) {
  if (card === undefined) return ''
  const thread = state.workspace?.threads.find(item => item.id === card.dshThreadId)
  if (thread === undefined) return ''
  // Full text is read back from the DSH session on open; until it arrives the
  // card summary renders, which is what the canvas shows anyway.
  const detail = historyForCard(thread, card.id)
  const { pending, answerText } = inspectorReply(card)
  // The drawer shows the turn's last output markdown only. Intermediate
  // assistant steps stay out of this surface; 详情 opens the live turn flow.
  const errorText = card.error === null
    ? null
    : (detail?.steps ?? []).filter(step => step.kind === 'error').map(step => step.text).join('\n\n') || card.error.text
  const answer = answerText === ''
    ? errorText === null ? '<p class="card-inspector-pending">正在回复</p>' : ''
    : `<article class="card-inspector-answer">${renderMarkdown(answerText)}${pending ? '<p class="card-inspector-pending">正在回复</p>' : ''}</article>`
  const error = errorText === null ? '' : `<section class="card-inspector-error" role="alert"><strong>本轮未完成</strong><p>${escapeHtml(errorText)}</p></section>`
  const continueAction = card.canContinue === true ? `<button type="button" data-action="open-continue" data-thread="${thread.id}" data-card="${escapeHtml(card.id)}"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 3.5h11v7h-6l-3.5 2.5v-2.5h-1.5Z"/><path d="M8 5.5v3M6.5 7h3"/></svg>继续追问</button>` : ''
  const branchSeq = cardState(card, sessionStatusFor(thread)) === 'done' ? (Number.isSafeInteger(card.answerSeq) ? card.answerSeq : card.answer?.sourceSeq) : undefined
  const branch = Number.isInteger(branchSeq)
    ? `<button type="button" data-action="open-branch" data-thread="${thread.id}" data-card="${escapeHtml(card.id)}" data-seq="${branchSeq}"><svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="4" cy="3.5" r="1.5"/><circle cx="12" cy="3.5" r="1.5"/><circle cx="12" cy="12.5" r="1.5"/><path d="M5.5 3.5h2A2.5 2.5 0 0 1 10 6v5"/></svg>创建分支</button>`
    : ''
  const openDshAction = `<button class="primary" type="button" data-action="open-dsh" data-thread="${thread.id}" data-seq="${Number.isInteger(branchSeq) ? branchSeq : ''}"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M7 3.5H4.5A1.5 1.5 0 0 0 3 5v6.5A1.5 1.5 0 0 0 4.5 13H11a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M9.5 3.5h3v3M12.4 3.6 7.5 8.5"/></svg>在 DSH 中打开</button>`
  const question = card.customTitle ?? detail?.question ?? card.question
  const headings = typeof answerText === 'string' && answerText !== '' ? markdownHeadings(answerText) : []
  const noteSave = state.inspectorNoteSave?.cardId === card.id ? state.inspectorNoteSave.status : 'idle'
  const noteBusy = noteSave === 'saving' || answerText === null || answerText === '' || card.answer?.pending === true
  const noteLabel = noteSave === 'saving' ? '正在添加' : noteSave === 'saved' ? '已添加到笔记' : noteSave === 'error' ? '添加失败' : '添加到笔记'
  const renameAction = card.blank === true ? '' : `<button class="card-inspector-icon-action" type="button" data-action="rename-card" data-card="${escapeHtml(card.id)}" aria-label="重命名标题" title="重命名标题"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M11.9 2.9 13.1 4.1 5.4 11.8 3.6 12.4 4.2 10.6Z"/><path d="m10.7 4.1 1.2 1.2"/></svg></button>`
  const hideReason = cardHideReason(card, sessionStatusFor(thread), state.draft)
  const hideAction = card.blank === true ? '' : `<button class="card-inspector-icon-action" type="button" data-action="hide-card" data-card="${escapeHtml(card.id)}" aria-label="从地图隐藏" title="${escapeHtml(hideReason ?? '从地图隐藏')}" ${hideReason !== null || state.visibilityMutation ? 'disabled' : ''}>${visibilityIcon('hidden')}</button>`
  const addToNotes = `<button class="card-inspector-icon-action${noteSave === 'saved' ? ' is-saved' : ''}" type="button" data-action="add-to-notes" data-thread="${thread.id}" data-card="${escapeHtml(card.id)}" aria-label="${noteLabel}" title="${noteLabel}" ${noteBusy ? 'disabled' : ''}><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M4.5 2.5h7A1.5 1.5 0 0 1 13 4v9.5L8 11.2 3 13.5V4A1.5 1.5 0 0 1 4.5 2.5Z"/></svg></button>`
  const tocButton = headings.length === 0 ? '' : `<button class="card-inspector-icon-action${state.inspectorTocOpen ? ' is-active' : ''}" type="button" data-action="toggle-inspector-toc" aria-expanded="${state.inspectorTocOpen ? 'true' : 'false'}" aria-label="目录" title="目录"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 4h10M3 8h10M3 12h7"/></svg></button>`
  const expandLabel = state.inspectorExpanded ? '还原' : '铺满'
  const expandIcon = state.inspectorExpanded
    ? '<path d="M6 3.5h6.5V10M3.5 6v6.5H10"/>'
    : '<path d="M3.5 6.5V3.5h3M12.5 6.5V3.5h-3M3.5 9.5v3h3M12.5 9.5v3h-3"/>'
  const expandButton = `<button class="card-inspector-icon-action${state.inspectorExpanded ? ' is-active' : ''}" type="button" data-action="toggle-inspector-expand" aria-pressed="${state.inspectorExpanded ? 'true' : 'false'}" aria-label="${expandLabel}" title="${expandLabel}"><svg aria-hidden="true" viewBox="0 0 16 16">${expandIcon}</svg></button>`
  const inspectorClass = `card-inspector${state.inspectorOpening ? ' is-opening' : ''}${state.inspectorExpanded ? ' is-expanded' : ''}`
  const inspectorWidth = state.inspectorExpanded ? '100%' : `${clampInspectorWidth(state.inspectorWidth)}px`
  return `<aside class="${inspectorClass}" aria-label="卡片详情" data-inspector-card="${escapeHtml(card.id)}" style="width:${inspectorWidth}"><div class="card-inspector-resize" role="separator" aria-orientation="vertical" aria-label="调整宽度" title="拖动调整宽度"></div><header class="card-inspector-head"><div class="card-inspector-meta"><span>第 ${card.turnIndex + 1} 轮</span>${errorText === null ? '' : '<span class="card-inspector-error-status">失败</span>'}</div><div class="card-inspector-tools">${renameAction}${hideAction}${addToNotes}${tocButton}${expandButton}<button class="card-inspector-close" type="button" data-action="close-card-inspector" aria-label="关闭卡片详情" title="关闭"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button></div>${state.renamingCardId === card.id ? cardRenameForm(card, 'card-inspector-rename-input') : `<h2>${escapeHtml(question)}</h2>`}</header><div class="card-inspector-body"><div class="card-inspector-scroll">${error}${answer}</div>${renderInspectorToc(headings)}</div><footer class="card-inspector-actions">${continueAction}${branch}${openDshAction}</footer></aside>`
}

function renderThread() {
  const thread = currentThread()
  if (thread === null) return renderCanvas()
  const waiting = state.pendingReplies.has(thread.dshSessionId)
  // One section per turn, each reading its full text on demand.
  const cards = turnsFor(thread).map((turn, index) => ({ id: turn.cardId ?? `${thread.id}:turn:${turn.seq ?? `i${index}`}`, turn, index }))
  const body = cards.map(card => {
    const detail = historyForCard(thread, card.id)
    const answer = lastAssistantText(detail?.steps, card.turn.answer ?? '')
    const failure = detail?.steps.filter(step => step.kind === 'error').map(step => step.text).join('\n\n') ?? card.turn.error ?? ''
    const process = detail?.process ?? []
    const processHtml = process.length === 0 ? '' : processRecords(process, `${thread.id}:${card.id}:detail`)
    return `<section class="detail-turn" data-card-id="${escapeHtml(card.id)}"><header class="detail-turn-head"><span class="detail-turn-index">第 ${card.index + 1} 轮</span>${process.length > 0 ? `<span class="detail-turn-tools">工具 ${process.length}</span>` : ''}</header><article class="message message-user"><header><span class="message-role">你</span></header><div class="message-body">${renderMarkdown(detail?.question ?? card.turn.question ?? '')}</div></article>${answer === '' && failure === '' ? '<p class="note-empty">正在回复</p>' : `<article class="message message-assistant"><header><span class="message-role">DSH</span></header><div class="message-body">${renderMarkdown(answer)}</div></article>`}${failure === '' ? '' : `<section class="card-inspector-error" role="alert"><strong>本轮未完成</strong><p>${escapeHtml(failure)}</p></section>`}${processHtml}</section>`
  }).join('')
  const latestAssistantSeq = [...cards].reverse().find(card => Number.isSafeInteger(card.turn.answerSeq))?.turn.answerSeq
  return `<section class="detail-view"><header class="detail-head"><div class="detail-head-title"><div class="detail-head-meta"><span class="detail-badge">${thread.parentId === null ? '会话' : '分支'}</span>${thread.dshSessionTitle ?? thread.title ? `<span class="detail-subtitle">${escapeHtml(thread.dshSessionTitle ?? thread.title)}</span>` : ''}</div><h1>${escapeHtml(questionFor(thread))}</h1></div><div class="detail-head-actions"><button data-action="open-dsh" data-thread="${thread.id}" data-seq="${Number.isInteger(latestAssistantSeq) ? latestAssistantSeq : ''}" title="在原生对话中打开此会话">在 DSH 中打开</button><button data-action="open-branch" data-thread="${thread.id}" title="基于最新回答创建分支">创建分支</button><button class="primary" data-action="show-canvas">返回画布</button></div></header><div class="detail-scroll">${body || '<div class="note-empty">等待这条会话的第一条消息。</div>'}</div><form class="message-composer" data-compose="${thread.id}"><textarea maxlength="4000" placeholder="继续当前会话…" ${waiting ? 'disabled' : ''}></textarea><button class="primary" type="submit" ${waiting ? 'disabled' : ''}>${waiting ? '等待回复' : '发送'}</button></form></section>`
}

function visibilityIcon(kind) {
  // Lucide EyeOff. See docs/third-party-notices.md.
  const paths = {
    hidden: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  }
  return `<svg class="visibility-icon" aria-hidden="true" viewBox="0 0 24 24">${paths[kind] ?? ''}</svg>`
}

function render() {
  state.canvasDirty = false
  // Remember the departing thread's scroll position per thread id, so
  // switching sessions restores each conversation's own place instead of
  // smearing one session's position onto another.
  if (state.mode === 'thread' && state.detailThreadId !== null) {
    const detail = document.querySelector('.detail-scroll')
    if (detail instanceof HTMLElement) state.detailScrollByThread.set(state.detailThreadId, detail.scrollTop)
  }
  // Inspector scroll is owned by the scroll listener. Reading scrollTop here
  // after a remount would capture 0 and pin the drawer to the top.
  state.detailThreadId = state.mode === 'thread' ? state.activeId : null
  const detailScrollTop = state.detailThreadId === null ? null : state.detailScrollByThread.get(state.detailThreadId) ?? null
  const inspectorScrollTop = state.mode === 'canvas' && state.inspectorCardId !== null ? state.inspectorScrollByCard.get(state.inspectorCardId) ?? null : null
  const cardScrollTops = new Map()
  if (state.mode === 'canvas') {
    // Key by the unique card id: every card of a session shares data-thread,
    // so keying on it would clobber sibling cards' scroll positions. Only
    // scrollable answers have a position worth preserving; reading the two
    // height properties shares the same forced layout as the scrollTop read.
    for (const answer of document.querySelectorAll('.thread-card[data-thread] .thread-answer')) {
      if (answer.scrollHeight <= answer.clientHeight) continue
      const card = answer.closest('.thread-card')
      if (card instanceof HTMLElement && typeof card.dataset.cardId === 'string') cardScrollTops.set(card.dataset.cardId, answer.scrollTop)
    }
  }
  const workspace = state.workspace
  const threads = workspace?.threads ?? []
  const view = state.mode === 'thread' ? renderThread() : renderCanvas()
  const choices = workspaceChoices()
  const selectedWorkspaceId = state.selectedDshWorkspaceId ?? workspace?.id
  // The canvas renders even with zero cards (no empty state), so its chrome —
  // zoom controls and minimap — must render with it.
  const showCanvasChrome = state.mode === 'canvas'
  const canvasControls = showCanvasChrome ? `<div class="canvas-controls"><button data-action="layout" title="整理节点" aria-label="整理节点"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/></svg>整理</button><button data-action="focus-active" title="定位到当前会话" aria-label="定位到当前会话"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="3.2"/><path d="M8 1.5v2.6M8 11.9v2.6M1.5 8h2.6M11.9 8h2.6"/></svg>定位</button><button data-action="zoom-out" aria-label="缩小" title="缩小"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3.5 8h9"/></svg></button><span>${Math.round(state.zoom * 100)}%</span><button data-action="zoom-in" aria-label="放大" title="放大"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg></button></div>` : ''
  const canvasMinimap = showCanvasChrome ? renderCanvasMinimap() : ''
  const detailAvailable = currentThread() !== null
  const sidebarThreads = threads.filter(thread => thread.parentId === null)
  const sidebarActiveId = rootThreadOf(threads.find(item => item.id === state.activeId), threads)?.id ?? state.activeId
  const canvasTabs = `<nav class="canvas-tabs" aria-label="会话地图视图"><button class="${state.mode === 'canvas' ? 'active' : ''}" data-action="show-canvas">地图</button><button class="${state.mode === 'thread' ? 'active' : ''}" data-action="show-thread" data-thread="${state.activeId ?? ''}" ${detailAvailable ? '' : 'disabled'}>详情</button></nav>`
  app.innerHTML = `<main class="synapse-shell ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}"><aside class="sidebar"><div class="sidebar-brand-row"><div class="brand" aria-label="Synapse"><svg class="brand-mark" aria-hidden="true" viewBox="0 0 32 32" fill="none"><path d="M9 10.5 16 7l7 3.5M9 10.5v8L16 22m0-15v15m7-11.5v8L16 22"/><circle cx="9" cy="10" r="2.5"/><circle cx="23" cy="10" r="2.5"/><circle cx="16" cy="23" r="2.5"/></svg><strong>Synapse</strong></div><button class="sidebar-toggle" type="button" data-action="toggle-sidebar" aria-label="${state.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}" title="${state.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.25"/><path d="M6 2v12"/></svg></button></div><button class="new-workspace" type="button" data-action="create-session" ${state.draft !== null ? 'disabled' : ''}><svg class="new-session-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.75v6.5M4.75 8h6.5"/></svg><span>新会话</span></button><label class="workspace-label"><span>工作区</span><span class="workspace-select"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 4.75h3l1.2 1.5h6.8v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z"/></svg><select data-action="select-workspace" aria-label="选择工作区" ${state.draft !== null ? 'disabled' : ''}>${choices.map(item => `<option value="${item.id}" title="${escapeHtml(item.path ?? item.title)}" ${item.id === selectedWorkspaceId ? 'selected' : ''}>${escapeHtml(item.title)}</option>`).join('')}</select></span></label><div class="sidebar-heading"><span>会话</span></div><nav class="thread-tree">${sidebarThreads.map(thread => `<button class="tree-row ${thread.id === sidebarActiveId ? 'active' : ''}" data-action="select-thread" data-thread="${thread.id}" style="--thread-color:#374151"><span class="tree-dot"></span><span>${escapeHtml(threadListTitle(thread))}</span>${thread.parentId === null ? '' : '<i>分支</i>'}</button>`).join('') || '<p class="tree-empty">暂未同步会话</p>'}</nav></aside><header class="topbar"><div class="view-switch" role="group" aria-label="视图切换"><button data-action="close" type="button" aria-pressed="false">对话</button><button class="active" type="button" aria-pressed="true">会话地图</button></div>${canvasControls}${canvasMinimap}</header><section class="main-stage">${state.error ? `<div class="status-message" role="alert"><span>${escapeHtml(state.error)}</span><button data-action="dismiss-error" aria-label="关闭" title="关闭">×</button></div>` : ''}${canvasTabs}${view}${selectionFollowupButton()}</section></main>`
  installDragging()
  installInspectorResize()
  installInspectorTocResize()
  applyInspectorLayout()
  installCanvasMinimap()
  syncCanvasMinimap()
  cacheCardConnectors()
  // The initial camera from renderCanvas is inset (viewport not laid out yet);
  // center it on the focused card once the canvas DOM is mounted.
  if (state.canvasNeedsCenter) {
    state.canvasNeedsCenter = false
    window.requestAnimationFrame(() => { if (state.mode === 'canvas') focusActiveCard() })
  }
  for (const [cardId, scrollTop] of cardScrollTops) {
    const answer = app.querySelector(`.thread-card[data-card-id="${CSS.escape(cardId)}"] .thread-answer`)
    if (answer instanceof HTMLElement) answer.scrollTop = scrollTop
  }
  if (detailScrollTop !== null) window.requestAnimationFrame(() => {
    const nextDetail = document.querySelector('.detail-scroll')
    if (nextDetail instanceof HTMLElement) nextDetail.scrollTop = detailScrollTop
  })
  restoreInspectorScroll(inspectorScrollTop)
  if (state.inspectorOpening) window.requestAnimationFrame(() => {
    document.querySelector('.card-inspector')?.classList.remove('is-opening')
    state.inspectorOpening = false
  })
  // A rename remounts its input on every render; focus it once and select the
  // current title so typing replaces it outright.
  if (state.renamingCardId !== null) {
    const renameInput = app.querySelector(`[data-rename-input="${CSS.escape(state.renamingCardId)}"]`)
    if (renameInput instanceof HTMLInputElement && document.activeElement !== renameInput) {
      renameInput.focus()
      renameInput.select()
    }
  }
  // Jump the detail view to the card the user clicked: card ids carry the
  // source sequence (`<thread>:turn:<seq>`), which matches data-message-seq
  // anchors on the rendered messages.
  const targetCardId = state.detailTargetCardId
  state.detailTargetCardId = null
  if (targetCardId !== null) {
    const match = /:turn:(\d+)$/.exec(targetCardId)
    const seq = match === null ? null : match[1]
    if (seq !== null) window.requestAnimationFrame(() => {
      const target = app.querySelector(`[data-message-seq="${CSS.escape(seq)}"]`)
      if (target instanceof HTMLElement) target.scrollIntoView({ block: 'start' })
    })
  }
}

function renderPreservingDetailScroll() {
  render()
}

let inspectorCloseTimer = 0
function openCardInspector(cardId) {
  if (inspectorCloseTimer !== 0) {
    window.clearTimeout(inspectorCloseTimer)
    inspectorCloseTimer = 0
  }
  dismissTurnPane()
  state.inspectorOpening = state.inspectorCardId === null
  state.inspectorCardId = cardId
  const thread = state.workspace?.threads.find(item => item.id === state.canvasCardsById?.get(cardId)?.dshThreadId)
  if (thread !== undefined) {
    void loadThreadHistory(thread, cardId).then(() => {
      if (state.inspectorCardId === cardId) render()
    })
  }
}

function closeCardInspector({ animate = true } = {}) {
  if (state.inspectorCardId === null) return
  if (inspectorCloseTimer !== 0) window.clearTimeout(inspectorCloseTimer)
  const cardId = state.inspectorCardId
  const inspector = document.querySelector('.card-inspector')
  if (!animate || !(inspector instanceof HTMLElement)) {
    state.inspectorCardId = null
    state.inspectorOpening = false
    state.inspectorTocOpen = false
    state.inspectorExpanded = false
    state.inspectorNoteSave = null
    render()
    return
  }
  inspector.classList.add('is-closing')
  inspectorCloseTimer = window.setTimeout(() => {
    inspectorCloseTimer = 0
    if (state.inspectorCardId !== cardId) return
    state.inspectorCardId = null
    state.inspectorOpening = false
    state.inspectorTocOpen = false
    state.inspectorExpanded = false
    state.inspectorNoteSave = null
    render()
  }, 180)
}

function applyCanvasTransform() {
  const content = document.querySelector('.canvas-content')
  if (content instanceof HTMLElement) content.style.transform = `translate(${state.canvasCamera.x}px, ${state.canvasCamera.y}px) scale(${state.zoom})`
  syncCanvasMinimap()
}

const MINIMAP_WIDTH = 176
const MINIMAP_HEIGHT = 118
const MINIMAP_INSET = 6

function canvasWorldExtents(cards) {
  const points = []
  for (const card of cards) points.push(canvasNodeBounds(card))
  if (state.draft?.kind === 'new') points.push({ x: 86, y: 82 })
  else {
    const placement = draftPlacement(cards)
    if (placement !== null) points.push(placement.position)
  }
  if (points.length === 0) return { x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x + (point.width ?? CARD_WIDTH))
    maxY = Math.max(maxY, point.y + (point.height ?? CARD_HEIGHT))
  }
  const pad = Math.max(CARD_WIDTH, CARD_HEIGHT) * 0.35
  return { x: minX - pad, y: minY - pad, w: Math.max(1, maxX - minX + pad * 2), h: Math.max(1, maxY - minY + pad * 2) }
}

function minimapProjection(cards) {
  const world = canvasWorldExtents(cards)
  const innerW = MINIMAP_WIDTH - MINIMAP_INSET * 2
  const innerH = MINIMAP_HEIGHT - MINIMAP_INSET * 2
  const scale = Math.min(innerW / world.w, innerH / world.h)
  const usedW = world.w * scale
  const usedH = world.h * scale
  return {
    world,
    scale,
    ox: MINIMAP_INSET + (innerW - usedW) / 2,
    oy: MINIMAP_INSET + (innerH - usedH) / 2,
  }
}

function minimapProject(map, x, y) {
  return { x: map.ox + (x - map.world.x) * map.scale, y: map.oy + (y - map.world.y) * map.scale }
}

function minimapUnproject(map, mx, my) {
  return { x: map.world.x + (mx - map.ox) / map.scale, y: map.world.y + (my - map.oy) / map.scale }
}

function visibleWorldRect() {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) {
    return { x: -state.canvasCamera.x / state.zoom, y: -state.canvasCamera.y / state.zoom, w: 1, h: 1 }
  }
  const bounds = viewport.getBoundingClientRect()
  return {
    x: -state.canvasCamera.x / state.zoom,
    y: -state.canvasCamera.y / state.zoom,
    w: bounds.width / state.zoom,
    h: bounds.height / state.zoom,
  }
}

function renderCanvasMinimap() {
  const cards = state.canvasCards ?? []
  const map = minimapProjection(cards)
  state.minimap = map
  const cardSize = { w: Math.max(3, CARD_WIDTH * map.scale), h: Math.max(2, CARD_HEIGHT * map.scale) }
  const dots = cards.map(card => {
    const bounds = canvasNodeBounds(card)
    const point = minimapProject(map, bounds.x, bounds.y)
    const size = { w: Math.max(3, bounds.width * map.scale), h: Math.max(2, bounds.height * map.scale) }
    const active = card.dshThreadId === state.activeId ? ' is-active' : ''
    return `<span class="canvas-minimap-card${active}${card.hidden ? ' is-hidden' : ''}" data-minimap-card="${escapeHtml(card.id)}" style="left:${point.x}px;top:${point.y}px;width:${size.w}px;height:${size.h}px"></span>`
  }).join('')
  let draftDot = ''
  const draftPosition = state.draft?.kind === 'new' ? { x: 86, y: 82 } : draftPlacement(cards)?.position
  if (draftPosition !== undefined) {
    const point = minimapProject(map, draftPosition.x, draftPosition.y)
    draftDot = `<span class="canvas-minimap-card is-draft" data-minimap-card="draft" style="left:${point.x}px;top:${point.y}px;width:${cardSize.w}px;height:${cardSize.h}px"></span>`
  }
  return `<aside class="canvas-minimap${state.inspectorCardId === null ? '' : ' beside-inspector'}${state.inspectorExpanded ? ' is-full' : ''}" aria-label="画布缩略图"><div class="canvas-minimap-stage">${dots}${draftDot}<span class="canvas-minimap-view" aria-hidden="true"></span></div></aside>`
}

function syncCanvasMinimap() {
  const view = document.querySelector('.canvas-minimap-view')
  const map = state.minimap
  if (!(view instanceof HTMLElement) || map === undefined) return
  const world = visibleWorldRect()
  const origin = minimapProject(map, world.x, world.y)
  view.style.left = `${origin.x}px`
  view.style.top = `${origin.y}px`
  view.style.width = `${Math.max(8, world.w * map.scale)}px`
  view.style.height = `${Math.max(6, world.h * map.scale)}px`
}

function centerCameraOnWorld(wx, wy) {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return
  const bounds = viewport.getBoundingClientRect()
  state.canvasCamera = {
    x: bounds.width / 2 - wx * state.zoom,
    y: bounds.height / 2 - wy * state.zoom,
  }
  applyCanvasTransform()
  syncCanvasViewport()
}

function installCanvasMinimap() {
  const stage = document.querySelector('.canvas-minimap-stage')
  if (!(stage instanceof HTMLElement)) return
  const localOf = event => {
    const box = stage.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }
  const jump = event => {
    const map = state.minimap
    if (map === undefined) return
    const local = localOf(event)
    const world = minimapUnproject(map, local.x, local.y)
    centerCameraOnWorld(world.x, world.y)
  }
  stage.addEventListener('pointerdown', event => {
    event.preventDefault()
    event.stopPropagation()
    jump(event)
    stage.setPointerCapture(event.pointerId)
    const move = moveEvent => jump(moveEvent)
    const stop = () => {
      stage.removeEventListener('pointermove', move)
      stage.removeEventListener('pointerup', stop)
      stage.removeEventListener('pointercancel', stop)
    }
    stage.addEventListener('pointermove', move)
    stage.addEventListener('pointerup', stop)
    stage.addEventListener('pointercancel', stop)
  })
}

function syncMinimapCardPosition(cardId, position) {
  const map = state.minimap
  const dot = document.querySelector(`[data-minimap-card="${selectorValue(cardId)}"]`)
  if (map === undefined || !(dot instanceof HTMLElement)) return
  const point = minimapProject(map, position.x, position.y)
  dot.style.left = `${point.x}px`
  dot.style.top = `${point.y}px`
}

function bindDragHandle(handle) {
  handle.addEventListener('pointerdown', event => {
    const cardId = event.currentTarget.dataset.dragCard
    const card = event.currentTarget.closest('.thread-card')
    if (cardId === undefined || !(card instanceof HTMLElement)) return
    event.preventDefault()
    const origin = { x: event.clientX, y: event.clientY, position: { x: Number.parseFloat(card.style.left), y: Number.parseFloat(card.style.top) } }
    const aliases = card.dataset.positionKey === undefined ? [] : [card.dataset.positionKey]
    let position = origin.position
    let stopped = false
    let frame = 0
    state.dragging = true
    // Coalesce pointermove updates to one DOM pass per animation frame so a
    // high report-rate pointer cannot queue a reflow per event.
    const apply = () => {
      frame = 0
      state.cardPositions.set(cardId, { x: Math.round(position.x), y: Math.round(position.y) })
      for (const alias of aliases) state.cardPositions.set(alias, { x: Math.round(position.x), y: Math.round(position.y) })
      // Keep the virtualized data object in sync so viewport visibility and
      // connector paths track the live drag position.
      const dataCard = state.canvasCardsById?.get(cardId)
      if (dataCard !== undefined) dataCard.position = { x: position.x, y: position.y }
      card.style.left = `${position.x}px`
      card.style.top = `${position.y}px`
      refreshCardConnectors(cardId)
      syncMinimapCardPosition(cardId, position)
    }
    const move = moveEvent => {
      position = { x: origin.position.x + (moveEvent.clientX - origin.x) / state.zoom, y: origin.position.y + (moveEvent.clientY - origin.y) / state.zoom }
      if (frame === 0) frame = window.requestAnimationFrame(apply)
    }
    const stop = () => {
      if (stopped) return
      stopped = true
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', stop)
      document.removeEventListener('pointercancel', stop)
      if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0 }
      apply()
      rememberCardPosition(cardId, position, aliases)
      state.dragging = false
      deferCanvasRefresh(120)
      scheduleLiveCardUpdate()
      // No full render: only the dragged card's inline position and its
      // connectors changed; rebuilding the whole canvas on drop is the jank.
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', stop)
    document.addEventListener('pointercancel', stop)
  })
}

function installDragging() {
  for (const handle of document.querySelectorAll('[data-drag-card]')) bindDragHandle(handle)
}

function installInspectorResize() {
  const handle = document.querySelector('.card-inspector-resize')
  const inspector = document.querySelector('.card-inspector')
  if (!(handle instanceof HTMLElement) || !(inspector instanceof HTMLElement)) return
  handle.addEventListener('pointerdown', event => {
    event.preventDefault()
    event.stopPropagation()
    if (state.inspectorExpanded) {
      state.inspectorExpanded = false
      inspector.classList.remove('is-expanded')
      document.querySelector('.canvas-view')?.classList.remove('inspector-expanded')
      document.querySelector('.canvas-minimap')?.classList.remove('is-full')
    }
    const originX = event.clientX
    const originWidth = inspector.getBoundingClientRect().width
    inspector.classList.add('is-resizing')
    document.documentElement.classList.add('is-resizing-inspector')
    state.dragging = true
    handle.setPointerCapture(event.pointerId)
    const move = moveEvent => {
      state.inspectorWidth = clampInspectorWidth(originWidth + originX - moveEvent.clientX)
      applyInspectorLayout()
    }
    const stop = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', stop)
      document.removeEventListener('pointercancel', stop)
      inspector.classList.remove('is-resizing')
      document.documentElement.classList.remove('is-resizing-inspector')
      persistInspectorLayout()
      state.dragging = false
      deferCanvasRefresh(120)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', stop)
    document.addEventListener('pointercancel', stop)
  })
}

function installInspectorTocResize() {
  const handle = document.querySelector('.card-inspector-toc-resize')
  const toc = document.querySelector('.card-inspector-toc')
  if (!(handle instanceof HTMLElement) || !(toc instanceof HTMLElement)) return
  handle.addEventListener('pointerdown', event => {
    if (!inspectorTocIsDocked()) return
    event.preventDefault()
    event.stopPropagation()
    const originX = event.clientX
    const originWidth = toc.getBoundingClientRect().width
    toc.classList.add('is-resizing')
    document.documentElement.classList.add('is-resizing-inspector')
    state.dragging = true
    handle.setPointerCapture(event.pointerId)
    const move = moveEvent => {
      state.inspectorTocWidth = clampInspectorTocWidth(originWidth + originX - moveEvent.clientX)
      applyInspectorTocLayout()
    }
    const stop = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', stop)
      document.removeEventListener('pointercancel', stop)
      toc.classList.remove('is-resizing')
      document.documentElement.classList.remove('is-resizing-inspector')
      persistInspectorLayout()
      state.dragging = false
      deferCanvasRefresh(120)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', stop)
    document.addEventListener('pointercancel', stop)
  })
}

function jumpInspectorHeading(headingId) {
  const scroller = document.querySelector('.card-inspector-scroll')
  if (!(scroller instanceof HTMLElement)) return
  const target = scroller.querySelector(`#${CSS.escape(headingId)}`)
  if (!(target instanceof HTMLElement)) return
  const nextTop = Math.max(0, target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12)
  rememberInspectorScroll(nextTop)
  scroller.scrollTo({ top: nextTop, behavior: 'smooth' })
}

async function saveInspectorToNotes(card) {
  if (state.inspectorNoteSave?.status === 'saving') return
  const reply = inspectorReply(card)
  if (reply.pending || reply.answerText === '') return
  const thread = state.workspace?.threads.find(item => item.id === card.dshThreadId)
  const detail = thread === undefined ? null : historyForCard(thread, card.id)
  const body = inspectorNoteBody({
    question: card.customTitle ?? detail?.question ?? card.question,
    answer: reply.answerText,
    workspaceTitle: currentDshWorkspace()?.title ?? state.workspace?.title ?? '',
    sessionTitle: thread === undefined ? '' : threadListTitle(thread),
    turnIndex: card.turnIndex,
    sessionId: thread?.dshSessionId ?? '',
  })
  state.inspectorNoteSave = { cardId: card.id, status: 'saving' }
  render()
  try {
    await dshRpc('synapse:add-to-notes', { body, tags: ['会话地图'] })
    state.inspectorNoteSave = { cardId: card.id, status: 'saved' }
    render()
  } catch {
    state.inspectorNoteSave = { cardId: card.id, status: 'error' }
    render()
  }
}

function beginCardRename(cardId) {
  const card = state.canvasCardsById?.get(cardId)
  if (card === undefined || card.blank || card.hidden || state.visibilityMutation) return
  state.renamingCardId = cardId
  render()
}

/**
 * Commit a card rename. The title is stored on the turn (`turn.title`) through
 * the server so it survives reprojection and reloads; an empty title clears
 * the override and the card falls back to the auto-derived question.
 */
async function commitCardRename(cardId, rawTitle) {
  const card = state.canvasCardsById?.get(cardId)
  state.renamingCardId = null
  if (card === undefined) { render(); return }
  const title = String(rawTitle ?? '').trim()
  if (title === (card.customTitle ?? '')) { render(); return }
  try {
    const body = await api(`/synapse/api/threads/${card.dshThreadId}/cards/${encodeURIComponent(card.cardKey)}`, { method: 'PATCH', body: JSON.stringify({ title }) })
    const threads = state.workspace?.threads ?? []
    const index = threads.findIndex(item => item.id === body.thread?.id)
    if (index !== -1) threads.splice(index, 1, body.thread)
    render()
  } catch (error) {
    setError(error)
  }
}

function canvasViewport(target) {
  return target instanceof Element ? target.closest('.canvas-viewport') : null
}

// Zoom bounds live here (rather than only in the injected client script) so
// every zoom path -- the +/- buttons, ctrl/meta wheel, fit-to-window -- uses
// the same range whether or not that injection applied. Upstream shipped a
// 0.6-4 clamp, which is too narrow for the map.
const MIN_ZOOM = 0.2
const MAX_ZOOM = 2
function zoomCanvas(viewport, nextZoom, clientX, clientY) {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
  if (zoom === state.zoom) return
  const bounds = viewport.getBoundingClientRect()
  const localX = clientX - bounds.left
  const localY = clientY - bounds.top
  const worldX = (localX - state.canvasCamera.x) / state.zoom
  const worldY = (localY - state.canvasCamera.y) / state.zoom
  state.zoom = zoom
  state.canvasCamera = { x: localX - worldX * zoom, y: localY - worldY * zoom }
  const content = viewport.querySelector('.canvas-content')
  if (content instanceof HTMLElement) {
    // Drop the composited layer before zooming: a cached will-change raster
    // would be upscaled instead of re-rasterized, which was the original
    // zoom-blur bug. will-change re-applies via .is-panning on the next pan.
    content.style.willChange = 'auto'
    applyCanvasTransform()
    syncCanvasViewport()
    window.requestAnimationFrame(() => { content.style.willChange = '' })
  } else {
    applyCanvasTransform()
    syncCanvasViewport()
  }
  const label = document.querySelector('.canvas-controls span')
  if (label !== null) label.textContent = `${Math.round(state.zoom * 100)}%`
}

function zoomCanvasAtCenter(delta) {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return
  const bounds = viewport.getBoundingClientRect()
  zoomCanvas(viewport, state.zoom + delta, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
}

function focusActiveCard() {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return
  const cards = state.canvasCards
  if (cards === undefined || cards.length === 0) return
  // Drafts win over the active conversation's latest turn; fall back to the
  // first card. Cards may be unmounted (outside the viewport), so the focus
  // target comes from the data model, never from DOM queries.
  const draft = state.draft === null ? undefined
    : state.draft.kind === 'new' ? { position: { x: 86, y: 82 } } : draftPlacement(cards)
  const activeCards = state.activeId === null || state.activeId === undefined ? [] : cards.filter(card => card.dshThreadId === state.activeId)
  const card = draft ?? activeCards.at(-1) ?? cards[0]
  const { x: left, y: top } = card.position
  const bounds = viewport.getBoundingClientRect()
  state.canvasCamera = {
    x: bounds.width / 2 - (left + CARD_WIDTH / 2) * state.zoom,
    y: bounds.height / 2 - (top + CARD_HEIGHT / 2) * state.zoom,
  }
  applyCanvasTransform()
  syncCanvasViewport()
}

/**
 * Center the canvas on a thread's latest card when it is off-screen.
 *
 * A just-submitted branch gets its own lane from the layout, which can sit
 * far below the card the user was looking at (one lane per earlier sibling
 * subtree). Without moving the camera the branch renders off-screen and
 * looks lost — "点发送后画板上没有显示". Cards already on screen are left
 * alone, so a follow-up that lands beside its parent never yanks the view.
 */
function revealThreadLatestCard(threadId) {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return
  const card = (state.canvasCards ?? []).filter(item => item.dshThreadId === threadId).at(-1)
  if (card === undefined) return
  const bounds = viewport.getBoundingClientRect()
  const margin = 32
  const left = card.position.x * state.zoom + state.canvasCamera.x
  const top = card.position.y * state.zoom + state.canvasCamera.y
  const right = (card.position.x + CARD_WIDTH) * state.zoom + state.canvasCamera.x
  const bottom = (card.position.y + CARD_HEIGHT) * state.zoom + state.canvasCamera.y
  if (left >= margin && top >= margin && right <= bounds.width - margin && bottom <= bounds.height - margin) return
  state.canvasCamera = {
    x: bounds.width / 2 - (card.position.x + CARD_WIDTH / 2) * state.zoom,
    y: bounds.height / 2 - (card.position.y + CARD_HEIGHT / 2) * state.zoom,
  }
  applyCanvasTransform()
  syncCanvasViewport()
}

let selectionFollowup = null
let selectionFollowupFrame = 0

function hideSelectionFollowup() {
  if (selectionFollowupFrame !== 0) {
    window.cancelAnimationFrame(selectionFollowupFrame)
    selectionFollowupFrame = 0
  }
  selectionFollowup = null
  const button = app.querySelector('.selection-followup')
  if (button instanceof HTMLButtonElement) button.hidden = true
}

function selectionFollowupTarget(range) {
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
  if (!(start instanceof Element) || !(end instanceof Element)) return null
  const answer = start.closest('.thread-answer')
  if (answer instanceof HTMLElement && answer.contains(end)) {
    const card = answer.closest('.thread-card[data-thread]:not(.draft-card)')
    if (card instanceof HTMLElement && card.dataset.thread !== undefined) return { threadId: card.dataset.thread }
  }
  const messageBody = start.closest('.message-assistant .message-body')
  const thread = currentThread()
  if (messageBody instanceof HTMLElement && messageBody.contains(end) && thread !== null) return { threadId: thread.id }
  return null
}

function updateSelectionFollowup() {
  selectionFollowupFrame = 0
  const button = app.querySelector('.selection-followup')
  const selection = window.getSelection()
  if (!(button instanceof HTMLButtonElement) || state.draft !== null || selection === null || selection.rangeCount !== 1 || selection.isCollapsed) return hideSelectionFollowup()
  const text = selection.toString().trim()
  const range = selection.getRangeAt(0)
  const target = text === '' || text.length > 4000 ? null : selectionFollowupTarget(range)
  const rect = range.getBoundingClientRect()
  if (target === null || rect.width === 0 || rect.height === 0) return hideSelectionFollowup()
  selectionFollowup = { ...target, text }
  button.dataset.thread = target.threadId
  button.style.left = `${Math.min(window.innerWidth - 12, Math.max(76, rect.right))}px`
  button.style.top = `${Math.min(window.innerHeight - 38, Math.max(8, rect.bottom + 8))}px`
  button.hidden = false
}

function queueSelectionFollowup() {
  if (selectionFollowupFrame !== 0) return
  selectionFollowupFrame = window.requestAnimationFrame(updateSelectionFollowup)
}

app.addEventListener('pointerdown', event => {
  const viewport = canvasViewport(event.target)
  if (!(viewport instanceof HTMLElement) || event.target instanceof Element && event.target.closest('.thread-card, button, textarea, select, .card-inspector')) return
  event.preventDefault()
  const origin = { x: event.clientX, y: event.clientY, camera: { ...state.canvasCamera } }
  let pendingCamera = null
  let frame = 0
  state.canvasGesture = true
  viewport.classList.add('is-panning')
  viewport.setPointerCapture(event.pointerId)
  const apply = () => {
    frame = 0
    if (pendingCamera === null) return
    state.canvasCamera = pendingCamera
    pendingCamera = null
    applyCanvasTransform()
    syncCanvasViewport()
  }
  const move = moveEvent => {
    pendingCamera = {
      x: origin.camera.x + moveEvent.clientX - origin.x,
      y: origin.camera.y + moveEvent.clientY - origin.y,
    }
    if (frame === 0) frame = window.requestAnimationFrame(apply)
  }
  const stop = () => {
    viewport.classList.remove('is-panning')
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', stop)
    document.removeEventListener('pointercancel', stop)
    if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0 }
    apply()
    state.canvasGesture = false
    deferCanvasRefresh(120)
    scheduleLiveCardUpdate()
  }
  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', stop)
  document.addEventListener('pointercancel', stop)
})

// The wheel pans the canvas, it does not zoom: scrolling moves the view the
// way any scrollable surface behaves. Zooming is Ctrl/⌘ + wheel (trackpad
// pinch) and the +/- buttons in the topbar.
app.addEventListener('wheel', event => {
  if (event.target instanceof Element && event.target.closest('.card-inspector')) {
    deferCanvasRefresh()
    return
  }
  const viewport = canvasViewport(event.target)
  if (!(viewport instanceof HTMLElement)) return
  // A trackpad pinch arrives as a wheel event with ctrlKey set, and it must be
  // handled before the pan branch: its deltas are only a few pixels, so
  // treating it as a pan would nudge the canvas by that much and look like
  // nothing happened.
  if (event.ctrlKey === true || event.metaKey === true) {
    event.preventDefault()
    zoomCanvas(viewport, state.zoom * Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY)
    return
  }
  const card = event.target instanceof Element ? event.target.closest('.thread-card') : null
  if (card instanceof HTMLElement) {
    // Over a card the wheel scrolls that card's own answer with the browser's
    // native wheel (OS-smooth, never a page jump per notch); the answer's
    // overscroll-behavior: contain stops the scroll chaining into the canvas.
    const answer = card.querySelector('.thread-answer')
    if (answer instanceof HTMLElement && answer.scrollHeight > answer.clientHeight) {
      deferCanvasRefresh()
      return
    }
    // A card with no scrollable answer falls through to panning the canvas
    // rather than swallowing the wheel, so scrolling over a short card still
    // moves the view.
  }
  event.preventDefault()
  // Shift + wheel is the conventional horizontal scroll on a mouse that only
  // has one wheel, so it maps to the X axis.
  const dx = event.shiftKey === true && event.deltaX === 0 ? event.deltaY : event.deltaX
  const dy = event.shiftKey === true && event.deltaX === 0 ? 0 : event.deltaY
  state.canvasCamera = { x: state.canvasCamera.x - dx, y: state.canvasCamera.y - dy }
  applyCanvasTransform()
  syncCanvasViewport()
  deferCanvasRefresh()
}, { passive: false })

// Track pointer-down so the card click handler can tell a plain click from a
// text-selection or drag gesture; acting on the latter would re-render and
// wipe the user's selection.
let pointerDownPosition = null
app.addEventListener('pointerdown', event => {
  pointerDownPosition = { x: event.clientX, y: event.clientY }
  if (event.target instanceof Element && event.target.closest('[data-rename-title]')) deferCanvasRefresh()
})
app.addEventListener('pointerdown', event => {
  const button = event.target instanceof Element ? event.target.closest('.selection-followup') : null
  if (button instanceof HTMLButtonElement) event.preventDefault()
  else hideSelectionFollowup()
})
app.addEventListener('pointerup', queueSelectionFollowup)
app.addEventListener('scroll', event => {
  hideSelectionFollowup()
  if (event.target instanceof HTMLElement && event.target.classList.contains('card-inspector-scroll')) {
    rememberInspectorScroll(event.target.scrollTop)
    deferCanvasRefresh(400)
  }
}, true)
document.addEventListener('selectionchange', queueSelectionFollowup)
function handleCardTitleRename(event) {
  const title = event.target instanceof Element ? event.target.closest('[data-rename-title]') : null
  if (!(title instanceof HTMLElement)) return
  const card = state.canvasCardsById?.get(title.dataset.renameTitle)
  const moved = event.type === 'dblclick' && pointerDownPosition !== null
    && Math.hypot(event.clientX - pointerDownPosition.x, event.clientY - pointerDownPosition.y) > 4
  if (cardTitleIntent(card, event, Boolean(state.visibilityMutation || state.dragging || state.canvasGesture || moved)) !== 'rename-card') return
  event.preventDefault()
  event.stopPropagation()
  hideSelectionFollowup()
  beginCardRename(card.id)
}
app.addEventListener('dblclick', handleCardTitleRename)
app.addEventListener('keydown', handleCardTitleRename)
document.addEventListener('keydown', event => {
  // Escape inside a rename input cancels the edit only — it must not fall
  // through to the inspector's close-on-Escape below.
  if (event.key === 'Escape' && event.target instanceof HTMLElement && event.target.matches('[data-rename-input]')) {
    event.preventDefault()
    event.stopPropagation()
    state.renamingCardId = null
    render()
    return
  }
  if (event.key !== 'Escape' || state.mode !== 'canvas' || state.inspectorCardId === null) return
  event.preventDefault()
  if (state.inspectorTocOpen) {
    setInspectorTocOpen(false)
    render()
    return
  }
  closeCardInspector({ animate: false })
})

// Clicking away from the rename input commits the title, matching how the
// draft composer keeps its text. A cancel (Escape) clears renamingCardId
// first, so this only fires for a genuine commit.
app.addEventListener('focusout', event => {
  const input = event.target
  if (!(input instanceof HTMLInputElement) || input.dataset.renameInput === undefined) return
  if (state.renamingCardId !== input.dataset.renameInput) return
  void commitCardRename(input.dataset.renameInput, input.value)
})

app.addEventListener('click', async event => {
  // Keep the title mounted between clicks so a double-click can start editing.
  if (event.target instanceof Element && event.target.closest('[data-rename-title]')) {
    deferCanvasRefresh()
    return
  }
  if (state.inspectorTocOpen && !inspectorTocIsDocked() && event.target instanceof Element && event.target.closest('.card-inspector-toc, [data-action="toggle-inspector-toc"]') === null) {
    setInspectorTocOpen(false)
  }
  const button = event.target.closest('[data-action]')
  if (!(button instanceof HTMLElement)) {
    const card = event.target instanceof Element ? event.target.closest('.thread-card[data-thread]:not(.draft-card)') : null
    if (!(card instanceof HTMLElement) || event.target instanceof Element && event.target.closest('.node-handle, textarea, select, form, a')) return
    // A double-click selects a word and a drag selects a range; neither is a
    // select-click, so leave the selection intact instead of re-rendering.
    if (event.detail > 1) return
    if (pointerDownPosition !== null
      && Math.hypot(event.clientX - pointerDownPosition.x, event.clientY - pointerDownPosition.y) > 4) return
    const thread = state.workspace?.threads.find(item => item.id === card.dataset.thread)
    if (thread === undefined) return
    const cardId = card.dataset.cardId
    if (cardId === undefined) return
    const selection = canvasCardSelection(thread, cardId)
    if (selection === null) return
    state.activeId = selection.activeId
    state.selectedCardId = selection.selectedCardId
    openCardInspector(selection.inspectorCardId)
    state.error = ''
    render()
    return
  }
  const thread = state.workspace?.threads.find(item => item.id === button.dataset.thread)
  if (button instanceof HTMLButtonElement && button.disabled) return
  if (button.dataset.action === 'watch-turn' || button.dataset.action === 'open-dsh') {
    event.preventDefault()
    event.stopPropagation()
    dispatchCardSessionAction(button.dataset.action, thread, button.dataset.card, button.dataset.seq)
    return
  }
  try {
    if (button.dataset.action === 'hide-card' || button.dataset.action === 'restore-card') {
      const workspaceId = state.workspace?.id
      const ids = [button.dataset.card]
      if (ids.length === 0) return
      await changeCardVisibility(ids, button.dataset.action === 'hide-card')
      if (state.workspace?.id === workspaceId && !document.activeElement?.matches('textarea, input, select')) {
        const focus = app.querySelector(`[data-card-id="${CSS.escape(ids[0])}"] ${button.dataset.action === 'hide-card' ? '.hidden-card-restore' : '[data-rename-title]'}`)
        focus?.focus({ preventScroll: true })
      }
      return
    }
    if (button.dataset.action === 'retry-submission') {
      const operation = state.submissions.get(button.dataset.operation)
      if (operation?.phase === 'failed' && !operation.inFlight) {
        state.error = ''
        operation.phase = operation.sessionId === null ? 'creating' : 'queued'
        requestCanvasRefresh()
        void runSubmission(operation)
      }
      return
    }
    if (button.dataset.action === 'discard-submission') {
      const operation = state.submissions.get(button.dataset.operation)
      if (operation?.phase !== 'failed' || operation.inFlight) return
      state.pendingReplies.delete(operation.sessionId ?? operation.thread.id)
      state.submissions.delete(operation.id)
      if (operation.thread.optimistic && state.workspace?.id === operation.workspaceId) {
        state.workspace.threads = state.workspace.threads.filter(thread => thread.id !== operation.thread.id)
      }
      if (state.activeId === operation.thread.id) state.activeId = operation.parentId ?? null
      if (state.selectedCardId === operation.cardId) state.selectedCardId = null
      if (state.inspectorCardId === operation.cardId) state.inspectorCardId = null
      state.error = ''
      render()
      return
    }
    if (button.dataset.action === 'follow-selection') {
      const followup = selectionFollowup
      hideSelectionFollowup()
      if (followup !== null && thread !== undefined && thread.id === followup.threadId && state.draft === null) openContinue(thread, undefined, followup.text)
      return
    }
    if (button.dataset.action === 'insert-quick-phrase' && button.dataset.quickPhrase !== undefined) insertQuickPhrase(button.dataset.quickPhrase)
    if (button.dataset.action === 'open-quick-phrase-editor') { state.quickPhraseEditorOpen = true; render() }
    if (button.dataset.action === 'close-quick-phrase-editor') { state.quickPhraseEditorOpen = false; render() }
    if (button.dataset.action === 'add-quick-phrase') {
      const editor = button.closest('.draft-quick-phrase-add')
      const input = editor?.querySelector('input')
      if (input instanceof HTMLInputElement && addQuickPhrase(input.value)) {
        render()
        window.setTimeout(() => document.querySelector('.draft-quick-phrase-add input')?.focus(), 0)
      }
    }
    if (button.dataset.action === 'remove-quick-phrase') {
      const index = Number(button.dataset.quickPhraseIndex)
      if (Number.isInteger(index) && index >= 0 && index < state.quickPhrases.length) {
        state.quickPhrases.splice(index, 1)
        persistQuickPhrases()
        render()
      }
    }
    if (button.dataset.action === 'close') post('synapse:close')
    if (button.dataset.action === 'close-card-inspector') { closeCardInspector(); return }
    if (button.dataset.action === 'toggle-inspector-toc') {
      setInspectorTocOpen(!state.inspectorTocOpen)
      render()
      return
    }
    if (button.dataset.action === 'toggle-inspector-expand') {
      toggleInspectorExpanded()
      return
    }
    if (button.dataset.action === 'jump-heading' && button.dataset.heading !== undefined) {
      jumpInspectorHeading(button.dataset.heading)
      if (!inspectorTocIsDocked()) setInspectorTocOpen(false)
      return
    }
    if (button.dataset.action === 'add-to-notes') {
      const cardId = button.dataset.card ?? state.inspectorCardId
      const card = cardId === null || cardId === undefined ? undefined : state.canvasCardsById?.get(cardId)
      if (card !== undefined) void saveInspectorToNotes(card)
      return
    }
    if (button.dataset.action === 'rename-card') {
      const cardId = button.dataset.card ?? state.inspectorCardId
      beginCardRename(cardId)
      return
    }
    if (button.dataset.action === 'toggle-sidebar') { state.sidebarCollapsed = !state.sidebarCollapsed; render() }
    if (button.dataset.action === 'create-session') openNewSession()
    if (button.dataset.action === 'open-current' && state.currentDsh !== null) post('synapse:open-session', { sessionId: state.currentDsh.id })
    if (button.dataset.action === 'select-thread' && thread !== undefined) {
      state.mapCardSessionSwitches.clear()
      state.activeId = thread.id
      state.selectedCardId = null
      state.inspectorCardId = null
      state.inspectorOpening = false
          state.error = ''
      if (state.workspace !== null) revealConversationThread(conversationCards(visibleThreads()), thread.id)
      render()
      void loadThreadHistory(thread)
      // Bidirectional current-session sync: switch DSH's current session
      // without closing the map; the client confirms via synapse:current-session.
      if (thread.dshSessionId !== null) post('synapse:activate-session', { sessionId: thread.dshSessionId })
    }
    if (button.dataset.action === 'show-thread' && thread !== undefined) { state.activeId = thread.id; state.mode = 'thread'; state.detailTargetCardId = button.dataset.card ?? null; render(); void loadThreadHistory(thread) }
    if (button.dataset.action === 'show-canvas') { state.mode = 'canvas'; render() }
    if (button.dataset.action === 'toggle-card-children' && button.dataset.card !== undefined) {
      const cardId = button.dataset.card
      const collapsing = !state.collapsedCardIds.has(cardId)
      if (collapsing && state.workspace !== null) {
        const allCards = conversationCards(visibleThreads())
        const nextCollapsed = new Set(state.collapsedCardIds).add(cardId)
        const visibleCards = conversationGraphView(allCards, nextCollapsed).cards
        const visibleIds = new Set(visibleCards.map(card => card.id))
        const draftParentId = draftPlacement(allCards)?.parent.id
        if (draftParentId !== undefined && !visibleIds.has(draftParentId)) return setError('请先完成或取消正在编辑的追问或分支')
        if (state.activeId !== null && !visibleCards.some(card => card.dshThreadId === state.activeId)) return setError('当前会话位于这个后续分支中，请先切换会话')
      }
      collapsing ? state.collapsedCardIds.add(cardId) : state.collapsedCardIds.delete(cardId)
      persistCollapsedCards()
      render()
      window.setTimeout(() => document.querySelector(`[data-action="toggle-card-children"][data-card="${selectorValue(cardId)}"]`)?.focus(), 0)
    }
    if (button.dataset.action === 'open-continue' && thread !== undefined) openContinue(thread, button.dataset.card)
    if (button.dataset.action === 'open-branch' && thread !== undefined) {
      const sourceCard = state.canvasCardsById?.get(button.dataset.card)
      if (sourceCard !== undefined && cardState(sourceCard, sessionStatusFor(thread)) !== 'done') return setError('请等待这张卡片完成后再创建分支')
      openBranch(thread, button.dataset.card)
    }
    if (button.dataset.action === 'cancel-draft') { state.draft = null; state.quickPhraseEditorOpen = false; render() }
    if (button.dataset.action === 'toggle-message' && button.dataset.message !== undefined) { state.expandedMessageIds.has(button.dataset.message) ? state.expandedMessageIds.delete(button.dataset.message) : state.expandedMessageIds.add(button.dataset.message); renderPreservingDetailScroll() }
    if (button.dataset.action === 'zoom-in') zoomCanvasAtCenter(.1)
    if (button.dataset.action === 'zoom-out') zoomCanvasAtCenter(-.1)
    if (button.dataset.action === 'focus-active') focusActiveCard()
    if (button.dataset.action === 'dismiss-error') { state.error = ''; render() }
    if (button.dataset.action === 'layout' && state.workspace !== null) {
      resetCardPositions()
      resetCanvasCamera()
      render()
    }
  } catch (error) { setError(error) }
})

app.addEventListener('change', event => {
  const quickPhrase = event.target instanceof Element ? event.target.closest('[data-quick-phrase-index]') : null
  if (quickPhrase instanceof HTMLInputElement) {
    updateQuickPhrase(Number(quickPhrase.dataset.quickPhraseIndex), quickPhrase.value)
    return
  }
  const select = event.target.closest('[data-action="select-workspace"]')
  if (!(select instanceof HTMLSelectElement)) return
  const choice = workspaceChoices().find(item => item.id === select.value)
  state.inspectorCardId = null
  state.inspectorOpening = false
  if (choice?.source === 'dsh') {
    // Map → native sync: switching workspaces moves DSH's current session to
    // the workspace's most recently updated session, keeping both sides in step.
    void openDshWorkspace(choice.id).then(opened => {
      if (!opened) return
      const threads = state.workspace?.threads ?? []
      const latest = latestRootThread(threads)
      const sessionId = latest?.dshSessionId ?? choice.rootSessionIds?.[0] ?? choice.sessionIds[0]
      if (sessionId !== undefined) post('synapse:activate-session', { sessionId })
    }).catch(setError)
  } else if (choice !== undefined) { state.selectedDshWorkspaceId = null; void openWorkspace(choice.id).catch(setError) }
})
app.addEventListener('input', event => { const input = event.target; if (input instanceof HTMLTextAreaElement && input.closest('[data-draft]') && state.draft !== null) state.draft.text = input.value })
app.addEventListener('submit', event => {
  const form = event.target
  if (!(form instanceof HTMLFormElement)) return
  // Enter inside a card-rename input submits this form; commit like a blur.
  if (form.matches('[data-rename]')) {
    event.preventDefault()
    const input = form.querySelector('input')
    void commitCardRename(form.dataset.rename, input instanceof HTMLInputElement ? input.value : '')
    return
  }
  if (form.matches('[data-draft]')) { event.preventDefault(); void submitDraft(); return }
  const thread = state.workspace?.threads.find(item => item.id === form.dataset.compose)
  const input = form.querySelector('textarea')
  if (thread === undefined || !(input instanceof HTMLTextAreaElement) || input.value.trim() === '') return
  event.preventDefault()
  const text = input.value.trim()
  input.value = ''
  void sendMessage(thread, text).catch(setError)
})

window.addEventListener('message', event => {
  if (event.origin !== window.location.origin || event.data?.source !== 'dsh-synapse') return
  const data = event.data
  if (data.type === 'synapse:close-inspector') {
    // The host turn pane and the in-canvas inspector share the right rail, so
    // opening one asks the other to close; they never sit side by side.
    if (state.inspectorCardId !== null) closeCardInspector({ animate: false })
    return
  }
  if (data.type === 'synapse:map-opened') {
    // Do NOT reset the camera here: toggling dialog<->map for the same
    // session must keep the user's viewport. A fresh canvas (canvasView
    // not initialized) still centers via renderCanvas; a real session switch
    // re-centers in the current-session handler below.
    state.mode = 'canvas'
    render()
    window.requestAnimationFrame(() => post('synapse:map-ready'))
  }
  if (data.type === 'synapse:theme') {
    document.documentElement.dataset.theme = data.dark === true ? 'dark' : 'light'
  }
  if (data.type === 'synapse:session-status') {
    // Rebuild the status map the cards read. Only redraw when a state actually
    // changed: this arrives on every host session-list change.
    const statuses = Array.isArray(data.statuses) ? data.statuses : []
    const next = new Map(statuses.filter(item => typeof item?.id === 'string').map(item => [item.id, item]))
    if (statusFingerprint(next) !== statusFingerprint(state.sessionStatusById)) {
      state.sessionStatusById = next
      if (state.mode === 'canvas') requestCanvasRefresh()
    } else {
      state.sessionStatusById = next
    }
    return
  }
  if (data.type === 'synapse:workspaces') {
    const next = Array.isArray(data.workspaces) ? data.workspaces.filter(workspace => typeof workspace?.id === 'string' && typeof workspace.title === 'string' && Array.isArray(workspace.sessionIds)) : []
    const fingerprint = workspacesFingerprint(next)
    const unchanged = fingerprint === state.dshWorkspacesFingerprint
    state.dshWorkspaces = next
    state.dshWorkspacesFingerprint = fingerprint
    // Session-list ticks reuse this message. Reloading the workspace on every
    // chunk remounted the inspector and every card — same class of bug as
    // current-session rebuilding the canvas during a live turn.
    if (unchanged && state.workspace !== null) return
    const current = currentDshWorkspace()
    if (current !== undefined && current.id !== state.selectedDshWorkspaceId) void openDshWorkspace(current.id).catch(setError)
    else if (state.selectedDshWorkspaceId !== null) void openDshWorkspace(state.selectedDshWorkspaceId).catch(setError)
    else if (canReplaceView()) render()
  }
  if (data.type === 'synapse:current-session') {
    const previous = state.currentDsh
    const previousId = previous?.id
    // The canvas is scoped to the current session, so a switch replaces its
    // whole content: the old camera would point at coordinates that no longer
    // hold anything. Re-center unless the switch was triggered from inside the
    // map itself (an explicit session action), where keeping the viewport is
    // the point. A plain card click only opens the local inspector.
    const sessionSwitched = previousId !== data.session?.id
    const preserveCanvasCamera = sessionSwitched && state.mapCardSessionSwitches.delete(data.session?.id)
    if (sessionSwitched && !preserveCanvasCamera) resetCanvasCamera()
    state.currentDsh = data.session
    const thread = currentDshThread()
    if (thread !== undefined) {
      // Only a real session switch moves the selection. This message also
      // arrives on every session-list refresh (a fork was created, a title
      // changed); resetting activeId there would yank the canvas scope away
      // from a branch the user just created, and close the card inspector
      // they are reading.
      if (sessionSwitched) {
        const preserveSelectedCard = state.activeId === thread.id
        state.activeId = thread.id
        if (!preserveSelectedCard) {
          state.selectedCardId = null
          state.inspectorCardId = null
          state.inspectorOpening = false
        }
      }
      if (state.workspace !== null) revealConversationThread(conversationCards(visibleThreads()), thread.id)
    }
    if (previousId !== data.session?.id) {
      // A real session switch: re-center on the new session's latest turn,
      // whether it lives in the same workspace (openCurrentWorkspace returns
      // false) or a different one (it resets the camera itself).
      void openCurrentWorkspace({ preserveCanvasCamera }).then(opened => {
        if (!opened && canReplaceView()) {
          render()
          if (!preserveCanvasCamera) focusActiveCard()
        }
      }).catch(setError)
    }
    else if ((previous?.title !== data.session?.title || previous?.cwd !== data.session?.cwd) && canReplaceView()) {
      render()
    }
  }
  if (data.type === 'synapse:live-reply' && typeof data.sessionId === 'string') {
    const thread = state.workspace?.threads.find(item => item.dshSessionId === data.sessionId)
    if (thread !== undefined) {
      const previous = state.liveReplies.get(data.sessionId)
      const pending = state.pendingReplies.get(data.sessionId)
      if (pending !== undefined && Number.isSafeInteger(data.seq) && data.seq <= pending.baseSeq) return
      if (data.running === true) {
        const sameTurn = data.seq === undefined || previous?.seq === data.seq
        state.liveReplies.set(data.sessionId, { ...nextLiveReply(sameTurn ? previous : undefined, true, data.text), seq: data.seq, question: data.question })
        if (pending !== undefined && pending.phase !== 'failed') {
          pending.phase = 'running'
          if (Number.isSafeInteger(data.seq) && data.seq > pending.baseSeq) pending.started = true
        }
        // Streaming: patch the live card's answer in place instead of
        // rebuilding the whole canvas on every chunk; a full render reconciles
        // at stream end. The detail view is single-thread, so keep its cheap
        // throttled full render.
        if (state.mode === 'canvas') scheduleLiveCardUpdate(data.sessionId)
        else if (canReplaceView()) scheduleLiveRender()
      } else {
        const tracked = previous !== undefined || state.pendingReplies.has(data.sessionId)
        if (!tracked) return
        const completed = nextLiveReply(previous, false, data.text)
        if (pending?.started && previous?.running === true) {
          pending.completed = true
          pending.finalText = completed?.text ?? ''
        }
        if (completed === null) state.liveReplies.delete(data.sessionId)
        else state.liveReplies.set(data.sessionId, completed)
        const question = state.pendingReplies.get(data.sessionId)?.text
        requestCanvasRefresh()
        void refreshCompletedReply(data.sessionId, question)
      }
    }
  }
  if (data.type === 'synapse:forked-session' || data.type === 'synapse:created-session' || data.type === 'synapse:message-sent' || data.type === 'synapse:archived-session' || data.type === 'synapse:note-saved') settleRpc(data.requestId, data.session ?? data)
  if (data.type === 'synapse:bridge-error') { settleRpc(data.requestId, undefined, new Error(data.message)); if (data.requestId === undefined) setError(data.message) }
})

post('synapse:request-current')
refreshSummaries().catch(setError)
let polling = false
let liveRenderTimer = 0
let liveCardFrame = 0
const liveCardSessionIds = new Set()
function scheduleLiveCardUpdate(sessionId) {
  if (typeof sessionId === 'string') liveCardSessionIds.add(sessionId)
  if (liveCardFrame !== 0 || liveCardSessionIds.size === 0) return
  liveCardFrame = window.requestAnimationFrame(() => {
    liveCardFrame = 0
    if (state.dragging || state.canvasGesture) return
    const ids = [...liveCardSessionIds]
    liveCardSessionIds.clear()
    for (const id of ids) applyLiveReplyToCard(id)
  })
}
function applyLiveReplyToCard(sessionId) {
  if (state.mode !== 'canvas') return
  // Never patch cards mid-gesture: the reflow would compete with the drag or
  // pan frame; the next live-reply chunk re-applies after the gesture ends.
  if (state.dragging || state.canvasGesture) return
  const thread = state.workspace?.threads.find(item => item.dshSessionId === sessionId)
  if (thread === undefined) return
  const live = state.liveReplies.get(sessionId)
  if (live?.running !== true) return
  const dataCard = state.canvasCards?.filter(card => card.dshThreadId === thread.id).at(-1)
  if (dataCard === undefined || ['done', 'failed', 'cancelled'].includes(dataCard.status)) return
  if (Number.isSafeInteger(live.seq) && dataCard.sourceSeq !== live.seq) return
  if (!Number.isSafeInteger(live.seq) && state.pendingReplies.get(sessionId)?.cardId !== dataCard.id) return
  if (typeof live.text === 'string' && live.text !== '') dataCard.answer = { text: live.text, pending: true }
  dataCard.status = 'running'
  const card = app.querySelector(`.thread-card[data-card-id="${CSS.escape(dataCard.id)}"]`)
  if (!(card instanceof HTMLElement)) return
  const status = sessionStatusFor(thread)
  const resolved = cardState(dataCard, status)
  card.classList.remove(...CARD_STATES.map(value => `card-${value}`))
  card.classList.add(`card-${resolved}`)
  card.dataset.state = resolved
  const badge = card.querySelector('[data-card-state]')
  if (badge instanceof HTMLElement) {
    badge.className = `card-state card-state-${resolved}`
    badge.dataset.cardState = resolved
    badge.textContent = cardStateLabel(dataCard, status)
  }
  const answer = card.querySelector('.thread-answer')
  if (!(answer instanceof HTMLElement)) return
  const pending = '<p class="thread-answer-pending">正在回复</p>'
  const decision = nextLiveCardAnswer({
    hasContent: answer.childElementCount > 0,
    hasPending: answer.querySelector('.thread-answer-pending') !== null,
    liveText: answer.dataset.liveText,
    nextText: live.text,
  })
  if (decision.action === 'keep') return
  if (decision.action === 'append-pending') {
    answer.insertAdjacentHTML('beforeend', pending)
    return
  }
  if (decision.action === 'pending') {
    answer.innerHTML = pending
    return
  }
  const scrollTop = answer.scrollTop
  answer.innerHTML = `${renderMarkdown(decision.text)}${pending}`
  answer.dataset.liveText = decision.text
  answer.scrollTop = scrollTop
}
function scheduleLiveRender() {
  if (liveRenderTimer !== 0 || !canReplaceView()) return
  liveRenderTimer = window.setTimeout(() => {
    liveRenderTimer = 0
    if (canReplaceView()) renderPreservingDetailScroll()
  }, 120)
}
async function pollProjection() {
  if (polling || document.hidden) return
  polling = true
  try {
    await refreshProjection()
    scheduleLiveCardUpdate()
    flushCanvasRefresh()
  } catch (error) {
    console.warn('[dsh-synapse] projection refresh failed', error)
  } finally { polling = false }
}
window.setInterval(() => { void pollProjection() }, 1_000)
