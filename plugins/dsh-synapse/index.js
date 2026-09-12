import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

export const name = 'synapse'
// Cold-session detail and fork backfill read through sessionPersistence.
// Cordis only exposes a service on the plugin context after it is injected;
// `ctx.get` without this entry returns undefined and turn-detail 404s.
export const inject = [
  'webServer', 'sessions', 'sessionPersistence', 'connection',
  'sessionQuery', 'agents', 'agentDefaultModel', 'agentPresets', 'workspaceRegistry',
]

const MAX_BODY_BYTES = 32 * 1024
const MAX_TITLE_LENGTH = 120
const MAX_NOTE_LENGTH = 4_000
// Projected message text cap: longer replies truncate with a marker pointing
// at the detail view instead of silently cutting mid-sentence.
const MAX_PROJECTION_LENGTH = 8_000
const PROJECTION_TRUNCATED_SUFFIX = '\n——…（详情查看全文）'
// v5 stores one card per turn instead of a copy of the session's message log.
// The canvas only renders the question and the turn's final answer, so those
// two fields are capped for display; full text is re-read from the DSH session
// when the user opens the detail view. The caps clear the p95 answer (~2.4k
// chars) so truncation stays rare and the detail view is the fallback.
const CARD_QUESTION_LENGTH = 600
const CARD_ANSWER_LENGTH = 2_400
const TRUNCATED_MARK = '…'
const TOPIC_COLORS = ['#0f766e', '#2563eb', '#be123c', '#7c3aed', '#b45309']
const LOCK_STALE_MS = 60_000
// Deferred (event-projection) writes coalesce into one save per window, so a
// burst of session events costs a single full-state write instead of one per
// event (issue #13: per-event saves pinned the main thread at ~90% CPU).
const SAVE_DEBOUNCE_MS = 800

/** JSON persistence for the Synapse workspace graph. */
export class WorkspaceStore {
  constructor(dataFile) {
    if (typeof dataFile !== 'string' || dataFile.length === 0) throw new Error('synapse: config.dataFile must be a non-empty path')
    this.dataFile = dataFile
    this.state = undefined
    this.serial = Promise.resolve()
    this.ready = this.load()
    this.lastKnownMtime = null
    this.externalModWarned = false
    this.lockWarned = false
    this.dirty = false
    this.flushTimer = null
  }

  async list() {
    await this.ready
    return this.state.workspaces.map(workspace => this.summary(workspace))
  }

  async get(workspaceId) {
    await this.ready
    const workspace = this.workspace(workspaceId)
    return structuredClone(workspace)
  }

  async create(title) {
    return this.mutate(() => {
      const now = new Date().toISOString()
      const workspace = { id: randomUUID(), title: requiredText(title, MAX_TITLE_LENGTH, 'title'), createdAt: now, updatedAt: now, threads: [] }
      this.state.workspaces.unshift(workspace)
      return this.summary(workspace)
    })
  }

  async createThread(workspaceId, input) {
    return this.mutate(() => {
      const workspace = this.workspace(workspaceId)
      const now = new Date().toISOString()
      const thread = this.thread({
        title: input?.title,
        parentId: input?.parentId,
        dshSessionId: input?.dshSessionId,
        dshSessionTitle: input?.dshSessionTitle,
        position: input?.position,
        color: input?.color,
        now,
        order: workspace.threads.length,
      })
      if (thread.parentId !== null && !workspace.threads.some(item => item.id === thread.parentId)) throw new InputError('分支来源不存在')
      workspace.threads.push(thread)
      workspace.updatedAt = now
      return structuredClone(thread)
    })
  }

  async branch(threadId, input) {
    return this.mutate(() => {
      const { workspace, thread: parent } = this.locateThread(threadId)
      const now = new Date().toISOString()
      const sessionId = typeof input?.dshSessionId === 'string' && input.dshSessionId.length > 0 ? input.dshSessionId : null
      // A DSH fork emits session/created while the browser receives its fork
      // response. Either path may win the race, but both must resolve to one node.
      if (sessionId !== null) {
        const existing = workspace.threads.find(item => item.dshSessionId === sessionId)
        if (existing !== undefined) {
          existing.parentId ??= parent.id
          if (typeof parent.dshSessionId === 'string' && parent.dshSessionId !== '') existing.sourceParentSessionId ??= parent.dshSessionId
          // The browser knows the exact turn the user branched from; DSH's own
          // seedLength is a coarser cut (and absent on old forks), so prefer
          // the anchor whenever the browser supplies one.
          if (typeof input?.anchorCardId === 'string' && input.anchorCardId !== '') existing.anchorCardId = input.anchorCardId
          if (Number.isSafeInteger(input?.sourceAnchorSeq)) existing.sourceAnchorSeq = input.sourceAnchorSeq
          if (typeof input?.title === 'string' && input.title.trim() !== '') existing.title = requiredText(input.title, MAX_TITLE_LENGTH, 'title')
          if (typeof input?.dshSessionTitle === 'string') existing.dshSessionTitle = input.dshSessionTitle.slice(0, MAX_TITLE_LENGTH)
          existing.updatedAt = now
          workspace.updatedAt = now
          return structuredClone(existing)
        }
      }
      const siblings = workspace.threads.filter(item => item.parentId === parent.id)
      const thread = this.thread({
        title: input?.title,
        parentId: parent.id,
        dshSessionId: input?.dshSessionId,
        dshSessionTitle: input?.dshSessionTitle,
        position: input?.position ?? { x: parent.position.x + 420, y: parent.position.y + siblings.length * 248 },
        color: input?.color ?? parent.color,
        now,
        order: workspace.threads.length,
      })
      // Persist the branch point on the server. localStorage anchors die with
      // the browser profile, and a lost anchor drops the branch to the canvas
      // origin where it overlaps the parent chain instead of sitting beside
      // the turn it left.
      if (typeof input?.anchorCardId === 'string' && input.anchorCardId !== '') thread.anchorCardId = input.anchorCardId
      if (Number.isSafeInteger(input?.sourceAnchorSeq)) thread.sourceAnchorSeq = input.sourceAnchorSeq
      if (typeof parent.dshSessionId === 'string' && parent.dshSessionId !== '') thread.sourceParentSessionId = parent.dshSessionId
      workspace.threads.push(thread)
      workspace.updatedAt = now
      return structuredClone(thread)
    })
  }

  /** Keep only the canvas graph in Synapse; DSH remains the source of session truth. */
  async syncSessions(sessions, removedSessionIds = []) {
    return this.mutate(() => {
      if (!Array.isArray(sessions)) throw new InputError('sessions 必须是数组')
      if (!Array.isArray(removedSessionIds) || removedSessionIds.some(item => typeof item !== 'string')) throw new InputError('removedSessionIds 必须是字符串数组')
      // A blank session is one DSH created but never filled with a message.
      // They are pruned so untouched new sessions do not clutter the map —
      // EXCEPT for forks: a branch the user just created is blank for the few
      // hundred milliseconds before its first message lands, and pruning it
      // made the branch vanish from the map right after it was created. Keep
      // those so the branch stays visible and streams in live.
      const blankIds = new Set(sessions.filter(item => item?.blank === true && typeof item.id === 'string' && typeof item.parentId !== 'string').map(item => item.id))
      const removedIds = new Set(removedSessionIds)
      for (const workspace of this.state.workspaces) {
        if (workspace.kind !== 'dsh') continue
        workspace.threads = workspace.threads.filter(thread => !blankIds.has(thread.dshSessionId) && !removedIds.has(thread.dshSessionId))
      }
      this.state.workspaces = this.state.workspaces.filter(workspace => workspace.kind !== 'dsh' || workspace.threads.length > 0)
      for (const item of sessions) {
        if (typeof item?.id !== 'string' || item.id === '' || typeof item.cwd !== 'string' || item.cwd === '') continue
        // Untouched blank sessions stay off the map; blank FORKS are kept (see
        // `blankIds` above) so a just-created branch is not pruned before its
        // first message arrives.
        if (item.blank === true && typeof item.parentId !== 'string') continue
        // Canvas archiving is persistent UI state. A normal DSH list refresh
        // must not recreate a session that the user deliberately archived.
        if (this.state.hiddenSessionIds.includes(item.id)) continue
        const workspace = this.dshWorkspace(item.cwd, 'DSH 任务')
        const session = { id: item.id, header: { meta: { cwd: item.cwd }, parentSession: typeof item.parentId === 'string' ? item.parentId : undefined }, title: typeof item.title === 'string' ? item.title : undefined, events: [] }
        const thread = this.dshThread(workspace, session)
        const title = usableSessionTitle(item.title)
        if (title !== null) {
          thread.title = title
          thread.dshSessionTitle = title
        }
      }
      return this.list()
    }, { deferred: true })
  }

  async addMessage(threadId, text) {
    return this.mutate(() => {
      const { workspace, thread } = this.locateThread(threadId)
      const at = new Date().toISOString()
      const note = requiredText(text, MAX_NOTE_LENGTH, 'text')
      const turns = thread.turns ??= []
      // Manual workspaces have no DSH session to re-read, so the note itself
      // is the card content; the canvas cap does not apply here.
      turns.push({ seq: null, at, question: note, answer: null, answerSeq: null, error: null, processCount: 0, processIds: [] })
      thread.updatedAt = at
      workspace.updatedAt = at
      return structuredClone(thread)
    })
  }

  async updateThread(threadId, input) {
    return this.mutate(() => {
      const { workspace, thread } = this.locateThread(threadId)
      if (input?.title !== undefined) thread.title = requiredText(input.title, MAX_TITLE_LENGTH, 'title')
      if (input?.position !== undefined) thread.position = positionOf(input.position)
      thread.updatedAt = new Date().toISOString()
      workspace.updatedAt = thread.updatedAt
      return structuredClone(thread)
    })
  }

  /**
   * Rename one conversation card, or restore its automatic title.
   *
   * The custom title lives beside the projected question on the turn: card
   * projection rewrites `question` from the DSH log but never touches
   * `title`, so a rename survives every later sync. An empty title deletes
   * the field and the card falls back to the auto-derived question.
   *
   * `cardKey` is the card's stable address: its DSH sequence number, or
   * `i<index>` for a turn without one (a manual note).
   */
  async updateCardTitle(threadId, cardKey, title) {
    if (typeof title !== 'string') throw new InputError('title 必须是文本')
    const text = title.trim()
    if (text.length > MAX_TITLE_LENGTH) throw new InputError('title 超过长度限制')
    return this.mutate(() => {
      const { workspace, thread } = this.locateThread(threadId)
      const turns = thread.turns ?? []
      const turn = /^\d+$/.test(cardKey)
        ? turns.find(item => item?.seq === Number(cardKey))
        : /^i\d+$/.test(cardKey) ? turns[Number(cardKey.slice(1))] : undefined
      if (turn === undefined || turn === null || typeof turn !== 'object') throw new NotFoundError('卡片不存在')
      if (text === '') delete turn.title
      else turn.title = text
      thread.updatedAt = new Date().toISOString()
      workspace.updatedAt = thread.updatedAt
      return structuredClone(thread)
    })
  }

