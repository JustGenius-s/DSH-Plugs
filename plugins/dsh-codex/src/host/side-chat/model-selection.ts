/** The session-local selection, without request-only adapter settings. */
export interface SideChatModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

interface ModelParent {
  requestHeader?(): {
    config: unknown
    adapterDefaults?: { reasoningEffort?: boolean }
  } | undefined
}

function selectionOf(value: unknown): SideChatModelSelection | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const { provider, model, reasoningEffort } = value as Record<string, unknown>
  if (typeof provider !== 'string' || provider.length === 0
    || typeof model !== 'string' || model.length === 0) return undefined
  return {
    provider,
    model,
    ...(typeof reasoningEffort === 'string' && reasoningEffort.length > 0
      ? { reasoningEffort }
      : {}),
  }
}

/** Prefer a not-yet-used selection over the parent's last executed request. */
export function inheritedModelSelection(
  parent: ModelParent,
  pending?: unknown,
): SideChatModelSelection | undefined {
  const selected = selectionOf(pending)
  if (selected !== undefined) return selected
  const header = typeof parent.requestHeader === 'function'
    ? parent.requestHeader()
    : undefined
  const logged = selectionOf(header?.config)
  if (logged === undefined) return undefined
  if (header?.adapterDefaults?.reasoningEffort === true) {
    return { provider: logged.provider, model: logged.model }
  }
  return logged
}

/** Structural boundary for the controller-owned event across DSH versions. */
export interface SideChatModelSession {
  append(type: 'model/selection', data: SideChatModelSelection): unknown
}

/**
 * Persist before publication: API Session initializes its selection from this
 * event, not agentOptions. Do not call selectModel here: it also saves the
 * global default, which opening a side chat must leave unchanged.
 */
export function initializeSideChatModel(
  session: SideChatModelSession,
  selection: SideChatModelSelection,
): void {
  session.append('model/selection', { ...selection })
}
