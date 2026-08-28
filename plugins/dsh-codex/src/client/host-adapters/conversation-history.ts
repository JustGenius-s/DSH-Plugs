import type { HistoryEntry, IApiClient } from '@just-genius/dsh-plugin-runtime/client'

export interface ConversationHistoryAddress {
  parentSessionId: string
  childSessionId: string
  mode: 'one-shot' | 'continuable'
}

export interface ConversationHistoryPage {
  events: HistoryEntry[]
  hasMore: boolean
}

/**
 * Version boundary for branded session ids from the connection/runtime RC
 * packages. Feature code deals in host-provided strings; only this adapter
 * translates them into the wire client's nominal request types.
 */
export async function readConversationHistoryPage(
  api: IApiClient,
  sessionId: string,
  address: ConversationHistoryAddress | undefined,
  beforeSeq: number | undefined,
  maxMessages: number,
): Promise<ConversationHistoryPage | null> {
  const page = { maxMessages, ...(beforeSeq === undefined ? {} : { beforeSeq }) }
  const response = address === undefined
    ? await api.sessions.history(
      { sessionId, ...page } as unknown as Parameters<typeof api.sessions.history>[0],
    )
    : await api.subagents.history(
      { ...address, ...page } as unknown as Parameters<typeof api.subagents.history>[0],
    )
  const result = response.result
  return result.ok ? result.value : null
}