  /** Visibility is canvas metadata, never a session archive or log mutation. */
  async updateCardVisibility(cards, hidden) {
    if (typeof hidden !== 'boolean') throw new InputError('hidden 必须是布尔值')
    if (!Array.isArray(cards) || cards.length === 0 || cards.length > 100) throw new InputError('每次请选择 1 到 100 张卡片')
    return this.mutate(() => {
      // Resolve and validate the whole batch before changing any turn.
      const targets = cards.map(card => {
        if (typeof card?.threadId !== 'string' || typeof card.cardKey !== 'string') throw new InputError('卡片地址无效')
        const located = this.locateThread(card.threadId)
        const turn = visibilityTurn(located.thread, card)
        if (turn === undefined) throw new NotFoundError('卡片不存在，请刷新后重试')
        if (hidden && (['creating', 'queued', 'running', 'needs-input'].includes(turn.status) || isPlaceholderTurn(turn))) {
          throw new InputError('请等待这轮对话结束后再隐藏')
        }
        return { ...located, turn, card }
      })
      const changedWorkspaces = new Set()
      const now = new Date().toISOString()
      for (const { workspace, thread, turn } of targets) {
        if ((turn.hidden === true) === hidden) continue
        if (hidden) turn.hidden = true
        else delete turn.hidden
        thread.updatedAt = now
        changedWorkspaces.add(workspace)
      }
      for (const workspace of changedWorkspaces) {
        workspace.updatedAt = now
        workspace.revision = (workspace.revision ?? 0) + 1
      }
      return { updates: targets.map(({ card, turn }) => ({
        ...card, seq: turn.seq, messageId: turn.messageId, cardId: turn.cardId ?? card.cardId, hidden,
      })) }
    }, { rollbackOnFailure: true })
  }

  async removeThread(threadId) {
    return this.mutate(() => {
      const { workspace, thread } = this.locateThread(threadId)
      const removal = new Set([thread.id])
      for (let changed = true; changed;) {
        changed = false
        for (const item of workspace.threads) {
          if (item.parentId !== null && removal.has(item.parentId) && !removal.has(item.id)) { removal.add(item.id); changed = true }
        }
      }
      for (const item of workspace.threads) {
        if (removal.has(item.id) && item.dshSessionId !== null && !this.state.hiddenSessionIds.includes(item.dshSessionId)) this.state.hiddenSessionIds.push(item.dshSessionId)
      }
      workspace.threads = workspace.threads.filter(item => !removal.has(item.id))
      workspace.updatedAt = new Date().toISOString()
      if (workspace.threads.length === 0) this.state.workspaces = this.state.workspaces.filter(item => item.id !== workspace.id)
      return { removed: removal.size }
    })
  }

  /**
   * The session ids that already hold at least one projected card.
   *
   * Used by the fork backfill to skip work already done, so a restart never
   * re-projects (or duplicates) conversations the canvas already has.
   */
  async projectedSessionIds() {
    await this.ready
    const ids = new Set()
    for (const workspace of this.state.workspaces) {
      for (const thread of workspace.threads) {
        if (typeof thread.dshSessionId === 'string' && thread.dshSessionId !== '' && (thread.turns ?? []).length > 0) ids.add(thread.dshSessionId)
      }
    }
    return ids
  }

  async clearLegacy(sessions) {
    return this.mutate(() => {
      const hidden = new Set(this.state.hiddenSessionIds)
      for (const workspace of this.state.workspaces) for (const thread of workspace.threads) if (thread.dshSessionId !== null) hidden.add(thread.dshSessionId)
      for (const session of sessions) hidden.add(session.id)
      this.state.hiddenSessionIds = [...hidden]
      this.state.workspaces = []
      return { cleared: true }
    })
  }

  /**
   * Forget the projected cards of the given sessions without hiding them.
   *
   * The fork backfill uses this to drop subagent children it finds on disk:
   * their cards are delegation mechanics, not conversation branches, so the
   * canvas is cleaner without them — but they must stay un-hidden, or a later
   * live run of the same subagent would be filtered as "archived".
   */
  async dropProjectedSessions(sessionIds) {
    return this.mutate(() => {
      const drop = new Set(sessionIds)
      for (const workspace of this.state.workspaces) {
        workspace.threads = workspace.threads.filter(thread => !drop.has(thread.dshSessionId))
      }
      this.state.workspaces = this.state.workspaces.filter(workspace => workspace.threads.length > 0)
      return { dropped: drop.size }
    })
  }

  /** Replay one live DSH session into the dedicated projection workspace. */
  async projectSession(session, replayFrom = 0, workspaceTitle = 'DSH 任务') {
    return this.mutate(() => {
      if (this.state.hiddenSessionIds.includes(session.id)) return null
      const workspace = this.dshWorkspace(sessionCwd(session), workspaceTitle)
      const thread = this.dshThread(workspace, session)
      // A live Session exposes its log through `snapshotEvents()`; a projected
      // shape (backfill, tests) carries a plain `events` array. Both are read
      // so one code path serves the live replay and the cold backfill.
      const events = typeof session.snapshotEvents === 'function'
        ? session.snapshotEvents()
        : session.events
      if (shouldRebaseProjection(thread, events, replayFrom) && this.rebaseProjection(workspace, thread, events, replayFrom)) {
        return structuredClone(thread)
      }
      for (const event of events ?? []) {
        if (event.seq >= replayFrom) this.projectEventInto(workspace, thread, event)
      }
      repairTurnQuestions(thread, events ?? [], replayFrom)
      return structuredClone(thread)
    }, { deferred: true })
  }

  rebaseProjection(workspace, thread, events, replayFrom) {
    const previous = thread.turns
    const nextWorkspace = { ...workspace }
    const rebuilt = { ...thread, turns: [], processIds: [], pendingProcess: [], lastEventSeq: undefined, activeTurnNumber: undefined }
    for (const event of events) {
      if (event.seq >= replayFrom) this.projectEventInto(nextWorkspace, rebuilt, event)
    }
    if (rebuilt.turns.length < previous.length || !previous.every((turn, index) => turn.question === rebuilt.turns[index].question)) return false
    const aliases = new Map()
    for (let index = 0; index < previous.length; index++) {
      const old = previous[index]
      const next = rebuilt.turns[index]
      if (old.title !== undefined) next.title = old.title
      if (old.hidden === true) next.hidden = true
      next.cardId = old.cardId ?? `${thread.id}:turn:${old.seq ?? `i${index}`}`
      for (const [from, to] of [[old.seq, next.seq], [old.answerSeq, next.answerSeq], [old.endSeq, next.endSeq]]) {
        if (Number.isSafeInteger(from) && Number.isSafeInteger(to)) aliases.set(from, to)
      }
    }
    Object.assign(thread, rebuilt)
    workspace.revision = nextWorkspace.revision
    workspace.updatedAt = nextWorkspace.updatedAt
    for (const child of workspace.threads) {
      if (child.parentId !== thread.id && child.sourceParentSessionId !== thread.dshSessionId) continue
      if (aliases.has(child.sourceAnchorSeq)) child.sourceAnchorSeq = aliases.get(child.sourceAnchorSeq)
    }
    return true
  }

  /** Project one committed DSH session event. Repeated sequence numbers are ignored. */
  async projectEvent(session, event, workspaceTitle = 'DSH 任务') {
    return this.mutate(() => {
      if (this.state.hiddenSessionIds.includes(session.id)) return null
      const workspace = this.dshWorkspace(sessionCwd(session), workspaceTitle)
      const thread = this.dshThread(workspace, session)
      this.projectEventInto(workspace, thread, event)
      return structuredClone(thread)
    }, { deferred: true })
  }

  /** Project a batch of committed events for one session in a single write. */
  async projectEvents(session, events, workspaceTitle = 'DSH 任务') {
    if (events.length === 0) return null
    return this.mutate(() => {
      if (this.state.hiddenSessionIds.includes(session.id)) return null
      const workspace = this.dshWorkspace(sessionCwd(session), workspaceTitle)
      const thread = this.dshThread(workspace, session)
      for (const event of events) this.projectEventInto(workspace, thread, event)
      repairTurnQuestions(thread, events)
      return structuredClone(thread)
    }, { deferred: true })
  }

  async load() {
    await mkdir(dirname(this.dataFile), { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(this.dataFile, 'utf8'))
      const { state, migrated } = normalizeState(parsed)
      this.state = state
      if (migrated) await this.save()
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error(`synapse: cannot read ${this.dataFile}: ${error.message}`)
      this.state = { version: 4, hiddenSessionIds: [], workspaces: [] }
      await this.save()
    }
  }

  async mutate(action, { deferred = false, rollbackOnFailure = false } = {}) {
    await this.ready
    const task = this.serial.then(async () => {
      const previous = rollbackOnFailure ? structuredClone(this.state) : undefined
      try {
        const result = action()
        if (deferred) this.markDirty()
        else await this.save()
        return result
      } catch (error) {
        if (previous !== undefined) this.state = previous
        throw error
      }
    })
    this.serial = task.catch(() => undefined)
    return task
  }

