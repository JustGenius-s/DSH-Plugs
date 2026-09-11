import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WorkspaceStore, forkAnchorSeq, forkSeqBoundary, isSessionLabelQuestion, isSubagentSession } from '../index.js'

const userMessage = (seq, text) => ({ type: 'user/message', seq, time: seq * 1000, data: { content: [{ type: 'text', text }] } })
const assistantMessage = (seq, text, turn = 1) => ({ type: 'assistant/message', seq, time: seq * 1000, data: { turn, step: 1, message: { content: [{ type: 'text', text }] } } })
const endSeed = seq => ({ type: 'session/end-seed', seq, time: seq * 1000, data: {} })

test('isSessionLabelQuestion treats generated session names as placeholders', () => {
  assert.equal(isSessionLabelQuestion('当前会话'), true)
  assert.equal(isSessionLabelQuestion('当前会话 分支'), true)
  assert.equal(isSessionLabelQuestion('优化会话地图分支逻辑 分支'), true)
  assert.equal(isSessionLabelQuestion('等待用户提问'), true)
  assert.equal(isSessionLabelQuestion('帮我看一下登录'), false)
  assert.equal(isSessionLabelQuestion('继续'), false)
})

test('isSubagentSession reads origin, depth, or a descriptor event', () => {
  assert.equal(isSubagentSession({ origin: 'subagent' }), true)
  assert.equal(isSubagentSession({ header: { origin: 'subagent' } }), true)
  assert.equal(isSubagentSession({ meta: { origin: 'subagent' } }), true)
  assert.equal(isSubagentSession({ delegationDepth: 1 }), true)
  assert.equal(isSubagentSession({ events: [{ type: 'subagent/descriptor', seq: 0 }] }), true)
  assert.equal(isSubagentSession({ parentId: 'parent', origin: null }), false)
  assert.equal(isSubagentSession({ header: { parentSession: 'parent' } }), false)
  assert.equal(isSubagentSession({ delegationDepth: 0 }), false)
  assert.equal(isSubagentSession(null), false)
})

test('fork backfill skips persisted subagent children', async () => {
  const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
  const scan = source.slice(source.indexOf('async function backfillForks'), source.indexOf('async function readSessionEvents'))
  assert.match(scan, /!isSubagentSession\(header\)/)
  assert.match(scan, /dropProjectedSessions\(leftoverSubagents\)/)
  assert.match(scan, /persistenceListEntries/)
})

test('forkSeqBoundary prefers the persisted seedLength', () => {
  const events = [userMessage(1, 'a'), endSeed(9), userMessage(10, 'b')]
  assert.equal(forkSeqBoundary(events, { seedLength: 70 }), 70)
})

test('forkSeqBoundary prefers inheritedEventCount over a legacy seedLength', () => {
  const events = [userMessage(1, 'a'), endSeed(9), userMessage(10, 'b')]
  assert.equal(forkSeqBoundary(events, { inheritedEventCount: 10, seedLength: 70 }), 10)
  assert.equal(forkSeqBoundary(events, { inheritedEventCount: 8 }), 8)
})

test('forkAnchorSeq uses inheritedEventCount from a live session object', () => {
  assert.equal(forkAnchorSeq([userMessage(1, 'a')], { inheritedEventCount: 8 }), 8)
  assert.equal(forkAnchorSeq(undefined, { inheritedEventCount: 8 }), 8)
})

test('projecting a live-shaped fork reads snapshotEvents and inheritedEventCount', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-livefork-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  const events = [
    userMessage(1, '父问题'),
    assistantMessage(2, '父回答'),
    endSeed(9),
    userMessage(10, '分支自己的问题'),
    assistantMessage(11, '分支自己的回答'),
  ]
  await store.projectSession({
    id: 'fork-live',
    header: { parentSession: 'p', cwd: 'C:\\work\\x' },
    inheritedEventCount: 10,
    snapshotEvents: () => events,
  }, 10)
  await store.flush()
  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  const thread = graph.threads.find(item => item.dshSessionId === 'fork-live')
  assert.equal(thread.sourceSeedLength, 10)
  assert.equal(thread.turns.length, 1)
  assert.equal(thread.turns[0].question, '分支自己的问题')
})

test('forkSeqBoundary falls back to the last session/end-seed marker', () => {
  // seedLength is absent on most real forks; the durable marker is the
  // authoritative fallback, and the LAST one wins.
  const events = [userMessage(1, 'a'), endSeed(4), endSeed(9), userMessage(10, 'b')]
  assert.equal(forkSeqBoundary(events, { parentSession: 'p' }), 10)
  assert.equal(forkSeqBoundary(events, {}), 10)
})

