import { formatSessionReferenceMention, type SessionId } from '@just-genius/dsh-plugin-runtime/host'
import type { SideChatReferenceCandidate } from '../../shared/side-chat'

interface ReferenceAgent {
  id: string
  session: { header: { cwd?: string } }
}

export interface ReferenceResolver {
  listCandidates(agent: ReferenceAgent, query: string, limit: number): Promise<readonly {
    sessionId: string
    label: string
    displayTitle?: string
    cwd?: string
  }[]>
}

export interface ReferenceSessionSummary {
  sessionId: string
  cwd?: string
  updatedAt: number
  blank?: boolean
  origin?: string
  projections?: { values?: { subagent?: unknown } }
}

export interface ReferenceSessionList {
  list(request: Record<string, never>, signal: AbortSignal): Promise<{ items: readonly ReferenceSessionSummary[] }>
}

export const REFERENCE_ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** The resolver substitutes the raw ID when no real title is available. */
function referenceTitleOf(
  row: Pick<SideChatReferenceCandidate, 'sessionId' | 'label' | 'displayTitle'>,
): string | undefined {
  for (const value of [row.displayTitle, row.label]) {
    if (typeof value !== 'string') continue
    const title = value.trim()
    if (title.length > 0 && title !== row.sessionId) return title
  }
  return undefined
}

/** Use the host's activity metadata, not candidate creation dates or fork lineage. */
export async function workspaceReferenceCandidates(
  resolver: ReferenceResolver,
  agent: ReferenceAgent,
  parentCwd: string | undefined,
  sessions: ReferenceSessionList,
  now = Date.now(),
  archivedSessionIds: readonly string[] = [],
): Promise<SideChatReferenceCandidate[]> {
  const [candidates, listing] = await Promise.all([
    resolver.listCandidates(agent, '', Number.MAX_SAFE_INTEGER),
    sessions.list({}, new AbortController().signal),
  ])
  const summaries = new Map(listing.items.map(row => [row.sessionId, row]))
  const archived = new Set(archivedSessionIds)
  return candidates
    .flatMap(row => {
      const summary = summaries.get(row.sessionId)
      const title = referenceTitleOf(row)
      if (row.sessionId === agent.id || summary === undefined || title === undefined
        || summary.blank === true || archived.has(row.sessionId)
        || summary.origin === 'subagent' || summary.projections?.values?.subagent != null
        || !Number.isFinite(summary.updatedAt) || summary.updatedAt < now - REFERENCE_ACTIVE_WINDOW_MS) return []
      return [{
        sessionId: row.sessionId,
        label: row.label,
        displayTitle: title,
        cwd: summary.cwd,
        sameWorkspace: !!parentCwd && summary.cwd === parentCwd,
        updatedAt: summary.updatedAt,
        mention: formatSessionReferenceMention({ sessionId: row.sessionId as SessionId, label: row.label }),
      }]
    })
    .sort((a, b) => Number(b.sameWorkspace) - Number(a.sameWorkspace)
      || b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId))
}