  /** Mark the state dirty and schedule one trailing flush for the window. */
  markDirty() {
    this.dirty = true
    if (this.flushTimer !== null) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, SAVE_DEBOUNCE_MS)
  }

  /** Persist the current state when dirty, ordered after in-flight mutations. */
  flush() {
    if (!this.dirty) return Promise.resolve()
    this.dirty = false
    const task = this.serial.then(() => this.save())
    this.serial = task.catch(() => undefined)
    return task
  }

  async save() {
    // Two dsh web instances sharing one profile clobber each other's canvas
    // state. Warn loudly instead of silently losing work; a live lock held by
    // another process or a file mtime that moved since our last write both
    // indicate a second writer.
    const before = await this.fileMtime()
    if (this.lastKnownMtime !== null && before !== null && before !== this.lastKnownMtime) {
      this.lastKnownMtime = before
      if (!this.externalModWarned) {
        this.externalModWarned = true
        process.stderr.write('synapse: workspaces.json 已被另一个 dsh web 实例修改，本实例的写入可能覆盖其更改——请只运行一个实例\n')
      }
    }
    await this.acquireLock()
    try {
      const temporaryFile = `${this.dataFile}.${process.pid}.tmp`
      await writeFile(temporaryFile, `${JSON.stringify(this.state)}\n`, 'utf8')
      await rename(temporaryFile, this.dataFile)
      this.lastKnownMtime = (await stat(this.dataFile)).mtimeMs
    } finally {
      await this.releaseLock()
    }
  }

  async fileMtime() {
    try { return (await stat(this.dataFile)).mtimeMs } catch { return null }
  }

  /** Take an exclusive cross-process lock, breaking a stale one; warn when a live process holds it. */
  async acquireLock() {
    const lockFile = `${this.dataFile}.lock`
    if (await this.tryAcquire(lockFile)) return
    if (await this.lockIsStale(lockFile)) {
      await unlink(lockFile).catch(() => {})
      if (await this.tryAcquire(lockFile)) return
    }
    if (!this.lockWarned) {
      this.lockWarned = true
      process.stderr.write('synapse: 另一个 dsh web 实例正在写入 workspaces.json——请只运行一个实例，否则画布数据可能互相覆盖\n')
    }
  }

  async tryAcquire(lockFile) {
    try {
      await writeFile(lockFile, `${process.pid}\n`, { flag: 'wx' })
      return true
    } catch {
      return false
    }
  }

  /** A lock is stale when its owner PID is gone or the lock file is older than the stale window. */
  async lockIsStale(lockFile) {
    try {
      const [content, stats] = await Promise.all([readFile(lockFile, 'utf8'), stat(lockFile)])
      const tooOld = Date.now() - stats.mtimeMs > LOCK_STALE_MS
      const pid = Number.parseInt(content, 10)
      if (!Number.isInteger(pid)) return tooOld
      if (pid === process.pid) return false
      try {
        process.kill(pid, 0)
        return tooOld
      } catch {
        return true
      }
    } catch {
      return false
    }
  }

  async releaseLock() {
    await unlink(`${this.dataFile}.lock`).catch(() => {})
  }

  workspace(workspaceId) {
    const workspace = this.state.workspaces.find(item => item.id === workspaceId)
    if (workspace === undefined) throw new NotFoundError('工作空间不存在')
    return workspace
  }

  locateThread(threadId) {
    for (const workspace of this.state.workspaces) {
      const thread = workspace.threads.find(item => item.id === threadId)
      if (thread !== undefined) return { workspace, thread }
    }
    throw new NotFoundError('节点不存在')
  }

  dshWorkspace(cwd, fallbackTitle) {
    let workspace = this.state.workspaces.find(item => item.kind === 'dsh' && item.cwd === cwd)
    if (workspace !== undefined) return workspace
    const now = new Date().toISOString()
    workspace = { id: randomUUID(), kind: 'dsh', cwd, title: workspaceTitle(cwd, fallbackTitle), createdAt: now, updatedAt: now, threads: [] }
    this.state.workspaces.unshift(workspace)
    return workspace
  }

  dshThread(workspace, session) {
    let thread = workspace.threads.find(item => item.dshSessionId === session.id)
    if (thread !== undefined) {
      const title = usableSessionTitle(session.title)
      if (title !== null) {
        thread.title = title
        thread.dshSessionTitle = title
      }
      // The fork cut is the session's `inheritedEventCount` (live sessions
      // report it exactly), else DSH's durable `header.seedLength`, which is
      // missing on most real forks; `session.seedBoundary` carries the boundary
      // resolved from the log itself (see `forkSeqBoundary`). Keeping it lets
      // the canvas attach this branch under the exact parent turn instead of
      // leaving it floating as a root. Keep the value even after the session
      // has been restored, when its in-process `firstLiveSeq` moves.
      const seedLength = session.inheritedEventCount ?? session.header?.seedLength ?? session.seedBoundary
      if (Number.isSafeInteger(seedLength) && seedLength >= 0) thread.sourceSeedLength = seedLength
      return thread
    }
    const parentSessionId = typeof session.header?.parentSession === 'string' ? session.header.parentSession : null
    const parent = parentSessionId === null ? undefined : workspace.threads.find(item => item.dshSessionId === parentSessionId)
    const siblings = workspace.threads.filter(item => item.sourceParentSessionId === parentSessionId)
    const now = new Date().toISOString()
    const rawSeed = session.inheritedEventCount ?? session.header?.seedLength ?? session.seedBoundary
    const sessionTitle = usableSessionTitle(session.title)
    const parentTitle = usableSessionTitle(parent?.title)
    thread = {
      id: randomUUID(),
      title: sessionTitle ?? parentTitle ?? '等待用户提问',
      parentId: parent?.id ?? null,
      sourceParentSessionId: parentSessionId,
      sourceSeedLength: Number.isSafeInteger(rawSeed) && rawSeed >= 0 ? rawSeed : null,
      dshSessionId: session.id,
      dshSessionTitle: sessionTitle,
      color: TOPIC_COLORS[workspace.threads.length % TOPIC_COLORS.length],
      // DSH projection stores only a neutral semantic anchor. The visual map
      // lays out visible cards from the current conversation graph each render,
      // so old/archived session counts must never leak into future coordinates.
      position: parent === undefined ? { x: 86, y: 82 } : { x: parent.position.x + 400, y: parent.position.y },
      createdAt: now,
      updatedAt: now,
      turns: [],
      pendingProcess: [],
      processIds: [],
    }
    workspace.threads.push(thread)
    // A child may arrive before its parent during startup replay. Repair that
    // relation when the missing parent later reaches the projection.
    for (const child of workspace.threads) {
      if (child.sourceParentSessionId === session.id && child.parentId === null) child.parentId = thread.id
    }
    workspace.updatedAt = now
    return thread
  }

  /**
   * Fold one projected event into the thread's turn cards.
   *
   * v5 keeps only what the canvas renders: one card per user turn holding the
   * question, the turn's latest answer, the tool count and the source seq used
   * for branching. Full message text stays in the DSH session log and is
   * re-read when the user opens the detail view.
   */
  projectEventInto(workspace, thread, event) {
    const projectedThrough = thread.lastEventSeq ?? Math.max(-1, ...thread.turns.flatMap(turn => [turn.seq, turn.answerSeq, turn.endSeq].filter(Number.isSafeInteger)))
    if (Number.isSafeInteger(event.seq) && event.seq <= projectedThrough) return
    if (Number.isSafeInteger(event.seq) && event.seq > (thread.lastEventSeq ?? -1)) {
      thread.lastEventSeq = event.seq
      workspace.revision = (workspace.revision ?? 0) + 1
    }
    if (event.type === 'turn/start') {
      thread.activeTurnNumber = event.data?.turn
      return
    }
    if (event.type === 'turn/end') {
      const number = event.data?.turn
      const turn = [...thread.turns].reverse().find(item => number === undefined || item.turnNumber === number)
        ?? (thread.activeTurnNumber === undefined ? thread.turns.at(-1) : undefined)
      if (turn !== undefined) {
        const reason = event.data?.reason
        const cancelled = ['cancelled', 'canceled', 'aborted', 'interrupted'].includes(reason?.kind)
        turn.status = reason?.kind === 'error' ? 'failed' : cancelled ? 'cancelled' : 'done'
        turn.endSeq = event.seq
        if (reason?.kind === 'error') turn.error = cardText(errorText(reason.error) ?? '本轮执行失败', CARD_ANSWER_LENGTH)
        if (cancelled) turn.error = '本轮已取消'
        turn.at = new Date(event.time).toISOString()
        thread.updatedAt = turn.at
        workspace.updatedAt = turn.at
      }
      return
    }
    if (event.type === 'session/title' && typeof event.data?.title === 'string') {
      const title = usableSessionTitle(event.data.title)
      if (title !== null) {
        thread.title = title
        thread.dshSessionTitle = title
      }
      thread.updatedAt = new Date(event.time).toISOString()
      workspace.updatedAt = thread.updatedAt
      return
    }
    if (event.type === 'tool/call' || event.type === 'tool/result') {
      this.foldToolProcess(thread, event)
      workspace.updatedAt = thread.updatedAt
      return
    }
    const projection = projectableEvent(event)
    if (projection === null || this.hasSourceSeq(thread, event.seq)) return
    const at = new Date(event.time).toISOString()
    const process = projection.kind === 'assistant' || projection.kind === 'error'
      ? this.takePendingProcess(thread, event.data?.turn, event.data?.step)
      : []
    if (projection.kind === 'user') {
      const question = cardText(projection.text, CARD_QUESTION_LENGTH)
      // A placeholder turn (a reply that arrived before any human message, or
      // a fork still waiting on its first prompt) is not a card of its own:
      // filling it keeps one turn per question instead of leaving 当前会话 and
      // the real question as two separate cards.
      const last = thread.turns.at(-1)
      if (last !== undefined && isPlaceholderTurn(last)) {
        last.seq = event.seq
        last.at = at
        last.question = question
        last.human = true
        last.status = 'running'
        last.turnNumber = thread.activeTurnNumber
        last.messageId = event.data?.id
      } else {
        thread.turns.push({
          seq: event.seq,
          messageId: event.data?.id,
          turnNumber: thread.activeTurnNumber,
          status: 'running',
          at,
          question,
          human: true,
          answer: null,
          answerSeq: null,
          error: null,
          processCount: 0,
          processIds: [],
        })
      }
      if (thread.dshSessionTitle === null || isSessionLabelQuestion(thread.dshSessionTitle)) {
        thread.title = titleFromText(projection.text)
        thread.dshSessionTitle = thread.title
      }
    } else {
      const turn = thread.turns.at(-1) ?? this.appendPlaceholderTurn(thread, at)
      turn.processCount += process.length
      turn.processIds.push(...process.map(entry => entry.callId))
      if (projection.kind === 'error') turn.error = cardText(projection.text, CARD_ANSWER_LENGTH)
      else if (projection.kind === 'assistant') {
        turn.answer = cardText(projection.text, CARD_ANSWER_LENGTH)
        turn.answerSeq = event.seq
        turn.error = null
      }
      turn.at = at
    }
    thread.updatedAt = at
    workspace.updatedAt = at
  }

  /** A reply without a preceding question (fork tail, mid-turn replay) still needs a card. */
  appendPlaceholderTurn(thread, at) {
    const turn = {
      seq: null,
      at,
      question: '等待用户提问',
      answer: null,
      answerSeq: null,
      error: null,
      processCount: 0,
      processIds: [],
    }
    thread.turns.push(turn)
    return turn
  }

  hasSourceSeq(thread, seq) {
    if (!Number.isSafeInteger(seq)) return false
    return thread.turns.some(turn => turn.seq === seq || turn.answerSeq === seq)
  }

  /**
   * Fold one tool call or result into the current turn's tool count, keyed by
   * `callId` so a retried or duplicate event is not counted twice. Tool
   * arguments and outputs are tracked by id only — they are never stored in
   * the canvas metadata (issue: one 50KB bash output alone was ~4% of a
   * 12MB workspaces.json) and are re-read from DSH for the detail view.
   */
  foldToolProcess(thread, event) {
    const at = new Date(event.time).toISOString()
    const data = event.data ?? {}
    const callId = String(event.type === 'tool/call' ? data.callId : data.message?.source?.callId ?? '')
    const turn = thread.turns.at(-1)
    const recorded = thread.processIds ??= []
    if (callId !== '' && recorded.includes(callId)) {
      thread.updatedAt = at
      return
    }
    if (callId !== '') recorded.push(callId)
    if (turn !== undefined) {
      turn.processCount += 1
      turn.processIds.push(callId)
      turn.at = at
    } else {
      // A tool event arriving before any assistant message: keep it in the
      // pending bucket so the count survives until its turn appears.
      const pending = thread.pendingProcess ??= []
      pending.push({ callId, turn: data.turn, step: data.step })
    }
    thread.updatedAt = at
  }

  takePendingProcess(thread, turn, step) {
    const pending = thread.pendingProcess
    if (!Array.isArray(pending) || pending.length === 0) return []
    const matching = pending.filter(entry => entry.turn === turn && entry.step === step)
    if (matching.length === 0) return []
    thread.pendingProcess = pending.filter(entry => entry.turn !== turn || entry.step !== step)
    return matching
  }

  thread({ title, parentId, dshSessionId, dshSessionTitle, position, color, now, order }) {
    return {
      id: randomUUID(),
      title: requiredText(title, MAX_TITLE_LENGTH, 'title'),
      parentId: typeof parentId === 'string' && parentId.length > 0 ? parentId : null,
      dshSessionId: typeof dshSessionId === 'string' && dshSessionId.length > 0 ? dshSessionId : null,
      dshSessionTitle: typeof dshSessionTitle === 'string' ? dshSessionTitle.slice(0, MAX_TITLE_LENGTH) : null,
      color: TOPIC_COLORS.includes(color) ? color : TOPIC_COLORS[order % TOPIC_COLORS.length],
      position: positionOf(position ?? { x: 86 + (order % 3) * 410, y: 82 + Math.floor(order / 3) * 260 }),
      createdAt: now,
      updatedAt: now,
      turns: [],
      pendingProcess: [],
      processIds: [],
    }
  }

  summary(workspace) {
    return { id: workspace.id, kind: workspace.kind ?? 'manual', cwd: workspace.cwd ?? null, title: workspace.title, createdAt: workspace.createdAt, updatedAt: workspace.updatedAt, revision: workspace.revision ?? 0, threadCount: workspace.threads.length }
  }
}

