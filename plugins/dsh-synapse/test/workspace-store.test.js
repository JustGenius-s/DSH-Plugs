import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WorkspaceStore } from '../index.js'

test('persists a workspace, a DSH-linked thread, and a message', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-'))
  const dataFile = join(directory, 'state.json')
  const store = new WorkspaceStore(dataFile)
  const workspace = await store.create('调研 DSH 插件')
  const thread = await store.createThread(workspace.id, { title: 'DSH 会话', dshSessionId: 'session-1' })
  await store.addMessage(thread.id, '确定使用已有 Web Server')

  const saved = await new WorkspaceStore(dataFile).get(workspace.id)
  assert.equal(saved.title, '调研 DSH 插件')
  assert.equal(saved.threads[0].dshSessionId, 'session-1')
  assert.equal(saved.threads[0].turns[0].question, '确定使用已有 Web Server')
  assert.match(await readFile(dataFile, 'utf8'), /"version": ?5/)
})

test('projects committed DSH events once, folds tool process into the assistant card, and keeps fork lineage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-projection-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  const parent = {
    id: 'session-parent', header: {}, firstLiveSeq: 0,
    events: [
      { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: '分析登录异常' }] } },
      { type: 'assistant/message', seq: 1, time: 2, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '我来检查。' }] } } },
      { type: 'tool/call', seq: 2, time: 3, data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"cmd":"pnpm test"}' } },
      { type: 'tool/result', seq: 3, time: 4, data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'text', text: 'ok' }] } } },
    ],
  }
  await store.projectSession(parent)
  await store.projectEvent(parent, parent.events[2])
  const child = { id: 'session-child', header: { parentSession: 'session-parent' }, firstLiveSeq: 4, events: [] }
  await store.projectSession(child, child.firstLiveSeq)

  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  const parentThread = graph.threads.find(thread => thread.dshSessionId === 'session-parent')
  const childThread = graph.threads.find(thread => thread.dshSessionId === 'session-child')
  assert.equal(workspace.title, 'DSH 任务')
  // v5 stores one card per turn, not a copy of the message log.
  assert.equal(parentThread.turns.length, 1)
  assert.equal(parentThread.turns[0].question, '分析登录异常')
  assert.equal(parentThread.turns[0].answer, '我来检查。')
  assert.equal(parentThread.turns[0].answerSeq, 1)
  // The tool call and its result pair by callId into one counted invocation.
  assert.equal(parentThread.turns[0].processCount, 1)
  assert.deepEqual(parentThread.turns[0].processIds, ['c1'])
  assert.equal(childThread.parentId, parentThread.id)
})

test('projects a batch of session events in a single write', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-batch-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  const session = {
    id: 'session-batch', header: { meta: { cwd: 'C:\\work\\batch' } }, firstLiveSeq: 0,
    events: [
      { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: '批量问题' }] } },
      { type: 'assistant/message', seq: 1, time: 2, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '批量回答' }] } } },
      { type: 'tool/call', seq: 2, time: 3, data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' } },
      { type: 'tool/result', seq: 3, time: 4, data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'text', text: 'ok' }] } } },
    ],
  }
  await store.projectEvents(session, session.events)
  await store.flush()
  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  const thread = graph.threads[0]
  assert.equal(thread.turns.length, 1)
  assert.equal(thread.turns[0].question, '批量问题')
  assert.equal(thread.turns[0].answer, '批量回答')
  assert.equal(thread.turns[0].processCount, 1)
  assert.deepEqual(thread.turns[0].processIds, ['c1'])
})

test('upgrades a newly written v4 file to v5 on the next load', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-upgrade-'))
  const dataFile = join(directory, 'state.json')
  const store = new WorkspaceStore(dataFile)
  await store.projectEvents(
    { id: 's1', header: { meta: { cwd: 'C:\\work\\x' } }, firstLiveSeq: 0 },
    [{ type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: '问' }] } }],
  )
  await store.flush()
  // A fresh file is stamped with the current version, so the v5 rewrite is
  // applied on the next load rather than during the very first save.
  await new WorkspaceStore(dataFile).ready
  assert.match(await readFile(dataFile, 'utf8'), /"version": ?5/)
})

