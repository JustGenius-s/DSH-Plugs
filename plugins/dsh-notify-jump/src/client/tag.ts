/** Tag prefix used by `dsh-notification` (`notificationTag`). */
export const NOTIFICATION_TAG_PREFIX = 'dsh-notification-'

/** Settings-page test ping; not a real session. */
export const NOTIFICATION_TEST_TAG = 'dsh-notification-test'

/** One notification slot per session — same grouping as `dsh-notification`. */
export function notificationTag(sessionId: string): string {
  return `${NOTIFICATION_TAG_PREFIX}${sessionId}`
}

/**
 * Session id encoded in a dsh-notification tag, or undefined for the test
 * ping / any other Notification.
 */
export function sessionIdFromTag(tag: string | undefined): string | undefined {
  if (tag === undefined || tag === NOTIFICATION_TEST_TAG) return undefined
  if (!tag.startsWith(NOTIFICATION_TAG_PREFIX)) return undefined
  const id = tag.slice(NOTIFICATION_TAG_PREFIX.length)
  return id === '' ? undefined : id
}