class InputError extends Error {}
class NotFoundError extends Error {}

function visibilityTurn(thread, target) {
  const turns = thread.turns ?? []
  if (typeof target.messageId === 'string' && target.messageId !== '') {
    return turns.find(turn => turn.messageId === target.messageId)
  }
  if (typeof target.cardId === 'string' && target.cardId !== '') {
    return turns.find(turn => turn.cardId === target.cardId)
      ?? turns.find((turn, index) => turn.cardId === undefined && `${thread.id}:turn:${turn.seq ?? `i${index}`}` === target.cardId)
  }
  return /^\d+$/.test(target.cardKey) ? turns.find(turn => turn.seq === Number(target.cardKey))
    : /^i\d+$/.test(target.cardKey) ? turns[Number(target.cardKey.slice(1))] : undefined
}

export function shouldRebaseProjection(thread, events, replayFrom = 0) {
  if (!Array.isArray(events) || events[0]?.seq !== 0 || !thread.turns?.length) return false
  const users = events.filter(event => event.seq >= replayFrom && isHumanUserEvent(event))
  if (users.length < thread.turns.length) return false
  // A full, unchanged question prefix is evidence of a sequence-space
  // migration. Never rebuild from a partial window or discard old turns.
  if (!thread.turns.every((turn, index) => turn.question === cardText(userMessageText(users[index]).trim(), CARD_QUESTION_LENGTH))) return false
  return thread.turns.some((turn, index) => turn.seq !== users[index].seq)
}

function normalizeState(value) {
  let migrated = false
  let state
  if ([2, 3, 4, 5].includes(value?.version) && Array.isArray(value.workspaces)) {
    const hiddenSessionIds = Array.isArray(value.hiddenSessionIds) ? value.hiddenSessionIds.filter(item => typeof item === 'string') : []
    migrated = value.version < 3 || !Array.isArray(value.hiddenSessionIds)
    const workspaces = value.workspaces.map(workspace => ({
      ...workspace,
      threads: Array.isArray(workspace.threads) ? workspace.threads.map(thread => {
        if (Array.isArray(thread.messages) || Array.isArray(thread.turns)) return thread
        migrated = true
        const notes = Array.isArray(thread.notes) ? thread.notes : []
        const { notes: _notes, ...rest } = thread
        return { ...rest, messages: notes, pendingProcess: [] }
      }) : [],
    }))
    state = { ...value, version: value.version, hiddenSessionIds, workspaces }
  } else if (value?.version === 1 && Array.isArray(value.workspaces)) {
    const now = typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString()
    state = {
      version: 3,
      hiddenSessionIds: [],
      workspaces: value.workspaces.map((workspace, index) => {
        const events = Array.isArray(workspace.events) ? workspace.events : []
        const workspaceNow = typeof workspace.updatedAt === 'string' ? workspace.updatedAt : now
        return {
          id: typeof workspace.id === 'string' ? workspace.id : randomUUID(),
          title: typeof workspace.title === 'string' && workspace.title.trim() ? workspace.title : '未命名工作空间',
          createdAt: typeof workspace.createdAt === 'string' ? workspace.createdAt : workspaceNow,
          updatedAt: workspaceNow,
          threads: events.length === 0 ? [] : [{
            id: randomUUID(), title: workspace.title || '历史记录', parentId: null, dshSessionId: null, dshSessionTitle: null,
            color: TOPIC_COLORS[index % TOPIC_COLORS.length], position: { x: 86, y: 82 }, createdAt: workspaceNow, updatedAt: workspaceNow,
            messages: events.map(event => ({ id: typeof event.id === 'string' ? event.id : randomUUID(), text: String(event.text ?? ''), at: typeof event.at === 'string' ? event.at : workspaceNow })),
          }],
        }
      }),
    }
    migrated = true
  } else {
    throw new Error('expected Synapse data version 1, 2, 3, 4, or 5')
  }
  if (state.version < 4) {
    if (foldLegacyToolCards(state.workspaces)) migrated = true
    state.version = 4
    migrated = true
  }
  // v5: replace the per-thread copy of the session message log with one card
  // per turn. The canvas renders only those fields, and the detail view
  // re-reads full text from the DSH session, so the log copy was pure weight.
  if (state.version === 4) {
    if (collapseMessagesToTurns(state.workspaces)) migrated = true
    state.version = 5
    migrated = true
  }
  // Normalize in place, so a hand-edited or partially written v5 file loads
  // instead of crashing the canvas.
  if (state.version === 5 && normalizeTurns(state.workspaces)) migrated = true
  // Cards stored by an older build can carry a generated session label or a
  // harness-injected block as their title. Both are repaired on load so the
  // canvas shows only real user questions.
  if (state.version === 5 && rewriteSessionLabelQuestions(state.workspaces)) migrated = true
  if (state.version === 5 && dropInjectedTurns(state.workspaces)) migrated = true
  // Forks recorded before the server kept a branch point lose it whenever the
  // browser's localStorage anchor is gone. Derive a durable anchor from the
  // child's own first turn: it is the first card after the inherited prefix,
  // so the parent turn is the last one that ends at or before it.
  if (state.version === 5 && backfillBranchAnchors(state.workspaces)) migrated = true
  return { state, migrated }
}

/**
 * Give every branch a durable anchor card when it does not have one yet.
 *
 * A fork created before the server persisted `anchorCardId` (or one whose
 * browser anchor was lost) can still be placed: the child's first own turn
 * starts right after the inherited prefix, so the branch point is the last
 * parent turn that finishes at or before that turn begins.
 *
 * Never invents an anchor for a branch with no parent, no parent turns, or no
 * child turn to compare against — such a branch stays unanchored and the
 * canvas falls back to a plain lane instead of a guessed position.
 * @param workspaces - mutable normalized workspaces.
 * @returns whether any thread gained an anchor.
 */
function backfillBranchAnchors(workspaces) {
  let changed = false
  for (const workspace of workspaces) {
    const threads = workspace.threads ?? []
    const byId = new Map(threads.map(thread => [thread.id, thread]))
    for (const thread of threads) {
      if (thread.parentId === null || typeof thread.parentId !== 'string') continue
      if (typeof thread.anchorCardId === 'string' && thread.anchorCardId !== '') continue
      const parent = byId.get(thread.parentId)
      if (parent === undefined) continue
      const parentTurns = Array.isArray(parent.turns) ? parent.turns : []
      const childTurns = Array.isArray(thread.turns) ? thread.turns : []
      if (parentTurns.length === 0 || childTurns.length === 0) continue
      // The branch was cut at the end of a turn, so the anchor is the latest
      // parent turn the child inherited. Two signals, in order of trust, and
      // they resolve the same way the canvas does so a reload never moves a
      // branch that the live view already placed.
      const seed = Number.isSafeInteger(thread.sourceSeedLength) && thread.sourceSeedLength >= 0 ? thread.sourceSeedLength : undefined
      const parentEnds = parentTurns.map(endOfTurn).filter(seq => seq !== undefined)
      const childSeqs = childTurns.map(startOfTurn).filter(seq => seq !== undefined)
      if (seed !== undefined && parentEnds.length > 0) {
        // A durable boundary that lands inside the parent's history names the
        // branch point exactly.
        const bySeed = parentTurns.filter(turn => {
          const end = endOfTurn(turn)
          return end !== undefined && end <= seed
        })
        const hit = bySeed.reduce((latest, turn) => (latest === undefined || endOfTurn(turn) > endOfTurn(latest) ? turn : latest), undefined)
        if (hit !== undefined) {
          thread.anchorCardId = `${parent.id}:turn:${Number.isSafeInteger(hit.seq) ? hit.seq : 'i0'}`
          thread.sourceAnchorSeq = endOfTurn(hit)
          changed = true
          continue
        }
        // A seed of 0 means "inherited nothing". Trust it only when the child
        // continues the parent's numbering; a child numbered below the parent's
        // first turn re-counts from its own origin and its 0 is noise.
        const earliest = Math.min(...parentTurns.map(startOfTurn).filter(seq => seq !== undefined))
        const continuesParent = childSeqs.length === 0 || Math.min(...childSeqs) > earliest
        if (continuesParent || seed > Math.max(...parentEnds)) continue
      }
      // No usable boundary: the child's first own turn begins right after the
      // inherited prefix, so every parent turn starting at or before it is what
      // this branch copied. The last such turn is the branch point.
      if (childSeqs.length === 0) continue
      const childStart = Math.min(...childSeqs)
      const inherited = parentTurns.filter(turn => {
        const start = startOfTurn(turn)
        return start !== undefined && start <= childStart
      })
      const anchor = inherited.reduce((latest, turn) => (latest === undefined || endOfTurn(turn) > endOfTurn(latest) ? turn : latest), undefined)
      if (anchor === undefined) continue
      thread.anchorCardId = `${parent.id}:turn:${Number.isSafeInteger(anchor.seq) ? anchor.seq : 'i0'}`
      thread.sourceAnchorSeq = endOfTurn(anchor)
      changed = true
    }
  }
  return changed
}

/** Sequence a stored turn card starts at (its question). */
function startOfTurn(turn) {
  return turn !== null && typeof turn === 'object' && Number.isSafeInteger(turn.seq) ? turn.seq : undefined
}

/** Sequence a stored turn card ends at (its answer, else its question). */
function endOfTurn(turn) {
  if (turn === null || typeof turn !== 'object') return undefined
  return Number.isSafeInteger(turn.answerSeq) ? turn.answerSeq : startOfTurn(turn)
}

/**
 * Coerce a v5 thread's turn cards to their expected shape (missing arrays,
 * wrong-typed fields, or a leftover `messages` log from an interrupted
 * migration). Returns whether anything had to be repaired.
 */
function normalizeTurns(workspaces) {
  let changed = false
  for (const workspace of workspaces) {
    for (const thread of workspace.threads ?? []) {
      if (thread.messages !== undefined) {
        if (collapseMessagesToTurns([workspace])) changed = true
        continue
      }
      if (!Array.isArray(thread.turns)) {
        thread.turns = []
        changed = true
        continue
      }
      if (Array.isArray(thread.processIds)) continue
      thread.processIds = []
      changed = true
    }
  }
  return changed
}