test('forkSeqBoundary reports unknown when there is no seed info', () => {
  // With no seedLength, no marker, and no bootstrap header, projecting from 0
  // would duplicate the parent's history, so this must stay unknown.
  assert.equal(forkSeqBoundary([userMessage(1, 'a')], { parentSession: 'p' }), null)
  assert.equal(forkSeqBoundary([], {}), null)
})

test('forkSeqBoundary uses a session\'s own bootstrap header when the seed is missing', () => {
  // A spawned subagent/child session starts its log from scratch with one of
  // these markers at seq 0, so it holds NO inherited parent history and 0 is a
  // safe boundary. This recovered every remaining fork in a real profile.
  for (const type of ['permission/preset', 'sandbox/mode', 'approval/policy', 'subagent/descriptor']) {
    const events = [{ type, seq: 0, time: 0, data: {} }, userMessage(7, '子会话自己的问题')]
    assert.equal(forkSeqBoundary(events, { parentSession: 'p' }), 0, type)
  }
  // Inherited content first (no bootstrap at seq 0) stays unknown: the log may
  // begin with the parent's turns, which must not be duplicated.
  assert.equal(forkSeqBoundary([userMessage(0, '父问题')], { parentSession: 'p' }), null)
  // A bootstrap marker that is NOT at seq 0 is not proof of an own log.
  assert.equal(forkSeqBoundary([userMessage(0, '父问题'), { type: 'sandbox/mode', seq: 5, time: 5, data: {} }], { parentSession: 'p' }), null)
})

test('forkSeqBoundary ignores a zero seedLength only when negative or non-integer', () => {
  assert.equal(forkSeqBoundary([], { seedLength: 0 }), 0)
  assert.equal(forkSeqBoundary([endSeed(3)], { seedLength: -1 }), 4)
  assert.equal(forkSeqBoundary([endSeed(3)], { seedLength: 'nope' }), 4)
})

test('projecting a fork from its boundary keeps only its own turns', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-forkproj-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  // The parent's history is inherited by the fork's log, but must NOT become
  // the fork's cards: the canvas shows it on the parent node instead.
  const events = [
    userMessage(1, '父问题'),
    assistantMessage(2, '父回答'),
    endSeed(9),
    userMessage(10, '分支自己的问题'),
    assistantMessage(11, '分支自己的回答'),
  ]
  const boundary = forkSeqBoundary(events, { seedLength: 10 })
  await store.projectSession({ id: 'fork-1', header: { parentSession: 'p', seedLength: 10, cwd: 'C:\\work\\x' }, events }, boundary)
  await store.flush()
  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  const thread = graph.threads.find(item => item.dshSessionId === 'fork-1')
  assert.equal(thread.turns.length, 1)
  assert.equal(thread.turns[0].question, '分支自己的问题')
  assert.equal(thread.turns[0].answer, '分支自己的回答')
  assert.equal(thread.turns[0].seq, 10)
  // The inherited parent turn must not have leaked in.
  assert.ok(!thread.turns.some(turn => turn.question === '父问题'))
})

test('projectedSessionIds reports only sessions that already have cards', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-projected-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  assert.deepEqual([...(await store.projectedSessionIds())], [])
  await store.projectSession({
    id: 'has-cards',
    header: { cwd: 'C:\\work\\x' },
    events: [userMessage(1, 'q'), assistantMessage(2, 'a')],
  })
  await store.flush()
  assert.deepEqual([...(await store.projectedSessionIds())], ['has-cards'])
  // A thread known to the canvas but with no cards yet is not "done": the
  // backfill must still try to fill it.
  await store.syncSessions([{ id: 'empty-thread', title: 't', cwd: 'C:\\work\\x', blank: false }])
  await store.flush()
  assert.deepEqual([...(await store.projectedSessionIds())], ['has-cards'])
})

test('the backfill skips sessions the user archived', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-hidden-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  await store.syncSessions([{ id: 'archived-fork', title: 't', cwd: 'C:\\work\\x', blank: false }])
  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  await store.removeThread(graph.threads[0].id)
  // Archiving records the session as hidden, so a later backfill must not
  // resurrect it onto the canvas.
  await store.projectSession({
    id: 'archived-fork',
    header: { parentSession: 'p', seedLength: 0, cwd: 'C:\\work\\x' },
    events: [userMessage(1, 'resurrected?')],
  }, 0)
  await store.flush()
  assert.equal((await store.list()).length, 0)
})

test('forkAnchorSeq stays null when the cut is not durable', () => {
  // A bootstrap-derived boundary of 0 means "this child\'s log starts from
  // scratch", NOT "it forked at parent turn 0". Using it as an anchor would
  // attach the branch under nothing, since parent turns all have seq >= 0.
  const ownLog = [{ type: 'sandbox/mode', seq: 0, time: 0, data: {} }, userMessage(7, 'own')]
  assert.equal(forkSeqBoundary(ownLog, { parentSession: 'p' }), 0)
  assert.equal(forkAnchorSeq(ownLog, { parentSession: 'p' }), null)
})