test('retains a tool failure and exposes a failed turn without assistant text', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-error-projection-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  await store.projectSession({
    id: 'session-error', header: { meta: { cwd: 'C:\\work\\errors' } }, firstLiveSeq: 0,
    events: [
      { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: '搜索竞品' }] } },
      { type: 'tool/call', seq: 2, time: 2, data: { turn: 7, step: 1, callId: 'search-1', name: 'web_search', arguments: '{"query":"竞品"}' } },
      { type: 'tool/result', seq: 3, time: 3, data: { turn: 7, step: 1, error: { name: 'QuotaExceeded', code: 'INSUFFICIENT_BALANCE', message: '余额不足' }, message: { source: { kind: 'tool', callId: 'search-1' }, content: [] } } },
      { type: 'turn/end', seq: 4, time: 4, data: { turn: 7, step: 1, reason: { kind: 'error', error: { name: 'QuotaExceeded', code: 'INSUFFICIENT_BALANCE', message: '余额不足' } } } },
    ],
  })

  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  const turn = graph.threads[0].turns[0]
  assert.equal(turn.question, '搜索竞品')
  assert.equal(turn.error, 'QuotaExceeded: INSUFFICIENT_BALANCE: 余额不足')
  assert.equal(turn.answer, null)
  assert.equal(turn.processCount, 1)
  assert.deepEqual(turn.processIds, ['search-1'])
})

test('migrates v3 tool cards into the assistant process records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-migrate-'))
  const dataFile = join(directory, 'state.json')
  await writeFile(dataFile, JSON.stringify({
    version: 3,
    hiddenSessionIds: [],
    workspaces: [{
      id: 'w-1', kind: 'dsh', cwd: 'C:\\work\\migrate', title: 'migrate',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      threads: [{
        id: 't-1', title: '会话', parentId: null, dshSessionId: 's-1', dshSessionTitle: null,
        color: '#0f766e', position: { x: 86, y: 82 }, sourceSeedLength: null,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        messages: [
          { id: 'm-1', kind: 'user', text: '帮我检查', at: '2026-01-01T00:00:00.000Z' },
          { id: 'm-2', kind: 'assistant', text: '好的。', at: '2026-01-01T00:00:00.100Z' },
          { id: 'm-3', kind: 'tool', text: 'read\n{"file_path":"a.js"}', at: '2026-01-01T00:00:00.200Z' },
          { id: 'm-4', kind: 'tool-result', text: 'file content', at: '2026-01-01T00:00:00.300Z' },
          { id: 'm-5', kind: 'tool', text: 'bash\n{"cmd":"pwd"}', at: '2026-01-01T00:00:00.400Z' },
        ],
      }],
    }],
  }, null, 2))
  const store = new WorkspaceStore(dataFile)
  const graph = await store.get('w-1')
  const thread = graph.threads[0]
  // The v3 tool cards fold into their assistant turn as a tool count.
  assert.equal(thread.turns.length, 1)
  assert.equal(thread.turns[0].question, '帮我检查')
  assert.equal(thread.turns[0].answer, '好的。')
  assert.equal(thread.turns[0].processCount, 2)
  assert.equal(thread.messages, undefined)
  assert.match(await readFile(dataFile, 'utf8'), /"version": ?5/)
})

test('does not persist the DSH runtime context as a user conversation turn', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-runtime-context-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  await store.projectSession({
    id: 'runtime-context', header: { meta: { cwd: 'C:\\work\\canvas' } }, firstLiveSeq: 0,
    events: [
      { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: '你好' }] } },
      { type: 'user/message', seq: 2, time: 2, data: { content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\\nPolicy.' }] } },
      { type: 'assistant/message', seq: 3, time: 3, data: { message: { content: [{ type: 'text', text: '你好，我是助手。' }] } } },
    ],
  })

  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  assert.deepEqual(graph.threads[0].turns.map(turn => turn.question), ['你好'])
  assert.equal(graph.threads[0].turns[0].answer, '你好，我是助手。')
})

test('merges a browser fork callback with an already projected DSH fork', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-fork-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  const parent = { id: 'parent', header: {}, firstLiveSeq: 0, events: [] }
  const child = { id: 'child', header: { parentSession: 'parent' }, firstLiveSeq: 0, events: [] }
  const parentThread = await store.projectSession(parent)
  await store.projectSession(child, child.firstLiveSeq)
  const merged = await store.branch(parentThread.id, { title: '替代方案', dshSessionId: 'child', dshSessionTitle: '替代方案' })
  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  assert.equal(graph.threads.length, 2)
  assert.equal(merged.dshSessionId, 'child')
  assert.equal(merged.parentId, parentThread.id)
})

test('groups DSH sessions by their working directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-cwd-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  await store.projectSession({ id: 'alpha', header: { meta: { cwd: 'C:\\work\\alpha' } }, firstLiveSeq: 0, events: [] })
  await store.projectSession({ id: 'beta', header: { meta: { cwd: 'C:\\work\\beta' } }, firstLiveSeq: 0, events: [] })
  const workspaces = await store.list()
  assert.equal(workspaces.length, 2)
  assert.deepEqual(new Set(workspaces.map(workspace => workspace.cwd)), new Set(['C:\\work\\alpha', 'C:\\work\\beta']))
})

