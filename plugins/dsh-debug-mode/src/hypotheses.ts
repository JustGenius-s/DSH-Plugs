export const HYPOTHESIS_STATUSES = ['open', 'confirmed', 'rejected', 'inconclusive'] as const

export type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number]

export interface DebugHypothesis {
  id: string
  statement: string
  status: HypothesisStatus
}

export function parseHypothesisStatus(value: unknown): HypothesisStatus | undefined {
  if (typeof value !== 'string') return undefined
  return (HYPOTHESIS_STATUSES as readonly string[]).includes(value)
    ? value as HypothesisStatus
    : undefined
}

export function upsertHypothesis(
  list: readonly DebugHypothesis[],
  id: string,
  patch: { statement?: string; status?: HypothesisStatus } = {},
): DebugHypothesis[] {
  const key = id.trim()
  if (key === '') return list.slice()
  const statement = patch.statement?.trim() ?? ''
  const existing = list.find(item => item.id === key)
  if (existing === undefined) {
    return [...list, {
      id: key,
      statement,
      status: patch.status ?? 'open',
    }]
  }
  return list.map(item => item.id === key
    ? {
        ...item,
        statement: statement === '' ? item.statement : statement,
        status: patch.status ?? item.status,
      }
    : item)
}