test('forkAnchorSeq uses the durable seedLength or the end-seed marker', () => {
  assert.equal(forkAnchorSeq([userMessage(1, 'a')], { seedLength: 70 }), 70)
  const events = [userMessage(1, 'a'), endSeed(9), userMessage(10, 'b')]
  assert.equal(forkAnchorSeq(events, { parentSession: 'p' }), 10)
  assert.equal(forkAnchorSeq([userMessage(1, 'a')], { parentSession: 'p' }), null)
  assert.equal(forkAnchorSeq([], {}), null)
})

test('forkAnchorSeq survives a session with no event log', () => {
  // Session.events is a prototype getter, so a session object that is not a
  // live Session reads undefined — and iterating that threw
  // `TypeError: events is not iterable`, which surfaced as a crash on open.
  assert.doesNotThrow(() => forkAnchorSeq(undefined, { parentSession: 'p' }))
  assert.equal(forkAnchorSeq(undefined, { parentSession: 'p' }), null)
  assert.equal(forkAnchorSeq(null, {}), null)
  assert.equal(forkAnchorSeq('not-a-log', {}), null)
  // A durable seedLength still wins even with no log at all.
  assert.equal(forkAnchorSeq(undefined, { seedLength: 42 }), 42)
})

test('a backfilled fork records its anchor so the canvas can attach it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-anchor-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  const events = [userMessage(1, '父问题'), assistantMessage(2, '父回答'), endSeed(9), userMessage(10, '分支问题'), assistantMessage(11, '分支回答')]
  const header = { parentSession: 'p', cwd: 'C:\\work\\x' }
  const boundary = forkSeqBoundary(events, header)
  const anchor = forkAnchorSeq(events, header)
  await store.projectSession({ id: 'fork-a', header, events, seedBoundary: anchor }, boundary)
  await store.flush()
  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  const fork = graph.threads.find(t => t.dshSessionId === 'fork-a')
  // The anchor is what conversationCards reads to connect the branch to the
  // parent turn whose seq sits just below the cut.
  assert.equal(fork.sourceSeedLength, 10)
  assert.equal(fork.turns.length, 1)
  assert.equal(fork.turns[0].question, '分支问题')
})

test('a fork with no durable anchor keeps its cards without inventing lineage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-noanchor-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  const events = [{ type: 'sandbox/mode', seq: 0, time: 0, data: {} }, userMessage(7, 'own'), assistantMessage(8, 'answer')]
  const header = { parentSession: 'p', cwd: 'C:\\work\\x' }
  await store.projectSession({ id: 'fork-b', header, events, seedBoundary: forkAnchorSeq(events, header) }, forkSeqBoundary(events, header))
  await store.flush()
  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  const fork = graph.threads.find(t => t.dshSessionId === 'fork-b')
  // Content is recovered even though the parent turn cannot be determined;
  // the branch simply renders as its own root rather than a broken link.
  assert.equal(fork.sourceSeedLength, null)
  assert.equal(fork.turns.length, 1)
  assert.equal(fork.turns[0].answer, 'answer')
})

test('a just-forked blank session stays on the canvas', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-blankfork-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  // DSH reports a brand-new fork as blank (no events yet). Pruning it made the
  // branch disappear from the map right after the user created it, so the
  // branch could never be watched while it ran.
  await store.syncSessions([
    { id: 'parent', title: '主会话', cwd: 'C:\\work\\x', blank: false },
    { id: 'new-fork', title: '分支', cwd: 'C:\\work\\x', parentId: 'parent', blank: true },
  ])
  let [workspace] = await store.list()
  let graph = await store.get(workspace.id)
  assert.equal(graph.threads.length, 2)
  const fork = graph.threads.find(item => item.dshSessionId === 'new-fork')
  assert.ok(fork !== undefined, 'blank fork must be kept')
  assert.equal(fork.parentId, graph.threads.find(item => item.dshSessionId === 'parent').id)

  // Repeated syncs (the client re-syncs on every list change) must not prune it.
  await store.syncSessions([
    { id: 'parent', title: '主会话', cwd: 'C:\\work\\x', blank: false },
    { id: 'new-fork', title: '分支', cwd: 'C:\\work\\x', parentId: 'parent', blank: true },
  ])
  ;[workspace] = await store.list()
  graph = await store.get(workspace.id)
  assert.equal(graph.threads.length, 2)
})

test('an unrelated blank session is still pruned', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-blankprune-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  // A parentless blank is an untouched new session: it must stay off the map,
  // otherwise every opened-but-unused session would clutter the canvas.
  await store.syncSessions([
    { id: 'used', title: '有内容', cwd: 'C:\\work\\x', blank: false },
    { id: 'untouched', title: '未使用', cwd: 'C:\\work\\x', blank: true },
  ])
  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  assert.equal(graph.threads.length, 1)
  assert.equal(graph.threads[0].dshSessionId, 'used')
})