test('syncs non-blank DSH sessions into the matching canvas', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-sync-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  await store.syncSessions([
    { id: 'blank', title: '空会话', cwd: 'C:\\work\\canvas', blank: true },
    { id: 'parent', title: '主问题', cwd: 'C:\\work\\canvas', blank: false },
    { id: 'child', title: '替代路线', cwd: 'C:\\work\\canvas', parentId: 'parent', blank: false },
  ])
  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  const parent = graph.threads.find(thread => thread.dshSessionId === 'parent')
  const child = graph.threads.find(thread => thread.dshSessionId === 'child')
  assert.equal(graph.threads.length, 2)
  assert.equal(parent.title, '主问题')
  assert.equal(child.parentId, parent.id)
})

test('keeps DSH projection coordinates neutral instead of stacking by historical session count', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-neutral-position-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  await store.syncSessions([
    { id: 'first', title: '第一条', cwd: 'C:\\work\\canvas', blank: false },
    { id: 'second', title: '第二条', cwd: 'C:\\work\\canvas', blank: false },
  ])
  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)

  assert.deepEqual(graph.threads.map(thread => thread.position), [{ x: 86, y: 82 }, { x: 86, y: 82 }])
})

test('removes the canvas node when DSH removes the session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-removed-session-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  await store.syncSessions([{ id: 'removed', title: '将被归档', cwd: 'C:\\work\\canvas', blank: false }])
  await store.syncSessions([], ['removed'])
  assert.equal((await store.list()).length, 0)
})

test('removing a DSH node prevents replay from restoring it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-remove-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  const session = { id: 'remove-me', header: { meta: { cwd: 'C:\\work\\remove' } }, firstLiveSeq: 0, events: [] }
  const thread = await store.projectSession(session)
  await store.removeThread(thread.id)
  await store.projectSession(session)
  assert.equal((await store.list()).length, 0)
})

test('archived canvas nodes stay hidden during a later DSH session sync', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-archive-sync-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  const session = { id: 'archived', title: '已归档', cwd: 'C:\\work\\archive', blank: false }
  await store.syncSessions([session])
  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  await store.removeThread(graph.threads[0].id)
  await store.syncSessions([session])
  assert.equal((await store.list()).length, 0)
})

test('does not rewrite an up-to-date v5 file on load', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-idempotent-'))
  const dataFile = join(directory, 'state.json')
  const state = {
    version: 5,
    hiddenSessionIds: [],
    workspaces: [{
      id: 'w-1', kind: 'dsh', cwd: 'C:\\work\\x', title: 'x',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      threads: [{
        id: 't-1', title: 's', parentId: null, dshSessionId: 's-1', dshSessionTitle: null,
        color: '#0f766e', position: { x: 86, y: 82 }, sourceSeedLength: null,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        turns: [{ seq: 1, at: '2026-01-01T00:00:00.000Z', question: 'q', answer: 'hi', answerSeq: 2, error: null, processCount: 0, processIds: [] }],
        processIds: [],
      }],
    }],
  }
  await writeFile(dataFile, JSON.stringify(state))
  const before = (await stat(dataFile)).mtimeMs
  await new Promise(resolve => setTimeout(resolve, 80))
  await new WorkspaceStore(dataFile).ready
  const after = (await stat(dataFile)).mtimeMs
  assert.equal(after, before)
})

test('coalesces deferred projection saves into one write', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-debounce-'))
  const dataFile = join(directory, 'state.json')
  const store = new WorkspaceStore(dataFile)
  const session = { id: 's1', header: { meta: { cwd: 'C:\\work\\x' } }, firstLiveSeq: 0 }
  // Two deferred projections land inside one debounce window: no disk write yet.
  await store.projectEvents(session, [{ type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: 'a' }] } }])
  await store.projectEvents(session, [{ type: 'assistant/message', seq: 2, time: 2, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'b' }] } } }])
  const before = (await stat(dataFile)).mtimeMs
  await new Promise(resolve => setTimeout(resolve, 60))
  const mid = (await stat(dataFile)).mtimeMs
  assert.equal(mid, before)
  // A manual flush persists the coalesced state in one save.
  await store.flush()
  const after = (await stat(dataFile)).mtimeMs
  assert.notEqual(after, before)
  const parsed = JSON.parse(await readFile(dataFile, 'utf8'))
  // Both deferred projections coalesce into one turn card in one write.
  assert.equal(parsed.workspaces[0].threads[0].turns.length, 1)
  assert.equal(parsed.workspaces[0].threads[0].turns[0].answer, 'b')
})

