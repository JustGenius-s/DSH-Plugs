import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

export const name = 'synapse'
// `sessionPersistence` is resolved lazily via `ctx.get`: it is only needed to
// read the full detail of a card whose DSH session is no longer live (archived
// or not yet restored). Listing it as a hard dependency would stop the plugin
// from loading on a profile that does not mount it, so it stays optional.
export const inject = ['webServer', 'sessions']

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
        if (typeof item.title === 'string' && item.title.trim() !== '') {
          thread.title = item.title.slice(0, MAX_TITLE_LENGTH)
          thread.dshSessionTitle = thread.title
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

  /** Replay one live DSH session into the dedicated projection workspace. */
  async projectSession(session, replayFrom = 0, workspaceTitle = 'DSH 任务') {
    return this.mutate(() => {
      if (this.state.hiddenSessionIds.includes(session.id)) return null
      const workspace = this.dshWorkspace(sessionCwd(session), workspaceTitle)
      const thread = this.dshThread(workspace, session)
      for (const event of session.events) {
        if (event.seq >= replayFrom) this.projectEventInto(workspace, thread, event)
      }
      return structuredClone(thread)
    }, { deferred: true })
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

  async mutate(action, { deferred = false } = {}) {
    await this.ready
    const task = this.serial.then(async () => {
      const result = action()
      if (deferred) this.markDirty()
      else await this.save()
      return result
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
      if (typeof session.title === 'string' && session.title.trim() !== '') {
        const title = session.title.slice(0, MAX_TITLE_LENGTH)
        thread.title = title
        thread.dshSessionTitle = title
      }
      // The fork cut is DSH's durable `header.seedLength`, but that field is
      // missing on most real forks; `session.seedBoundary` carries the boundary
      // resolved from the log itself (see `forkSeqBoundary`). Keeping it lets
      // the canvas attach this branch under the exact parent turn instead of
      // leaving it floating as a root. Keep the value even after the session
      // has been restored, when its in-process `firstLiveSeq` moves.
      const seedLength = session.header?.seedLength ?? session.seedBoundary
      if (Number.isSafeInteger(seedLength) && seedLength >= 0) thread.sourceSeedLength = seedLength
      return thread
    }
    const parentSessionId = typeof session.header?.parentSession === 'string' ? session.header.parentSession : null
    const parent = parentSessionId === null ? undefined : workspace.threads.find(item => item.dshSessionId === parentSessionId)
    const siblings = workspace.threads.filter(item => item.sourceParentSessionId === parentSessionId)
    const now = new Date().toISOString()
    thread = {
      id: randomUUID(),
      title: typeof session.title === 'string' && session.title.trim() !== '' ? session.title.slice(0, MAX_TITLE_LENGTH) : (parent === undefined ? 'DSH 会话' : `${parent.title} 分支`),
      parentId: parent?.id ?? null,
      sourceParentSessionId: parentSessionId,
      sourceSeedLength: Number.isSafeInteger(session.header?.seedLength ?? session.seedBoundary) && (session.header?.seedLength ?? session.seedBoundary) >= 0 ? (session.header?.seedLength ?? session.seedBoundary) : null,
      dshSessionId: session.id,
      dshSessionTitle: typeof session.title === 'string' ? session.title.slice(0, MAX_TITLE_LENGTH) : null,
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
    if (event.type === 'session/title' && typeof event.data?.title === 'string') {
      thread.title = event.data.title.slice(0, MAX_TITLE_LENGTH)
      thread.dshSessionTitle = thread.title
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
      thread.turns.push({
        seq: event.seq,
        at,
        question: cardText(projection.text, CARD_QUESTION_LENGTH),
        answer: null,
        answerSeq: null,
        error: null,
        processCount: 0,
        processIds: [],
      })
      if (thread.dshSessionTitle === null) {
        thread.title = titleFromText(projection.text)
        thread.dshSessionTitle = thread.title
      }
    } else {
      const turn = thread.turns.at(-1) ?? this.appendPlaceholderTurn(thread, at)
      turn.processCount += process.length
      turn.processIds.push(...process.map(entry => entry.callId))
      if (projection.kind === 'error') turn.error = cardText(projection.text, CARD_ANSWER_LENGTH)
      // A turn's final assistant reply is the card's answer. Replace so a
      // later step (or a retry after an error) supersedes the earlier one.
      else {
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
      question: thread.dshSessionTitle ?? thread.title ?? '会话',
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
    return { id: workspace.id, kind: workspace.kind ?? 'manual', cwd: workspace.cwd ?? null, title: workspace.title, createdAt: workspace.createdAt, updatedAt: workspace.updatedAt, threadCount: workspace.threads.length }
  }
}

class InputError extends Error {}
class NotFoundError extends Error {}

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
  return { state, migrated }
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
          turns.push({
            seq: Number.isSafeInteger(message.sourceSeq) ? message.sourceSeq : null,
            at: typeof message.at === 'string' ? message.at : thread.updatedAt,
            question: cardText(message.text, CARD_QUESTION_LENGTH),
            answer: null,
            answerSeq: null,
            error: null,
            processCount: 0,
            processIds: [],
          })
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
            question: thread.dshSessionTitle ?? thread.title ?? '会话',
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
      const text = contentText(event.data.content)
      return isRuntimeContextText(text) ? null : noteProjection('user', text)
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
 * absent (84% of forks in one real profile). Two fallbacks cover it, in order:
 *
 * 1. the durable `session/end-seed` marker event — per the session contract,
 *    readers of STORED history must locate the LAST such event rather than
 *    trust the in-process `firstLiveSeq`;
 * 2. a log that opens with a session's own bootstrap marker at seq 0, which
 *    means it holds no inherited history, so 0 is a safe boundary.
 *
 * @returns the seq to project from, or `null` when the boundary is unknown.
 */
export function forkSeqBoundary(events, header) {
  if (Number.isSafeInteger(header?.seedLength) && header.seedLength >= 0) return header.seedLength
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
 * Only a durable `seedLength` or an `end-seed` marker identifies the cut.
 */
export function forkAnchorSeq(events, header) {
  if (Number.isSafeInteger(header?.seedLength) && header.seedLength >= 0) return header.seedLength
  let boundary = null
  for (const event of events) if (event?.type === 'session/end-seed') boundary = event.seq + 1
  return boundary
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
  let persistence
  try {
    persistence = typeof ctx.get === 'function' ? ctx.get('sessionPersistence') : ctx.sessionPersistence
  } catch {
    return
  }
  if (persistence === undefined || persistence === null || typeof persistence.list !== 'function') return
  let headers
  try {
    headers = await persistence.list()
  } catch {
    return
  }
  if (!Array.isArray(headers)) return
  const alreadyProjected = await store.projectedSessionIds()
  const queue = headers.filter(header =>
    typeof header?.parentSession === 'string'
    && typeof header?.id === 'string'
    && !alreadyProjected.has(header.id))
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
      const anchor = forkAnchorSeq(events, full)
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
  // store may reject an id it cannot brand. Either way the detail view should
  // show the card summary — not fail the request.
  let live
  try {
    live = ctx.sessions.get(sessionId)
  } catch {
    live = undefined
  }
  if (live !== undefined) return live.events
  // `ctx.sessionPersistence` is NOT declared in `inject`, so touching it
  // directly makes cordis throw `cannot get property ... without inject`
  // (its Context proxy rejects undeclared services) — that throw used to
  // escape into the route's catch and surface as a 500. Resolve it through
  // `ctx.get`, the safe accessor, and guard the whole lookup anyway.
  let persistence
  try {
    persistence = typeof ctx.get === 'function' ? ctx.get('sessionPersistence') : ctx.sessionPersistence
  } catch {
    return null
  }
  if (persistence === undefined || persistence === null || typeof persistence.inspect !== 'function') return null
  try {
    const inspection = await persistence.inspect(sessionId)
    return Array.isArray(inspection?.events) ? inspection.events : null
  } catch {
    // A session whose log was deleted or is still being written has no detail
    // to show; the card summary still renders.
    return null
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
export function buildTurnDetail(events, turnSeq) {
  if (!Array.isArray(events)) return { question: null, steps: [], process: [] }
  const ordered = [...events].sort((left, right) => left.seq - right.seq)
  // Only a REAL user question opens a turn. DSH emits runtime-context
  // snapshots and <system-reminder> blocks as user-role messages too; the
  // card projection already skips them, so the detail view must slice on the
  // same rule or those blocks would split one turn into several.
  const isTurnStart = event => event.type === 'user/message' && !isRuntimeContextText(contentText(event.data?.content))
  let start = ordered.findIndex(event => event.seq === turnSeq && isTurnStart(event))
  if (start === -1) {
    // Fall back to the nth real turn when the durable seq is unavailable
    // (legacy data, or a turn discovered before its event was committed).
    start = ordered.findIndex(isTurnStart)
  }
  if (start === -1) return { question: null, steps: [], process: [] }
  const end = ordered.findIndex((event, index) => index > start && isTurnStart(event))
  const slice = ordered.slice(start, end === -1 ? undefined : end)
  const questionText = contentText(ordered[start].data?.content)
  const question = questionText.trim() === '' ? null : questionText
  const steps = []
  const process = []
  for (const event of slice.slice(1)) {
    if (event.type === 'assistant/message' || event.type === 'todo/write') {
      const text = event.type === 'todo/write'
        ? (Array.isArray(event.data?.todos) ? event.data.todos.map(todo => `[${todo.status}] ${todo.content}`).join('\n') : '')
        : contentText(event.data?.message?.content)
      if (text.trim() === '') continue
      steps.push({ kind: 'assistant', seq: event.seq, at: new Date(event.time).toISOString(), text })
      continue
    }
    if (event.type === 'turn/end' && event.data?.reason?.kind === 'error') {
      const text = errorText(event.data.reason.error) ?? '本轮执行失败'
      steps.push({ kind: 'error', seq: event.seq, at: new Date(event.time).toISOString(), text })
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
        continue
      }
      process.push({
        callId,
        name: typeof data.name === 'string' ? data.name : '工具调用',
        arguments: typeof data.arguments === 'string' ? data.arguments : '',
        result: null,
        error: null,
      })
      continue
    }
    if (entry === undefined) {
      // A result whose call was never seen (or arrived out of order) still
      // shows its output instead of being dropped.
      process.push({ callId, name: '工具结果', arguments: '', result: contentText(data.message?.content), error: errorText(data.error) })
      continue
    }
    entry.result = contentText(data.message?.content)
    entry.error = errorText(data.error)
  }
  return { question, steps, process }
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

function isRuntimeContextText(text) {
  if (typeof text !== 'string') return false
  const trimmed = text.trimStart()
  // DSH emits several kinds of injected context as user-role messages: the
  // runtime-context snapshot and <system-reminder> blocks. None of them is a
  // real user turn, so they must not become their own conversation card.
  if (trimmed.startsWith('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.')) return true
  return /^<(system-reminder|system|context|environment|reminder)\b[^>]*>/i.test(trimmed)
}

function isRuntimeContextMessage(message) {
  return message?.kind === 'user' && isRuntimeContextText(message.text)
}

function contentText(content) {
  if (!Array.isArray(content)) return ''
  return content.flatMap(block => {
    if (block?.type === 'text') return [block.text]
    if (block?.type === 'tool-call') return [block.name, block.arguments]
    if (block?.type === 'tool-result') return contentText(block.content)
    return []
  }).filter(value => typeof value === 'string' && value.trim() !== '').join('\n')
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
    const parentSession = session.header?.parentSession
    const replayFrom = parentSession === undefined
      ? 0
      : (forkSeqBoundary(session.events, session.header) ?? session.firstLiveSeq ?? 0)
    void store.projectSession(
      { ...session, seedBoundary: parentSession === undefined ? undefined : forkAnchorSeq(session.events, session.header) },
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
  const api = async (req, res) => {
    try {
      const hostname = (typeof req.headers.host === 'string' ? req.headers.host : '').replace(/:\d+$/, '').toLowerCase()
      if (!trustedHosts.has(hostname)) return sendJson(res, 403, { error: '不被信任的 Host' })
      const path = new URL(req.url ?? '/', 'http://dsh.local').pathname
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
      if (path === '/synapse/api/sessions/sync' && req.method === 'POST') { const body = await readJson(req); return sendJson(res, 200, { workspaces: await store.syncSessions(body.sessions, body.removedSessionIds) }) }
      // Detail on demand: the canvas stores only card summaries, so the full
      // turn (every assistant step plus tool arguments and outputs) is read
      // back from the DSH session when the user opens it. Live sessions are
      // read from memory; archived/cold ones come from persistence, so the
      // detail view works for every card on the map, not just the current one.
      if (path === '/synapse/api/turn-detail' && req.method === 'POST') {
        const body = await readJson(req)
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
        const events = await readSessionEvents(ctx, sessionId)
        if (events === null) return sendJson(res, 404, { error: '会话已不可用' })
        return sendJson(res, 200, { detail: buildTurnDetail(events, Number.isSafeInteger(body.seq) ? body.seq : null) })
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