/** Write a v5 state directly and reload it, so the load-time migrations run. */
async function reloadV5(workspaces) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-anchor-'))
  const dataFile = join(directory, 'state.json')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(dataFile, JSON.stringify({ version: 5, hiddenSessionIds: [], workspaces }))
  const store = new WorkspaceStore(dataFile)
  const [workspace] = await store.list()
  return store.get(workspace.id)
}

const turn = (seq, answerSeq, question = '问题') => ({ seq, at: '2026-01-01T00:00:00.000Z', question, answer: '回答', answerSeq, error: null, processCount: 0, processIds: [] })

test('a branch with no anchor gets one derived from what it inherited', async () => {
  const graph = await reloadV5([{ id: 'w', title: 'w', threads: [
    { id: 'p', parentId: null, dshSessionId: 'sess-p', title: 'p', turns: [turn(9, 681), turn(688, 1329)] },
    // The child continues the parent's numbering, so it copied both turns.
    { id: 'c', parentId: 'p', sourceParentSessionId: 'sess-p', dshSessionId: 'sess-c', title: 'c', sourceSeedLength: null, turns: [turn(2000, 2100)] },
  ] }])
  const child = graph.threads.find(thread => thread.id === 'c')
  assert.equal(child.anchorCardId, 'p:turn:688', 'the branch point is the last turn it inherited')
  assert.equal(child.sourceAnchorSeq, 1329)
})

test('a branch whose child re-counts from its own origin is not given a false anchor', async () => {
  const graph = await reloadV5([{ id: 'w', title: 'w', threads: [
    { id: 'p', parentId: null, dshSessionId: 'sess-p', title: 'p', turns: [turn(9, 681), turn(688, 1329)] },
    // seq 7 is below the parent's first turn, so these numbers are unrelated.
    // Inventing an anchor here would point at a turn the branch never saw.
    { id: 'c', parentId: 'p', sourceParentSessionId: 'sess-p', dshSessionId: 'sess-c', title: 'c', sourceSeedLength: 0, turns: [turn(7, 739)] },
  ] }])
  const child = graph.threads.find(thread => thread.id === 'c')
  assert.equal(child.anchorCardId, undefined)
})

test('an existing branch anchor is never overwritten', async () => {
  const graph = await reloadV5([{ id: 'w', title: 'w', threads: [
    { id: 'p', parentId: null, dshSessionId: 'sess-p', title: 'p', turns: [turn(9, 681), turn(688, 1329)] },
    { id: 'c', parentId: 'p', sourceParentSessionId: 'sess-p', dshSessionId: 'sess-c', title: 'c', sourceSeedLength: null, anchorCardId: 'p:turn:9', turns: [turn(2000, 2100)] },
  ] }])
  const child = graph.threads.find(thread => thread.id === 'c')
  assert.equal(child.anchorCardId, 'p:turn:9', 'the recorded branch point wins')
})

test('a branch with no parent or no turns is left alone', async () => {
  const graph = await reloadV5([{ id: 'w', title: 'w', threads: [
    { id: 'c', parentId: 'missing-parent', sourceParentSessionId: 'sess-p', dshSessionId: 'sess-c', title: 'c', turns: [turn(9, 681)] },
    { id: 'empty', parentId: 'c', sourceParentSessionId: 'sess-c', dshSessionId: 'sess-e', title: 'e', turns: [] },
  ] }])
  assert.equal(graph.threads.find(thread => thread.id === 'c').anchorCardId, undefined)
  assert.equal(graph.threads.find(thread => thread.id === 'empty').anchorCardId, undefined)
})

test('creating a branch persists the anchor the browser supplies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-branchpost-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  await store.create('w')
  const [workspace] = await store.list()
  const parent = await store.createThread(workspace.id, { title: 'p', dshSessionId: 'sess-p' })
  const child = await store.branch(parent.id, { title: 'c', dshSessionId: 'sess-c', anchorCardId: 'p:turn:42', sourceAnchorSeq: 99 })
  assert.equal(child.anchorCardId, 'p:turn:42')
  assert.equal(child.sourceAnchorSeq, 99)
  assert.equal(child.sourceParentSessionId, 'sess-p')
})

test('a branch created without an anchor has none', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-branchplain-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  await store.create('w')
  const [workspace] = await store.list()
  const parent = await store.createThread(workspace.id, { title: 'p' })
  const child = await store.branch(parent.id, { title: 'c', dshSessionId: 'sess-c' })
  assert.equal(child.anchorCardId, undefined)
  assert.equal(child.sourceAnchorSeq, undefined)
})
