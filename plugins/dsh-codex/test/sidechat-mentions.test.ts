import { describe, expect, it, vi } from 'vitest'
import { filterReferenceCandidates, insertSessionMention, mentionKeyAction, mentionQuery, moveMentionSelection } from '../src/client/features/side-chat/mentions'
import { REFERENCE_ACTIVE_WINDOW_MS, workspaceReferenceCandidates, type ReferenceSessionList, type ReferenceSessionSummary } from '../src/host/side-chat/references'
import { sideChatPromptContent } from '../src/client/features/side-chat/connection'
import { formatSessionReferenceMention } from '@just-genius/dsh-plugin-runtime/host'

const NOW = Date.UTC(2026, 8, 19, 4)
const DAY = 24 * 60 * 60 * 1000

function sessionList(items: readonly ReferenceSessionSummary[]): ReferenceSessionList {
  return { list: async () => ({ items }) }
}

describe('side chat reference discovery', () => {
  it('puts all recent same-workspace sessions first, followed by other workspaces', async () => {
    const rows = [
      { sessionId: 'parent', label: 'Parent', cwd: '/work' },
      { sessionId: 'side', label: 'Self', cwd: '/work' },
      { sessionId: 'outside', label: 'Other', cwd: '/other' },
      { sessionId: 'nested', label: 'Nested project', cwd: '/work/nested' },
      { sessionId: 'unknown', label: 'No cwd' },
      ...Array.from({ length: 120 }, (_, i) => ({ sessionId: `s-${i}`, label: `Session ${i}`, cwd: '/work' })),
    ]
    const listCandidates = vi.fn(async () => rows)
    const agent = { id: 'side', session: { header: { cwd: '/work' } } }
    const sessions = sessionList(rows.map(row => ({
      sessionId: row.sessionId,
      cwd: row.cwd,
      updatedAt: row.cwd === '/work' ? NOW - DAY : NOW,
    })))
    const found = await workspaceReferenceCandidates({ listCandidates }, agent, '/work', sessions, NOW)
    expect(found).toHaveLength(124)
    expect(found.slice(0, 121).every(row => row.sameWorkspace)).toBe(true)
    expect(found.slice(121).every(row => !row.sameWorkspace)).toBe(true)
    expect(found.map(row => row.sessionId)).toContain('parent')
    expect(found.map(row => row.sessionId)).toContain('s-119')
    expect(found.map(row => row.sessionId)).not.toContain('side')
    expect(found.map(row => row.sessionId)).toContain('outside')
    expect(found.map(row => row.sessionId)).toContain('nested')
    expect(listCandidates).toHaveBeenCalledExactlyOnceWith(agent, '', Number.MAX_SAFE_INTEGER)
  })

  it('orders each group by activity using the parent workspace, not the side agent cwd', async () => {
    const rows = [
      { sessionId: 'local-old', label: 'Local old', cwd: '/work', updatedAt: NOW - 2 * DAY },
      { sessionId: 'other-new', label: 'Other new', cwd: '/other', updatedAt: NOW },
      { sessionId: 'local-new', label: 'Local new', cwd: '/work', updatedAt: NOW - DAY },
      { sessionId: 'other-old', label: 'Other old', cwd: '/other', updatedAt: NOW - 3 * DAY },
    ]
    const found = await workspaceReferenceCandidates(
      { listCandidates: async () => rows },
      { id: 'side', session: { header: { cwd: '/other' } } },
      '/work', sessionList(rows), NOW,
    )
    expect(found.map(row => row.sessionId)).toEqual(['local-new', 'local-old', 'other-new', 'other-old'])
    expect(found[0]).toMatchObject({ cwd: '/work', sameWorkspace: true, updatedAt: NOW - DAY })
    expect(found[2]).toMatchObject({ cwd: '/other', sameWorkspace: false, updatedAt: NOW })
    expect(rows.map(row => row.sessionId)).toEqual(['local-old', 'other-new', 'local-new', 'other-old'])
  })

  it('excludes subagents identified by origin or projection without hiding ordinary forks', async () => {
    const rows = [
      { sessionId: 'child-local', label: 'Child', cwd: '/work', updatedAt: NOW, origin: 'subagent' },
      { sessionId: 'child-other', label: 'Child elsewhere', cwd: '/other', updatedAt: NOW, origin: 'subagent' },
      { sessionId: 'legacy-child', label: 'Legacy child', cwd: '/work', updatedAt: NOW, projections: { values: { subagent: { label: 'Worker' } } } },
      { sessionId: 'ordinary-fork', label: 'Fork', cwd: '/work', updatedAt: NOW, parentSessionId: 'parent', projections: { values: { subagent: null } } },
    ]
    const found = await workspaceReferenceCandidates(
      { listCandidates: async () => rows }, { id: 'side', session: { header: {} } },
      '/work', sessionList(rows), NOW,
    )
    expect(found.map(row => row.sessionId)).toEqual(['ordinary-fork'])
  })

  it('excludes blank sessions even when they have a title', async () => {
    const rows = [
      { sessionId: 'blank-local', label: 'Unused draft', cwd: '/work', updatedAt: NOW, blank: true },
      { sessionId: 'blank-other', label: 'Another draft', cwd: '/other', updatedAt: NOW, blank: true },
      { sessionId: 'started', label: 'Product design', cwd: '/work', updatedAt: NOW, blank: false },
    ]
    const found = await workspaceReferenceCandidates(
      { listCandidates: async () => rows }, { id: 'side', session: { header: {} } },
      '/work', sessionList(rows), NOW,
    )
    expect(found.map(row => row.sessionId)).toEqual(['started'])
  })

  it('excludes empty titles and raw-ID fallbacks even if blank metadata is missing', async () => {
    const rows = [
      { sessionId: 'session-untitled', label: 'session-untitled', displayTitle: 'session-untitled', cwd: '/work' },
      { sessionId: 'session-spaces', label: '  session-spaces  ', displayTitle: '   ', cwd: '/other' },
      { sessionId: 'session-empty', label: '', displayTitle: '', cwd: '/work' },
      { sessionId: 'session-whitespace', label: ' \n ', cwd: '/work' },
      { sessionId: 'session-named', label: 'A named conversation', cwd: '/other' },
    ]
    const found = await workspaceReferenceCandidates(
      { listCandidates: async () => rows }, { id: 'side', session: { header: {} } },
      '/work', sessionList(rows.map(row => ({ ...row, updatedAt: NOW }))), NOW,
    )
    expect(found.map(row => row.sessionId)).toEqual(['session-named'])
  })

  it('uses a readable title instead of a blank or ID-only display title', async () => {
    const rows = [
      { sessionId: 'label-only', label: '  Product design  ', displayTitle: '  ', cwd: '/work' },
      { sessionId: 'id-display', label: 'A useful title', displayTitle: 'id-display', cwd: '/work' },
      { sessionId: 'title-display', label: 'Canonical title', displayTitle: 'Display title', cwd: '/work' },
      { sessionId: 'prefix-title', label: 'session-debugging discussion', cwd: '/work' },
    ]
    const found = await workspaceReferenceCandidates(
      { listCandidates: async () => rows }, { id: 'side', session: { header: {} } },
      '/work', sessionList(rows.map(row => ({ ...row, updatedAt: NOW, blank: false }))), NOW,
    )
    expect(found.find(row => row.sessionId === 'label-only')?.displayTitle).toBe('Product design')
    expect(found.find(row => row.sessionId === 'id-display')?.displayTitle).toBe('A useful title')
    expect(found.find(row => row.sessionId === 'title-display')?.displayTitle).toBe('Display title')
    expect(found.find(row => row.sessionId === 'prefix-title')?.displayTitle).toBe('session-debugging discussion')
  })

  it('excludes archived sessions in both workspace groups without changing their records', async () => {
    const rows = [
      { sessionId: 'archived-local', label: 'Archived plan', cwd: '/work', updatedAt: NOW },
      { sessionId: 'archived-other', label: 'Archived review', cwd: '/other', updatedAt: NOW },
      { sessionId: 'visible-local', label: 'Current plan', cwd: '/work', updatedAt: NOW - 1000 },
      { sessionId: 'visible-other', label: 'Current review', cwd: '/other', updatedAt: NOW },
    ]
    const archived = Object.freeze(['archived-local', 'archived-other'])
    const found = await workspaceReferenceCandidates(
      { listCandidates: async () => rows }, { id: 'side', session: { header: {} } },
      '/work', sessionList(rows), NOW, archived,
    )
    expect(found.map(row => row.sessionId)).toEqual(['visible-local', 'visible-other'])
    expect(archived).toEqual(['archived-local', 'archived-other'])
    expect(rows).toHaveLength(4)
  })

  it('filters on last activity with an inclusive seven-day boundary, not creation time', async () => {
    expect(REFERENCE_ACTIVE_WINDOW_MS).toBe(7 * DAY)
    const rows = [
      { sessionId: 'old-but-active', label: 'Old', cwd: '/work', createdAt: NOW - 30 * DAY, updatedAt: NOW - DAY },
      { sessionId: 'boundary', label: 'Boundary', cwd: '/other', createdAt: NOW - 30 * DAY, updatedAt: NOW - 7 * DAY },
      { sessionId: 'expired-local', label: 'Expired', cwd: '/work', updatedAt: NOW - 7 * DAY - 1 },
      { sessionId: 'expired-other', label: 'Expired elsewhere', cwd: '/other', updatedAt: NOW - 8 * DAY },
      { sessionId: 'invalid', label: 'Invalid', cwd: '/work', updatedAt: NaN },
      { sessionId: 'infinite', label: 'Infinite', cwd: '/work', updatedAt: Infinity },
    ]
    const found = await workspaceReferenceCandidates(
      { listCandidates: async () => rows }, { id: 'side', session: { header: {} } },
      '/work', sessionList(rows), NOW,
    )
    expect(found.map(row => row.sessionId)).toEqual(['old-but-active', 'boundary'])
  })

  it('does not invent activity metadata for a candidate absent from the host list', async () => {
    const found = await workspaceReferenceCandidates(
      { listCandidates: async () => [{ sessionId: 'gone', label: 'Gone', cwd: '/work' }] },
      { id: 'side', session: { header: {} } }, '/work', sessionList([]), NOW,
    )
    expect(found).toEqual([])
  })

  it('lists recent sessions without promoting an unknown parent workspace', async () => {
    const rows = [{ sessionId: 'other', label: 'Other', cwd: '/other', updatedAt: NOW }]
    const found = await workspaceReferenceCandidates(
      { listCandidates: async () => rows }, { id: 'side', session: { header: {} } },
      undefined, sessionList(rows), NOW,
    )
    expect(found.map(row => row.sessionId)).toEqual(['other'])
    expect(found[0]?.sameWorkspace).toBe(false)
  })

  it('surfaces activity-service failures rather than returning unfiltered sessions', async () => {
    await expect(workspaceReferenceCandidates(
      { listCandidates: async () => [] }, { id: 'side', session: { header: {} } },
      '/work', { list: async () => { throw new Error('activity unavailable') } }, NOW,
    )).rejects.toThrow('activity unavailable')
  })

  it('uses native escaped mentions and preserves presentation titles', async () => {
    const found = await workspaceReferenceCandidates({ listCandidates: async () => [
      { sessionId: 'session-unicode', label: '方案 [A] \\ B', displayTitle: 'Product design', cwd: '/work' },
    ] }, { id: 'side', session: { header: {} } }, '/work', sessionList([
      { sessionId: 'session-unicode', cwd: '/work', updatedAt: NOW },
    ]), NOW)
    expect(found[0]?.mention).toBe(formatSessionReferenceMention({ sessionId: 'session-unicode' as never, label: '方案 [A] \\ B' }))
    expect(found[0]?.displayTitle).toBe('Product design')
  })
})