/**
 * Rebuild each thread's turn cards from its persisted message log, then drop
 * the log. Mirrors the live projection's turn slicing: a user message opens a
 * turn, following assistant replies become its answer, and tool records count
 * towards that turn.
 */
function collapseMessagesToTurns(workspaces) {
  let changed = false
  for (const workspace of workspaces) {
    for (const thread of workspace.threads ?? []) {
      if (thread.turns !== undefined) continue
      changed = true
      const messages = Array.isArray(thread.messages) ? thread.messages.filter(message => !isRuntimeContextMessage(message)) : []
      const turns = []
      let processIds = []
      for (let index = 0; index < messages.length; index++) {
        const message = messages[index]
        if (message.kind === 'user') {
          const question = cardText(message.text, CARD_QUESTION_LENGTH)
          const last = turns.at(-1)
          if (last !== undefined && isPlaceholderTurn(last)) {
            last.seq = Number.isSafeInteger(message.sourceSeq) ? message.sourceSeq : last.seq
            last.at = typeof message.at === 'string' ? message.at : last.at
            last.question = question
          } else {
            turns.push({
              seq: Number.isSafeInteger(message.sourceSeq) ? message.sourceSeq : null,
              at: typeof message.at === 'string' ? message.at : thread.updatedAt,
              question,
              answer: null,
              answerSeq: null,
              error: null,
              processCount: 0,
              processIds: [],
            })
          }
          continue
        }
        const turn = turns.at(-1)
        const process = Array.isArray(message.process) ? message.process : []
        const ids = process.map(entry => String(entry?.callId ?? '')).filter(id => id !== '')
        if (turn === undefined) {
          // A reply with no preceding question: give it its own card so the
          // canvas keeps the content instead of dropping it.
          turns.push({
            seq: null,
            at: typeof message.at === 'string' ? message.at : thread.updatedAt,
            question: '等待用户提问',
            answer: message.kind === 'error' ? null : cardText(message.text, CARD_ANSWER_LENGTH),
            answerSeq: message.kind === 'error' || !Number.isSafeInteger(message.sourceSeq) ? null : message.sourceSeq,
            error: message.kind === 'error' ? cardText(message.text, CARD_ANSWER_LENGTH) : null,
            processCount: process.length,
            processIds: ids,
          })
        } else {
          turn.processCount += process.length
          turn.processIds.push(...ids)
          if (message.kind === 'error') turn.error = cardText(message.text, CARD_ANSWER_LENGTH)
          else if (message.kind === 'assistant') {
            turn.answer = cardText(message.text, CARD_ANSWER_LENGTH)
            turn.answerSeq = Number.isSafeInteger(message.sourceSeq) ? message.sourceSeq : turn.answerSeq
            turn.error = null
          }
          if (typeof message.at === 'string') turn.at = message.at
        }
        if (ids.length > 0) processIds.push(...ids)
      }
      delete thread.messages
      delete thread.pendingProcess
      thread.turns = turns
      thread.processIds = [...new Set(processIds)]
    }
  }
  return changed
}

/**
 * Fold v3-era standalone tool cards (kinds `tool` / `tool-result`) into the
 * preceding assistant message's `process` list, pairing each call with the
 * result that follows it in order, so every tool invocation lives in one
 * home: the assistant turn card.
 */
function foldLegacyToolCards(workspaces) {
  let changed = false
  for (const workspace of workspaces) {
    for (const thread of workspace.threads ?? []) {
      if (!Array.isArray(thread.messages)) continue
      const folded = []
      let assistant = null
      let pending = []
      for (const message of thread.messages) {
        if (message.kind === 'assistant') {
          assistant = message
          assistant.process ??= []
          pending = []
          folded.push(message)
          continue
        }
        if (message.kind !== 'tool' && message.kind !== 'tool-result') {
          folded.push(message)
          continue
        }
        if (assistant === null) {
          folded.push(message)
          continue
        }
        changed = true
        if (message.kind === 'tool') {
          const [name = '工具调用', ...argumentLines] = message.text.split('\n')
          const entry = { callId: `legacy-${assistant.process.length}`, name, arguments: argumentLines.join('\n'), result: null, error: null }
          pending.push(entry)
          assistant.process.push(entry)
        } else {
          const entry = pending.shift() ?? (() => {
            const orphan = { callId: `legacy-orphan-${assistant.process.length}`, name: '工具调用', arguments: null, result: null, error: null }
            assistant.process.push(orphan)
            return orphan
          })()
          entry.result = message.text
        }
      }
      thread.messages = folded
    }
  }
  return changed
}