test('caps long card text instead of storing the whole reply', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-truncate-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  const session = { id: 's1', header: { meta: { cwd: 'C:\\work\\x' } }, firstLiveSeq: 0 }
  await store.projectEvents(session, [
    { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: '问' }] } },
    { type: 'assistant/message', seq: 2, time: 2, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'y'.repeat(9_000) }] } } },
  ])
  await store.flush()
  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  const turn = graph.threads[0].turns[0]
  // The card keeps a display-sized prefix; the rest stays in the DSH log and
  // is re-read when the detail view opens.
  assert.equal(turn.answer.length, 2_400 + '…'.length)
  assert.ok(turn.answer.endsWith('…'))
  assert.equal(turn.answerSeq, 2)
})

test('v5 migration drops the message log and keeps only card summaries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-v5-'))
  const dataFile = join(directory, 'state.json')
  await writeFile(dataFile, JSON.stringify({
    version: 4,
    hiddenSessionIds: [],
    workspaces: [{
      id: 'w-1', kind: 'dsh', cwd: 'C:\\work\\x', title: 'x',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      threads: [{
        id: 't-1', title: '会话', parentId: null, dshSessionId: 's-1', dshSessionTitle: null,
        color: '#0f766e', position: { x: 86, y: 82 }, sourceSeedLength: null,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        messages: [
          { id: 'm-1', kind: 'user', text: '第一问', sourceSeq: 1, at: '2026-01-01T00:00:00.000Z' },
          { id: 'm-2', kind: 'assistant', text: '第一答', sourceSeq: 2, at: '2026-01-01T00:00:00.100Z', process: [{ callId: 'c1', name: 'bash' }] },
          // A mid-turn assistant step must not become a second card.
          { id: 'm-3', kind: 'assistant', text: '第二答', sourceSeq: 3, at: '2026-01-01T00:00:00.200Z', process: [] },
          { id: 'm-4', kind: 'user', text: '第二问', sourceSeq: 4, at: '2026-01-01T00:00:01.000Z' },
        ],
      }],
    }],
  }))
  const store = new WorkspaceStore(dataFile)
  const graph = await store.get('w-1')
  const thread = graph.threads[0]
  assert.equal(thread.messages, undefined)
  assert.equal(thread.turns.length, 2)
  assert.deepEqual(thread.turns.map(turn => turn.question), ['第一问', '第二问'])
  // The turn's final assistant step wins as the card answer.
  assert.equal(thread.turns[0].answer, '第二答')
  assert.equal(thread.turns[0].answerSeq, 3)
  assert.equal(thread.turns[0].processCount, 1)
  assert.deepEqual(thread.turns[0].processIds, ['c1'])
  assert.equal(thread.turns[1].answer, null)
  assert.match(await readFile(dataFile, 'utf8'), /"version": ?5/)
})

test('v5 does not store tool output text in the canvas metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-v5-tools-'))
  const dataFile = join(directory, 'state.json')
  const store = new WorkspaceStore(dataFile)
  await store.projectSession({
    id: 's-big', header: { meta: { cwd: 'C:\\work\\big' } }, firstLiveSeq: 0,
    events: [
      { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: '跑测试' }] } },
      { type: 'assistant/message', seq: 1, time: 2, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '好' }] } } },
      { type: 'tool/call', seq: 2, time: 3, data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"cmd":"pnpm test"}' } },
      // 50KB of tool output must never reach workspaces.json.
      { type: 'tool/result', seq: 3, time: 4, data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'text', text: 'x'.repeat(50_000) }] } } },
    ],
  })
  await store.flush()
  const saved = await readFile(dataFile, 'utf8')
  assert.ok(!saved.includes('x'.repeat(1_000)), 'tool output text must not be persisted')
  assert.equal((await store.get((await store.list())[0].id)).threads[0].turns[0].processCount, 1)
})

test('a duplicate tool event is counted once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-v5-dedupe-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  const session = { id: 's1', header: { meta: { cwd: 'C:\\work\\x' } }, firstLiveSeq: 0 }
  const call = { type: 'tool/call', seq: 2, time: 3, data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' } }
  await store.projectEvents(session, [
    { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: 'q' }] } },
    { type: 'assistant/message', seq: 1, time: 2, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'a' }] } } },
    call,
    { ...call, seq: 4, time: 5 },
  ])
  await store.flush()
  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  assert.equal(graph.threads[0].turns[0].processCount, 1)
})