describe('side chat mention editing', () => {
  it('opens for a standalone @ and searches at the caret', () => {
    expect(mentionQuery('@', 1)).toEqual({ start: 0, end: 1, query: '' })
    expect(mentionQuery('比较 @方案 后文', 6)).toEqual({ start: 3, end: 6, query: '方案' })
    expect(mentionQuery('line\n@Vibe', 10)?.query).toBe('Vibe')
  })

  it('ignores emails, existing references, selections and completed tokens', () => {
    expect(mentionQuery('a@b.com', 7)).toBeUndefined()
    expect(mentionQuery('@[A](dsh-session:abc)', 5)).toBeUndefined()
    expect(mentionQuery('@text ', 6)).toBeUndefined()
    expect(mentionQuery('@text', 1, 5)).toBeUndefined()
  })

  it('searches labels, display titles and ids without a result cap', () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ sessionId: `id-${i}`, label: 'Work', displayTitle: '方案', mention: 'canonical' }))
    expect(filterReferenceCandidates(rows, 'WORK')).toHaveLength(120)
    expect(filterReferenceCandidates(rows, '方案')).toHaveLength(120)
    expect(filterReferenceCandidates(rows, 'id-119')).toHaveLength(1)
    expect(filterReferenceCandidates(rows, 'missing')).toEqual([])
  })

  it('searches other workspace paths and keeps the host ordering', () => {
    const rows = [
      { sessionId: 'local', label: 'Plan', cwd: '/work', sameWorkspace: true, mention: 'local' },
      { sessionId: 'other', label: 'Plan', cwd: '/Projects/VibeFlow', sameWorkspace: false, mention: 'other' },
    ]
    expect(filterReferenceCandidates(rows, 'plan').map(row => row.sessionId)).toEqual(['local', 'other'])
    expect(filterReferenceCandidates(rows, 'vibeflow').map(row => row.sessionId)).toEqual(['other'])
  })

  it('replaces only the active token and preserves earlier mentions and trailing text', () => {
    const text = '@[First](dsh-session:abc) compare @Sec remainder'
    const end = text.indexOf(' remainder')
    const result = insertSessionMention(text, mentionQuery(text, end)!, '@[Second](dsh-session:def)')
    expect(result.text).toBe('@[First](dsh-session:abc) compare @[Second](dsh-session:def)  remainder')
    expect(result.text.slice(result.caret)).toBe(' remainder')
  })

  it('wraps keyboard selection and handles an empty list', () => {
    expect(moveMentionSelection(0, -1, 3)).toBe(2)
    expect(moveMentionSelection(2, 1, 3)).toBe(0)
    expect(moveMentionSelection(0, 1, 0)).toBe(0)
  })

  it('keeps IME confirmation and shift-enter out of mention selection', () => {
    expect(mentionKeyAction('Enter', false, true)).toBeUndefined()
    expect(mentionKeyAction('ArrowDown', false, true)).toBeUndefined()
    expect(mentionKeyAction('Enter', true, false)).toBeUndefined()
    expect(mentionKeyAction('Tab', true, false)).toBeUndefined()
    expect(mentionKeyAction('Enter', false, false)).toBe('pick')
    expect(mentionKeyAction('Tab', false, false)).toBe('pick')
    expect(mentionKeyAction('Escape', false, false)).toBe('dismiss')
    expect(mentionKeyAction('ArrowDown', false, false)).toBe('next')
    expect(mentionKeyAction('ArrowUp', false, false)).toBe('previous')
  })

  it('sends native references unchanged alongside attachments', async () => {
    const mention = formatSessionReferenceMention({ sessionId: 'session-parent' as never, label: 'VibeFlow' })
    const content = await sideChatPromptContent({ serializeDraftAttachments: async () => ({ attachments: [
      { type: 'file', receiptId: 'receipt' },
    ] }) }, ['draft'], `Continue ${mention}`)
    expect(content).toEqual([{ type: 'file', receiptId: 'receipt' }, { type: 'text', text: `Continue ${mention}` }])
  })
})
