import type { CuaActivity } from '../shared/types.ts'

type PreviewIdentity = Pick<CuaActivity, 'sessionId' | 'openedAt'>
export type PendingCloses = ReadonlyMap<string, number | undefined>

/** Only the version whose close request is pending is hidden optimistically. */
export function isPreviewClosing(pending: PendingCloses, activity: PreviewIdentity): boolean {
  return pending.has(activity.sessionId) && pending.get(activity.sessionId) === activity.openedAt
}

export function beginPreviewClose(pending: PendingCloses, activity: PreviewIdentity): PendingCloses {
  return new Map(pending).set(activity.sessionId, activity.openedAt)
}

/** An older response cannot clear a newer close request for the same session. */
export function finishPreviewClose(pending: PendingCloses, activity: PreviewIdentity): PendingCloses {
  if (!isPreviewClosing(pending, activity)) return pending
  const next = new Map(pending)
  next.delete(activity.sessionId)
  return next
}