function positionOf(value) {
  const x = Number(value?.x)
  const y = Number(value?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new InputError('position 必须包含有效坐标')
  return { x: Math.round(Math.max(-2000, Math.min(5000, x))), y: Math.round(Math.max(-2000, Math.min(5000, y))) }
}

function requiredText(value, maxLength, field) {
  if (typeof value !== 'string') throw new InputError(`${field} 必须是文本`)
  const text = value.trim()
  if (text.length === 0) throw new InputError(`${field} 不能为空`)
  if (text.length > maxLength) throw new InputError(`${field} 超过长度限制`)
  return text
}

function projectableEvent(event) {
  switch (event.type) {
    case 'user/message': {
      if (!isHumanUserEvent(event)) return null
      return noteProjection('user', userMessageText(event))
    }
    case 'assistant/message':
      return noteProjection('assistant', contentText(event.data?.message?.content))
    case 'todo/write':
      return noteProjection('todo', Array.isArray(event.data?.todos) ? event.data.todos.map(todo => `[${todo.status}] ${todo.content}`).join('\n') : '')
    case 'turn/end': {
      const reason = event.data?.reason
      if (reason?.kind === 'error') return noteProjection('error', errorText(reason.error) ?? '本轮执行失败')
      if (reason?.kind === 'cancelled' || reason?.kind === 'canceled' || reason?.kind === 'aborted') return noteProjection('error', '本轮已取消')
      return null
    }
    default:
      return /(?:error|failed|failure|cancel(?:led)?|abort)/i.test(event.type)
        ? noteProjection('error', errorText(event.data?.error ?? event.data?.reason ?? event.data) ?? 'Harness 运行失败')
        : null
  }
}

// Markers that open a session's OWN log. A fork created by spawning a
// subagent/child session starts its log from scratch with one of these at
// seq 0, never with inherited parent history — so projecting from 0 cannot
// duplicate the parent's turns.
const OWN_LOG_BOOTSTRAP_TYPES = new Set(['permission/preset', 'sandbox/mode', 'approval/policy', 'subagent/descriptor'])

/**
 * Resolve where a fork's OWN history starts, so only the child's new turns are
 * projected and the inherited parent history stays on the parent's cards.
 *
 * DSH persists the cut as `header.seedLength`, but that field is frequently
 * absent (84% of forks in one real profile). Fallbacks cover it, in order:
 *
 * 1. `header.inheritedEventCount` — a live session reports exactly how many
 *    leading events are the parent's; it outranks the stored `seedLength`,
 *    which a restored fork can over- or under-report;
 * 2. `header.seedLength`, when it is a non-negative safe integer;
 * 3. the durable `session/end-seed` marker event — per the session contract,
 *    readers of STORED history must locate the LAST such event rather than
 *    trust the in-process `firstLiveSeq`;
 * 4. a log that opens with a session's own bootstrap marker at seq 0, which
 *    means it holds no inherited history, so 0 is a safe boundary.
 *
 * @returns the seq to project from, or `null` when the boundary is unknown.
 */
export function forkSeqBoundary(events, header) {
  const inherited = inheritedCountOf(header)
  if (inherited !== null) return inherited
  const seedLength = seedLengthOf(header)
  if (seedLength !== null) return seedLength
  if (!Array.isArray(events) || events.length === 0) return null
  let boundary = null
  for (const event of events) if (event?.type === 'session/end-seed') boundary = event.seq + 1
  if (boundary !== null) return boundary
  const first = events[0]
  return first?.seq === 0 && OWN_LOG_BOOTSTRAP_TYPES.has(first.type) ? 0 : null
}

/**
 * Where in the PARENT's log this fork was cut, or `null` when unknown.
 *
 * This is the anchoring question, and it is deliberately stricter than
 * `forkSeqBoundary`: the canvas attaches a branch under the parent turn with
 * the greatest seq below this value. A bootstrap-derived boundary of 0 means
 * only "this child's log starts from scratch" — it says nothing about which
 * parent turn it came from, so using it as an anchor would attach the branch
 * under nothing (parent turns all have seq >= 0) and leave it a root anyway.
 *
 * Only a durable cut identifies the anchor: `inheritedEventCount`,
 * `seedLength`, or an `end-seed` marker.
 */
export function forkAnchorSeq(events, header) {
  const inherited = inheritedCountOf(header)
  if (inherited !== null) return inherited
  const seedLength = seedLengthOf(header)
  if (seedLength !== null) return seedLength
  if (!Array.isArray(events)) return null
  let boundary = null
  for (const event of events) if (event?.type === 'session/end-seed') boundary = event.seq + 1
  return boundary
}

/**
 * A persisted `seedLength`, accepting only well-formed values.
 *
 * A negative, fractional, or non-numeric seedLength is a corrupt record, not
 * a boundary; null lets the end-seed marker take over instead of projecting
 * from a bogus index.
 */
function seedLengthOf(header) {
  const value = header?.seedLength
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

/**
 * Whether a session is a spawned subagent rather than a user-visible fork.
 *
 * Subagent logs are delegation mechanics, not conversation branches: the user
 * never opened them, so their cards would only clutter the canvas. Reads the
 * three shapes DSH reports (a bare descriptor, a header, or a meta bag), the
 * delegation depth, and the session's own descriptor event.
 */
export function isSubagentSession(session) {
  if (session === null || typeof session !== 'object') return false
  if (session.origin === 'subagent') return true
  if (session.header?.origin === 'subagent') return true
  if (session.meta?.origin === 'subagent') return true
  if (Number.isSafeInteger(session.delegationDepth) && session.delegationDepth > 0) return true
  const events = session.events
  if (Array.isArray(events) && events.some(event => event?.type === 'subagent/descriptor')) return true
  return false
}

/**
 * Whether a session title is a generated placeholder rather than a real
 * question, so a card never shows the harness's own label as content.
 *
 * DSH names untitled sessions 当前会话 / 等待用户提问, and every fork it
 * creates gets " 分支" appended — whatever the parent's title was. So a
 * trailing 分支 marks a generated name, a real first question never has one.
 */
export function isSessionLabelQuestion(text) {
  if (typeof text !== 'string') return false
  const trimmed = text.trim()
  if (trimmed === '' || trimmed === '会话' || trimmed === 'DSH 会话') return true
  if (trimmed === '当前会话' || trimmed === '等待用户提问') return true
  return trimmed.endsWith('分支')
}

/**
 * A DSH session title worth storing.
 *
 * The harness generates names like 当前会话 and appends " 分支" to every fork's
 * title. Copying those onto a thread would put the harness's own label on the
 * canvas as if it were content, so they are rejected here and the thread keeps
 * its current title until a real first question arrives.
 */
function usableSessionTitle(value) {
  if (typeof value !== 'string') return null
  const title = value.trim().slice(0, MAX_TITLE_LENGTH)
  return title === '' || isSessionLabelQuestion(title) ? null : title
}

/** A card the user never asked for: a generated label standing in for a question. */
function isPlaceholderTurn(turn) {
  if (turn?.human === true) return false
  return turn != null && isSessionLabelQuestion(turn.question)
}

/**
 * Re-title the placeholder cards of one thread from its own event log.
 *
 * A reply can be projected before the question that opened its turn (a fork
 * replayed from a boundary, or a mid-turn replay), which leaves a card titled
 * 等待用户提问. The log still holds the real prompt, so each placeholder is
 * matched with the next human message that no other card already claims.
 */
function repairTurnQuestions(thread, events, replayFrom = 0) {
  if (thread == null) return
  const from = Number.isSafeInteger(replayFrom) ? replayFrom : 0
  const humans = (Array.isArray(events) ? events : [])
    .filter(event => isHumanUserEvent(event) && event.seq >= from)
    .sort((left, right) => left.seq - right.seq)
  let index = 0
  for (const turn of thread.turns ?? []) {
    if (typeof turn.question === 'string' && !isPlaceholderTurn(turn)) {
      const match = humans.findIndex(event => event.seq === turn.seq)
      if (match >= index) index = match + 1
      continue
    }
    const human = humans[index]
    if (human === undefined) {
      turn.question = '等待用户提问'
      continue
    }
    index += 1
    turn.seq = human.seq
    turn.question = cardText(userMessageText(human), CARD_QUESTION_LENGTH)
  }
}

/** Drop already-stored cards whose title is injected harness text. */
function dropInjectedTurns(workspaces) {
  let changed = false
  for (const workspace of workspaces ?? []) {
    for (const thread of workspace.threads ?? []) {
      const turns = thread.turns
      if (!Array.isArray(turns) || turns.length === 0) continue
      const kept = turns.filter(turn => !isRuntimeContextText(turn?.question))
      if (kept.length === turns.length) continue
      thread.turns = kept
      changed = true
    }
  }
  return changed
}

/** Re-title stored cards that carry a generated session label. */
function rewriteSessionLabelQuestions(workspaces) {
  let changed = false
  for (const workspace of workspaces ?? []) {
    for (const thread of workspace.threads ?? []) {
      for (const turn of thread.turns ?? []) {
        if (!isSessionLabelQuestion(turn.question)) continue
        turn.question = '等待用户提问'
        changed = true
      }
    }
  }
  return changed
}

/**
 * Project the fork branches that the live-session replay never reached.
 *
 * `autoProjection` only replays sessions that are live in this DSH process
 * (`ctx.sessions.list()`). After a restart, every other session — including
 * forks the user branched into and then switched away from — keeps no cards,
 * so its branch shows on the map as an empty placeholder. Measured on one
 * profile: 23 of 30 forks had real turns on disk but zero cards.
 *
 * The scan is deliberately narrow (forks only, per the configured scope) and
 * runs in the background so startup is never blocked:
 *
 * 1. list session headers and pick the ones that have a `parentSession`;
 * 2. skip any session that already has cards, or that the user archived;
 * 3. inspect each remaining fork's log (live sessions come from memory, cold
 *    ones from persistence — the same two paths the detail view uses);
 * 4. project only the events from the fork's own seed boundary onward.
 *
 * Forks whose boundary cannot be determined are left alone rather than
 * projected from 0, which would duplicate their parent's history onto the map.
 */
async function backfillForks(ctx, store, workspaceTitle, reportFailure) {
  const persistence = resolvePersistence(ctx)
  if (persistence === undefined || persistence === null || typeof persistence.list !== 'function') return
  let listed
  try {
    listed = await persistence.list()
  } catch {
    return
  }
  const records = persistenceListEntries(listed)
  if (records.length === 0) return
  const headers = records.map(record => record.header)
  const alreadyProjected = await store.projectedSessionIds()
  // Subagent children are delegation mechanics, not conversation branches:
  // drop any cards an earlier pass gave them (without hiding them — a live
  // subagent must not read as "archived") and keep them out of the queue.
  const subagentIds = headers.filter(header => isSubagentSession(header)).map(header => header.id)
  const leftoverSubagents = [...alreadyProjected].filter(id => subagentIds.includes(id))
  if (leftoverSubagents.length > 0) await store.dropProjectedSessions(leftoverSubagents)
  const queue = records.filter(record => {
    const header = record.header
    return typeof header?.parentSession === 'string'
      && typeof header?.id === 'string'
      && !subagentIds.includes(header.id)
      && !isSubagentSession(header)
      && !alreadyProjected.has(header.id)
  }).map(record => record.header)
  if (queue.length === 0) return
  const projected = new Set(alreadyProjected)
  // Yield between sessions: a large profile has hundreds of logs, and the
  // canvas stays responsive while they are filled in one at a time.
  for (const header of queue) {
    try {
      const events = await readSessionEvents(ctx, header.id)
      if (events === null || events.length === 0) continue
      const boundary = forkSeqBoundary(events, header)
      if (boundary === null) continue
      // A fork only attaches under its parent's turn when the parent itself
      // has cards. Parents are usually cold too (they were branched away from
      // and never re-opened), so backfill the parent first — from 0, since a
      // root session owns its whole log — but only as far as the fork point's
      // own history, never beyond what the fork needs as an anchor.
      if (typeof header.parentSession === 'string' && !projected.has(header.parentSession)) {
        const parentEvents = await readSessionEvents(ctx, header.parentSession)
        if (parentEvents !== null && parentEvents.length > 0) {
          const parentHeader = headers.find(item => item?.id === header.parentSession) ?? { id: header.parentSession }
          await store.projectSession({ id: header.parentSession, header: parentHeader, events: parentEvents }, 0, workspaceTitle)
          projected.add(header.parentSession)
          await store.flush()
        }
      }
      // Pass the resolved boundary through: it becomes the thread's
      // `sourceSeedLength`, which is what lets the canvas anchor this branch
      // under the exact parent turn it forked from. Only a real, durable cut
      // can serve as that anchor (see `forkAnchorSeq`) — a bootstrap-derived
      // start point would attach the branch under nothing.
      const anchor = forkAnchorSeq(events, header)
      const thread = await store.projectSession({ id: header.id, header, events, seedBoundary: anchor }, boundary, workspaceTitle)
      if (thread !== null) projected.add(header.id)
      await store.flush()
    } catch (error) {
      reportFailure(error)
    }
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

/**
 * Read a live session's event log, whichever way it offers one.
 *
 * A live Session's `events` is a prototype getter over the in-memory log; a
 * projected or test-shaped session exposes the same log through a
 * `snapshotEvents()` callable. Both are read so one helper serves every shape.
 *
 * @returns the events, or `null` when the session exposes no log.
 */
function sessionEventLog(session) {
  if (session === null || typeof session !== 'object') return null
  if (typeof session.snapshotEvents === 'function') {
    const events = session.snapshotEvents()
    return Array.isArray(events) ? events : null
  }
  if (Array.isArray(session.events)) return session.events
  return null
}

/**
 * The count of leading events a fork inherited from its parent, when the
 * session reports one.
 */
function inheritedCountOf(header) {
  const value = header?.inheritedEventCount
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function resolvePersistence(ctx) {
  try {
    if (typeof ctx.get === 'function') {
      const viaGet = ctx.get('sessionPersistence')
      if (viaGet !== undefined && viaGet !== null) return viaGet
    }
    return ctx.sessionPersistence
  } catch {
    return undefined
  }
}

/**
 * Normalize `sessionPersistence.list()` across DSH hosts.
 *
 * 0.1.5 returns `{ header, revision, sizeBytes }` snapshots. Earlier hosts
 * returned the header objects themselves. Either shape is accepted.
 */
export function persistenceListEntries(listed) {
  if (!Array.isArray(listed)) return []
  const entries = []
  for (const item of listed) {
    if (item == null || typeof item !== 'object') continue
    const nested = item.header
    const header = nested != null && typeof nested === 'object' && typeof nested.id === 'string'
      ? nested
      : (typeof item.id === 'string' ? item : null)
    if (header == null) continue
    const inherited = inheritedCountOf(item) ?? inheritedCountOf(header)
    entries.push(inherited == null ? { header } : { header: { ...header, inheritedEventCount: inherited }, inheritedEventCount: inherited })
  }
  return entries
}

/**
 * Read one session's committed events, live or cold.
 *
 * A live session's log is already in memory, so it is read directly. An
 * archived or not-yet-restored session is inspected through persistence
 * (read-only: it does not publish the session or commit crash recovery), so
 * opening a card for an old conversation still shows its full turn.
 *
 * @returns the events, or `null` when the session has no readable log.
 */
async function readSessionEvents(ctx, sessionId) {
  if (sessionId === '') return null
  // Both services are resolved defensively: cordis's Context proxy throws
  // `cannot get property ... without inject` on an undeclared service, and a
  // branded-id store rejects a raw string. Either way the detail view should
  // show the card summary — not fail the request.
  let live
  try {
    live = ctx.sessions.get(sessionId)
  } catch {
    live = undefined
  }
  if ((live === undefined || live === null) && typeof ctx.sessions?.list === 'function') {
    try {
      live = ctx.sessions.list().find(session => session?.id === sessionId || String(session?.id ?? '') === sessionId)
    } catch {
      live = undefined
    }
  }
  if (live !== undefined && live !== null) {
    const events = sessionEventLog(live)
    if (events !== null) return events
  }
  const persistence = resolvePersistence(ctx)
  if (persistence === undefined || persistence === null) return null
  // DSH 0.1.1 exposed `inspect`. 0.1.5 removed it: cold sessions are opened
  // read-only and `read()` from seq 0, then the handle is closed. Using
  // `inspect` when it still exists keeps older hosts working.
  if (typeof persistence.inspect === 'function') {
    try {
      const inspection = await persistence.inspect(sessionId)
      return Array.isArray(inspection?.events) ? inspection.events : null
    } catch {
      return null
    }
  }
  if (typeof persistence.open !== 'function') return null
  let handle
  try {
    handle = await persistence.open(sessionId, 'read')
    const result = await handle.read()
    return Array.isArray(result?.events) ? result.events : null
  } catch {
    // A session whose log was deleted or is still being written has no detail
    // to show; the card summary still renders.
    return null
  } finally {
    if (handle != null && typeof handle.close === 'function') {
      try { await handle.close() } catch { /* already closed or never opened */ }
    }
  }
}

/** Resolve a card's completed history without inheriting the following inbox insertion. */
export function cardForkSeed(events, target) {
  if (!Number.isSafeInteger(target?.seq) && !target?.reference?.messageId) throw new InputError('缺少分支来源消息')
  if (!target?.reference?.messageId && !target?.reference?.question) throw new InputError('缺少分支来源消息身份')
  const detail = buildTurnDetail(events, target.seq, undefined, target.reference)
  if (detail.question === null) throw new InputError('无法定位所选卡片的原始消息，请刷新后重试')
  const ordered = [...events].sort((left, right) => left.seq - right.seq)
  const start = ordered.findIndex(event => event.seq === detail.seq)
  for (let index = start + 1; index < ordered.length; index++) {
    const event = ordered[index]
    if (event.type === 'turn/start' || isHumanUserEvent(event)) break
    if (event.type !== 'turn/end') continue
    if (event.data?.reason?.kind !== 'completed') break
    const seed = ordered.slice(0, index + 1)
    const answer = seed.findLast(item => item.seq > detail.seq && item.type === 'assistant/message')
    return { seed, sourceAnchorSeq: answer?.seq ?? detail.seq }
  }
  throw new InputError('请等待所选卡片完成后再创建分支')
}

/** Create an ordinary host session, but with the exact card boundary and an empty inbox. */
export async function forkCardSession(ctx, input) {
  const parentId = requiredText(input?.sessionId, 200, 'sessionId')
  if (typeof input?.operationId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.operationId)) {
    throw new InputError('缺少有效的分支操作标识')
  }
  const childId = `session-${input.operationId}`
  const existing = ctx.sessions.get(childId)
  if (existing !== undefined && existing.header.parentSession !== parentId) throw new InputError('分支操作标识已被其他会话使用')
  const source = await ctx.sessionQuery.observeSession(parentId)
  try {
    const { seed, sourceAnchorSeq } = cardForkSeed(source.events, input.target)
    const workspaces = ctx.workspaceRegistry.list()
    let workspace = workspaces.find(item => item.sessionIds.includes(parentId))
    if (workspace === undefined && source.header.origin === 'subagent') {
      const lineage = await ctx.sessionQuery.traceSession(parentId)
      for (const ancestor of lineage.ancestors) {
        workspace = workspaces.find(item => item.sessionIds.includes(ancestor.header.id))
        if (workspace !== undefined) break
      }
    }
    if (existing === undefined) {
      const presetId = source.projections?.values?.agentPreset ?? source.header.agentPreset
      const preset = await ctx.agentPresets.resolve(presetId)
      const { provider, model } = ctx.agentDefaultModel.currentSelection()
      await ctx.agents.create({
        sessionId: childId,
        seed,
        inheritedEventCount: seed.length,
        meta: {
          ...(source.header.cwd === undefined ? {} : { cwd: source.header.cwd }),
          parentSession: parentId,
          isSeeded: true,
          agentPreset: preset.id,
        },
        agentOptions: { provider, model },
        setup: async (agentCtx, agent) => {
          // Messages can also have been queued DURING the selected turn.
          // Clear only the child's inbox, before publication can wake it.
          agent.inbox.clear()
          await ctx.agentPresets.mount(agentCtx, preset.id)
        },
      })
    }
    if (workspace !== undefined && !workspace.sessionIds.includes(childId)) await workspace.attachSession(childId)
    return { id: childId, parentId, sourceAnchorSeq }
  } finally {
    source[Symbol.dispose]?.()
  }
}

export function createCardForkRunner(ctx) {
  const operations = new Map()
  return input => {
    const key = input?.operationId
    const previous = operations.get(key)
    if (previous !== undefined) {
      if (previous.parentId !== input.sessionId) return Promise.reject(new InputError('分支操作标识已被其他会话使用'))
      return previous.promise
    }
    const promise = forkCardSession(ctx, input)
    operations.set(key, { parentId: input?.sessionId, promise })
    promise.catch(() => { if (operations.get(key)?.promise === promise) operations.delete(key) })
    return promise
  }
}

/**
 * Rebuild the full detail of one turn straight from a DSH session's event log.
 *
 * v5 stores only a display-sized card summary, so the detail view reads the
 * real text (and every tool call with its arguments and output) back from the
 * session instead of from the canvas metadata. `events` are the session's
 * committed events in seq order; `turnSeq` is the turn's opening user event.
 */
export function buildTurnDetail(events, turnSeq, turnIndex, reference) {
  if (!Array.isArray(events)) return { question: null, steps: [], process: [], flow: [] }
  const ordered = [...events].sort((left, right) => left.seq - right.seq)
  // Only a REAL user question opens a turn. DSH emits runtime-context
  // snapshots and <system-reminder> blocks as user-role messages too; the
  // card projection already skips them, so the detail view must slice on the
  // same rule or those blocks would split one turn into several.
  const isTurnStart = isHumanUserEvent
  const byMessageId = typeof reference?.messageId === 'string'
    ? ordered.findIndex(event => isTurnStart(event) && (event.data?.id ?? event.data?.message?.id) === reference.messageId)
    : -1
  let start = reference?.messageId ? byMessageId : ordered.findIndex(event => event.seq === turnSeq && isTurnStart(event))
  if (start === -1 && !reference?.messageId && Number.isSafeInteger(turnSeq) && ordered.some(event => event.seq === turnSeq)) {
    for (let index = 0; index < ordered.length && ordered[index].seq <= turnSeq; index++) {
      if (isTurnStart(ordered[index])) start = index
    }
  }
  if (start === -1 && !reference?.messageId && !Number.isSafeInteger(turnSeq)) {
    // Fall back to the card's zero-based turn index when the durable seq is
    // unavailable (legacy data, or a turn discovered before its event was
    // committed). Only fall back to the first turn when neither key exists.
    const starts = ordered.reduce((indices, event, index) => {
      if (isTurnStart(event)) indices.push(index)
      return indices
    }, [])
    start = Number.isInteger(turnIndex) && turnIndex >= 0 && turnIndex < starts.length
      ? starts[turnIndex]
      : Number.isInteger(turnIndex) ? -1 : starts[0] ?? -1
  }
  const expected = typeof reference?.question === 'string' ? reference.question : ''
  const matchesQuestion = event => {
    const actual = userMessageText(event).trim()
    return expected.length === CARD_QUESTION_LENGTH + 1 && expected.endsWith(TRUNCATED_MARK)
      ? actual.startsWith(expected.slice(0, -1))
      : actual === expected.trim()
  }
  if (start !== -1 && byMessageId === -1 && expected !== '' && !matchesQuestion(ordered[start])) start = -1
  if (start === -1 && !reference?.messageId && reference?.root === true && reference.unique === true && expected !== '') {
    const matches = ordered.flatMap((event, index) => isTurnStart(event) && matchesQuestion(event) ? [index] : [])
    if (matches.length === 1) start = matches[0]
  }
  if (start === -1) {
    return { question: null, steps: [], process: [], flow: [] }
  }
  const end = ordered.findIndex((event, index) => index > start && isTurnStart(event))
  const slice = ordered.slice(start, end === -1 ? undefined : end)
  const questionText = userMessageText(ordered[start])
  const question = questionText.trim() === '' ? null : questionText
  const steps = []
  const process = []
  const flow = []
  for (const event of slice.slice(1)) {
    if (event.type === 'assistant/message' || event.type === 'todo/write') {
      const text = event.type === 'todo/write'
        ? (Array.isArray(event.data?.todos) ? event.data.todos.map(todo => `[${todo.status}] ${todo.content}`).join('\n') : '')
        : contentText(event.data?.message?.content)
      if (text.trim() === '') continue
      const step = { kind: 'assistant', seq: event.seq, at: new Date(event.time).toISOString(), text }
      steps.push(step)
      flow.push(step)
      continue
    }
    if (event.type === 'turn/end' && ['error', 'cancelled', 'canceled', 'aborted', 'interrupted'].includes(event.data?.reason?.kind)) {
      const text = event.data.reason.kind === 'error' ? errorText(event.data.reason.error) ?? '本轮执行失败' : '本轮已取消'
      const step = { kind: 'error', seq: event.seq, at: new Date(event.time).toISOString(), text }
      steps.push(step)
      flow.push(step)
      continue
    }
    if (event.type !== 'tool/call' && event.type !== 'tool/result') continue
    const data = event.data ?? {}
    const callId = String(event.type === 'tool/call' ? data.callId : data.message?.source?.callId ?? '')
    // An empty callId cannot be paired (legacy records), so it always appends.
    const entry = callId === '' ? undefined : process.find(item => item.callId === callId)
    if (event.type === 'tool/call') {
      if (entry !== undefined) {
        // A redelivered call keeps the first record; only the name/args refresh.
        entry.name = typeof data.name === 'string' ? data.name : entry.name
        entry.arguments = typeof data.arguments === 'string' ? data.arguments : entry.arguments
        continue
      }
      const created = {
        kind: 'tool',
        callId,
        name: typeof data.name === 'string' ? data.name : '工具调用',
        arguments: typeof data.arguments === 'string' ? data.arguments : '',
        result: null,
        error: null,
      }
      process.push(created)
      flow.push(created)
      continue
    }
    if (entry === undefined) {
      // A result whose call was never seen (or arrived out of order) still
      // shows its output instead of being dropped.
      const created = { kind: 'tool', callId, name: '工具结果', arguments: '', result: contentText(data.message?.content), error: errorText(data.error) }
      process.push(created)
      flow.push(created)
      continue
    }
    entry.result = contentText(data.message?.content)
    entry.error = errorText(data.error)
  }
  return {
    question, steps, process, flow,
    format: 'structured-v1',
    messageId: ordered[start].data?.id ?? ordered[start].data?.message?.id,
    seq: ordered[start].seq,
    revision: slice.at(-1)?.seq ?? ordered[start].seq,
    complete: end !== -1 || slice.some(event => event.type === 'turn/end'),
  }
}

function errorText(value) {
  if (typeof value === 'string') return value.trim() || null
  if (value === null || value === undefined || typeof value !== 'object') return null
  const name = typeof value.name === 'string' && value.name.trim() !== '' ? value.name.trim() : ''
  const code = typeof value.code === 'string' && value.code.trim() !== '' ? value.code.trim() : ''
  const message = typeof value.message === 'string' && value.message.trim() !== '' ? value.message.trim() : ''
  if (message !== '') return [name, code].filter(Boolean).concat(message).join(': ')
  return [name, code].filter(Boolean).join(': ') || null
}

/** Cap a card field for display; the detail view re-reads the full text from DSH. */
function cardText(text, limit) {
  const value = String(text ?? '')
  return value.length <= limit ? value : `${value.slice(0, limit)}${TRUNCATED_MARK}`
}

function noteProjection(kind, text) {
  const normalized = text.trim()
  if (normalized === '') return null
  if (normalized.length <= MAX_PROJECTION_LENGTH) return { kind, text: normalized }
  return { kind, text: `${normalized.slice(0, MAX_PROJECTION_LENGTH)}${PROJECTION_TRUNCATED_SUFFIX}` }
}

function userMessageText(event) {
  return contentText(event?.data?.content ?? event?.data?.message?.content)
}

function userMessageSourceKind(event) {
  return event?.data?.source?.kind ?? event?.data?.message?.source?.kind
}

/**
 * Whether a `user/message` event is a prompt the human actually sent.
 *
 * DSH reuses the user role for several kinds of injected text: runtime-context
 * snapshots, <system-reminder> blocks, checkpoint condensations, policy-change
 * notices, background-job and subagent notifications. All of them reach the log
 * as user-role messages, and every one of them was showing up on the map as its
 * own card — including the 当前会话 cards in the screenshot, which opened a
 * turn before the user's real first message landed.
 */
export function isHumanUserEvent(event) {
  if (event?.type !== 'user/message') return false
  const kind = userMessageSourceKind(event)
  if (kind !== undefined && kind !== 'user') return false
  return isHumanUserText(userMessageText(event))
}

export function isHumanUserText(text) {
  return typeof text === 'string' && text.trim() !== '' && !isRuntimeContextText(text)
}

function isRuntimeContextText(text) {
  if (typeof text !== 'string') return false
  const trimmed = text.trimStart()
  // DSH emits several kinds of injected context as user-role messages: the
  // runtime-context snapshot and <system-reminder> blocks. None of them is a
  // real user turn, so they must not become their own conversation card.
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

function isRuntimeContextMessage(message) {
  return message?.kind === 'user' && isRuntimeContextText(message.text)
}

function contentText(content) {
  if (!Array.isArray(content)) return ''
  // Tool calls already have their own execution records. Flattening their
  // name/arguments here duplicates them as assistant prose (and Markdown).
  return content.filter(block => block?.type === 'text')
    .map(block => block.text)
    .filter(value => typeof value === 'string' && value.trim() !== '').join('\n')
}

function titleFromText(text) {
  const line = text.replaceAll(/\s+/g, ' ').trim()
  return (line.length > 42 ? `${line.slice(0, 42)}...` : line) || 'DSH 会话'
}

function sessionCwd(session) {
  const cwd = session.header?.meta?.cwd ?? session.header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : '未指定工作目录'
}

function workspaceTitle(cwd, fallbackTitle) {
  if (cwd === '未指定工作目录') return fallbackTitle
  const segment = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1)
  return segment && segment.trim() !== '' ? segment : fallbackTitle
}

async function readJson(req) {
  const chunks = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > MAX_BODY_BYTES) throw new InputError('请求内容过大')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new InputError('请求不是有效 JSON') }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function sendFile(res, contentType, body) {
  res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' })
  res.end(body)
}

function page() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synapse for DSH</title><link rel="stylesheet" href="/synapse/styles.css"></head><body><div id="app"></div><script src="/synapse/app.js"></script></body></html>`
}

/** Mount Synapse routes on the existing DSH Web Server. */
export function apply(ctx, config) {
  const store = new WorkspaceStore(config?.dataFile)
  const autoProjection = config?.autoProjection !== false
  const projectionWorkspaceTitle = typeof config?.projectionWorkspaceTitle === 'string' && config.projectionWorkspaceTitle.trim() !== ''
    ? config.projectionWorkspaceTitle.trim().slice(0, MAX_TITLE_LENGTH)
    : 'DSH 任务'
  const reportProjectionFailure = error => {
    ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
  }
  const replaySession = session => {
    // Forks inherit their parent's log. The canvas already represents that
    // history through the parent node, so only project the child's own turns.
    //
    // `firstLiveSeq` alone is not enough: when a fork is restored from disk,
    // its constructor seed is the whole stored log, so `firstLiveSeq` can sit
    // past the branch's own first message and that message would be skipped —
    // leaving the branch an empty card. `forkSeqBoundary` resolves the real
    // cut (durable seedLength, else the end-seed marker, else an own-log
    // bootstrap header) and falls back to firstLiveSeq only when unknown.
    const events = sessionEventLog(session) ?? []
    const header = { ...session.header, inheritedEventCount: session.inheritedEventCount ?? session.header?.inheritedEventCount }
    const parentSession = header.parentSession
    const replayFrom = parentSession === undefined
      ? 0
      : (forkSeqBoundary(events, header) ?? session.firstLiveSeq ?? 0)
    void store.projectSession(
      {
        id: session.id, title: session.title, header, events,
        inheritedEventCount: header.inheritedEventCount,
        seedBoundary: parentSession === undefined ? undefined : forkAnchorSeq(events, header),
      },
      replayFrom,
      projectionWorkspaceTitle,
    ).catch(reportProjectionFailure)
  }
  // Buffer live events per session and flush them in one write per microtask,
  // so a burst of turn events coalesces into a single save instead of N.
  backfillForks(ctx, store, projectionWorkspaceTitle, reportProjectionFailure)
  const projectionQueue = []
  let projectionScheduled = false
  const enqueueProjection = (session, event) => {
    projectionQueue.push({ session, event })
    if (projectionScheduled) return
    projectionScheduled = true
    queueMicrotask(() => {
      projectionScheduled = false
      const batch = projectionQueue.splice(0)
      const bySession = new Map()
      for (const item of batch) {
        const entry = bySession.get(item.session.id)
        if (entry === undefined) bySession.set(item.session.id, [item.session, [item.event]])
        else entry[1].push(item.event)
      }
      for (const [sessionId, [session, events]] of bySession) {
        void store.projectEvents(session, events, projectionWorkspaceTitle).catch(reportProjectionFailure)
      }
    })
  }
  if (autoProjection) {
    ctx.on('session/created', replaySession)
    ctx.on('session/event', enqueueProjection)
    for (const session of ctx.sessions.list()) replaySession(session)
  }
  // The DSH /api browser-trust fence does not cover /synapse routes, so this
  // handler checks the Host header itself: localhost is allowed by default and
  // additional authorities opt in through config.trustedHosts (mirrors the
  // fence's DNS-rebinding defense).
  const trustedHosts = new Set(['localhost', '127.0.0.1', ...[...(config?.trustedHosts ?? [])].map(host => String(host).trim().toLowerCase()).filter(Boolean)])
  const forkCard = createCardForkRunner(ctx)
  const api = async (req, res) => {
    try {
      const hostname = (typeof req.headers.host === 'string' ? req.headers.host : '').replace(/:\d+$/, '').toLowerCase()
      if (!trustedHosts.has(hostname)) return sendJson(res, 403, { error: '不被信任的 Host' })
      const path = new URL(req.url ?? '/', 'http://dsh.local').pathname
      if (path === '/synapse/api/fork-card' && req.method === 'POST') {
        const rejection = typeof ctx.connection?.requestRejection === 'function' ? ctx.connection.requestRejection(req) : 401
        if (rejection !== undefined) return sendJson(res, rejection, { error: rejection === 401 ? '请先登录 DSH' : '不被信任的请求来源' })
        return sendJson(res, 201, { session: await forkCard(await readJson(req)) })
      }
      if (path === '/synapse/api/reset' && req.method === 'POST') return sendJson(res, 200, await store.clearLegacy(ctx.sessions.list()))
      if (path === '/synapse/api/workspaces') {
        if (req.method === 'GET') return sendJson(res, 200, { workspaces: await store.list() })
        if (req.method === 'POST') return sendJson(res, 201, { workspace: await store.create((await readJson(req)).title) })
      }
      const workspace = /^\/synapse\/api\/workspaces\/([0-9a-f-]+)$/i.exec(path)
      if (workspace !== null) {
        if (req.method === 'GET') return sendJson(res, 200, { workspace: await store.get(workspace[1]) })
        if (req.method === 'POST') return sendJson(res, 201, { thread: await store.createThread(workspace[1], await readJson(req)) })
      }
      const branch = /^\/synapse\/api\/threads\/([0-9a-f-]+)\/branch$/i.exec(path)
      if (branch !== null && req.method === 'POST') return sendJson(res, 201, { thread: await store.branch(branch[1], await readJson(req)) })
      const cardTitle = /^\/synapse\/api\/threads\/([0-9a-f-]+)\/cards\/(\d+|i\d+)$/i.exec(path)
      if (cardTitle !== null && req.method === 'PATCH') return sendJson(res, 200, { thread: await store.updateCardTitle(cardTitle[1], cardTitle[2], (await readJson(req))?.title) })
      if (path === '/synapse/api/cards/visibility' && req.method === 'PATCH') {
        const body = await readJson(req)
        return sendJson(res, 200, await store.updateCardVisibility(body?.cards, body?.hidden))
      }
      if (path === '/synapse/api/sessions/sync' && req.method === 'POST') { const body = await readJson(req); return sendJson(res, 200, { workspaces: await store.syncSessions(body.sessions, body.removedSessionIds) }) }
      if (path === '/synapse/api/turn-cursor' && req.method === 'POST') {
        const body = await readJson(req)
        const events = await readSessionEvents(ctx, typeof body.sessionId === 'string' ? body.sessionId : '')
        if (events === null) return sendJson(res, 404, { error: '会话已不可用' })
        return sendJson(res, 200, { lastUserSeq: events.filter(isHumanUserEvent).at(-1)?.seq ?? -1 })
      }
      // Detail on demand: the canvas stores only card summaries, so the full
      // turn (every assistant step plus tool arguments and outputs) is read
      // back from the DSH session when the user opens it. Live sessions are
      // read from memory; archived/cold ones come from persistence, so the
      // detail view works for every card on the map, not just the current one.
      if (path === '/synapse/api/turn-detail' && req.method === 'POST') {
        const body = await readJson(req)
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
        const events = await readSessionEvents(ctx, sessionId)
        if (events === null) {
          return sendJson(res, 404, { error: '会话已不可用' })
        }
        return sendJson(res, 200, {
          detail: buildTurnDetail(
            events,
            Number.isSafeInteger(body.seq) ? body.seq : null,
            Number.isSafeInteger(body.turnIndex) ? body.turnIndex : null,
            body.reference,
          ),
        })
      }
      const messages = /^\/synapse\/api\/threads\/([0-9a-f-]+)\/messages$/i.exec(path)
      if (messages !== null && req.method === 'POST') return sendJson(res, 201, { thread: await store.addMessage(messages[1], (await readJson(req)).text) })
      const thread = /^\/synapse\/api\/threads\/([0-9a-f-]+)$/i.exec(path)
      if (thread !== null && req.method === 'PATCH') return sendJson(res, 200, { thread: await store.updateThread(thread[1], await readJson(req)) })
      if (thread !== null && req.method === 'DELETE') return sendJson(res, 200, await store.removeThread(thread[1]))
      return sendJson(res, 404, { error: '接口不存在' })
    } catch (error) {
      if (error instanceof InputError) return sendJson(res, 400, { error: error.message })
      if (error instanceof NotFoundError) return sendJson(res, 404, { error: error.message })
      ctx.logger.error(error instanceof Error ? error : new Error(String(error)))
      return sendJson(res, 500, { error: 'Synapse 数据暂时不可用' })
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/synapse', handler: (_req, res) => { res.writeHead(302, { location: '/synapse/' }); res.end() } }), 'synapse: redirect')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/synapse/', handler: (_req, res) => { sendFile(res, 'text/html; charset=utf-8', page()) } }), 'synapse: page')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/synapse/app.js', handler: async (_req, res) => { sendFile(res, 'text/javascript; charset=utf-8', await readFile(new URL('./app.js', import.meta.url), 'utf8')) } }), 'synapse: app')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/synapse/styles.css', handler: async (_req, res) => { sendFile(res, 'text/css; charset=utf-8', await readFile(new URL('./styles.css', import.meta.url), 'utf8')) } }), 'synapse: styles')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/synapse/deepseek-mark.svg', handler: async (_req, res) => { sendFile(res, 'image/svg+xml', await readFile(new URL('./deepseek-mark.svg', import.meta.url), 'utf8')) } }), 'synapse: DeepSeek mark')
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/synapse/api', handler: api }), 'synapse: api')
}
