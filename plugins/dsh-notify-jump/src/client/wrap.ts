import { sessionIdFromTag } from './tag'

/** Open the listed session; unknown ids (other workspace) must not throw the click handler. */
export type OpenSession = (sessionId: string) => void

interface DesktopNotification {
  show(spec: { contributor: string; id: string; title: string; body: string; silent?: boolean }): Promise<{ shown: boolean }>
  close(contributor: string, id?: string): Promise<void>
  onAction(listener: (action: { contributor: string; id: string }) => void): () => void
}

interface DesktopBridge {
  notify?: DesktopNotification
}

interface DesktopNotificationLike extends Notification {
  readonly tag: string
}

interface NativeNotification extends DesktopNotificationLike {
  __emitClick?: () => void
}

const DESKTOP_CONTRIBUTOR = 'dsh-notification'

function desktopNotify(): DesktopNotification | undefined {
  const desktop = (window as unknown as { dshDesktop?: DesktopBridge }).dshDesktop
  return desktop?.notify
}

function desktopId(tag: string): string {
  // The desktop API accepts IDs up to 64 ASCII characters. Session tags are
  // already stable per session; using the same ID lets the main process replace
  // an old notification instead of hitting its new-ID rate limit.
  const normalized = tag.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64)
  return normalized === '' ? 'notification' : normalized
}

function nativeNotification(
  title: string,
  options: NotificationOptions | undefined,
  desktop: DesktopNotification,
): NativeNotification {
  const tag = options?.tag ?? `dsh-notification-${crypto.randomUUID()}`
  const id = desktopId(tag)
  const listeners = new Set<EventListenerOrEventListenerObject>()
  let closed = false
  let onclick: ((this: Notification, ev: Event) => unknown) | null = null
  const target = {} as NativeNotification

  const emitClick = (): void => {
    if (closed) return
    window.focus()
    const event = new Event('click')
    for (const listener of listeners) {
      if (typeof listener === 'function') listener.call(target, event)
      else listener.handleEvent(event)
    }
    onclick?.call(target, event)
  }

  Object.defineProperties(target, {
    tag: { enumerable: true, configurable: false, get: () => tag },
    onclick: {
      enumerable: true,
      configurable: true,
      get: () => onclick,
      set: (value: ((this: Notification, ev: Event) => unknown) | null) => { onclick = value },
    },
  })
  target.close = () => {
    if (closed) return
    closed = true
    void desktop.close(DESKTOP_CONTRIBUTOR, id)
  }
  target.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject | null) => {
    if (type === 'click' && listener !== null) listeners.add(listener)
  }) as typeof target.addEventListener
  target.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject | null) => {
    if (type === 'click' && listener !== null) listeners.delete(listener)
  }) as typeof target.removeEventListener
  target.__emitClick = emitClick

  void desktop.show({
    contributor: DESKTOP_CONTRIBUTOR,
    id,
    title,
    body: options?.body ?? title,
    silent: options?.silent === true,
  }).then((result) => {
    if (!result.shown) console.warn('[dsh-notify-jump] desktop notification was not shown', id)
  }).catch((error) => {
    console.warn('[dsh-notify-jump] desktop notification failed', error)
  })
  return target
}

/**
 * Replace `window.Notification` so every constructed notification uses the
 * desktop shell's native notification path when available. Browser fallback is
 * retained for plain web use. Native notifications avoid Chromium/macOS's
 * sound-only behavior and keep click-to-session navigation.
 */
export function installNotificationJump(openSession: OpenSession): () => void {
  const Native = window.Notification
  if (typeof Native !== 'function') return () => {}
  const desktop = desktopNotify()
  const nativeById = new Map<string, NativeNotification>()
  const offAction = desktop?.onAction((action) => {
    if (action.contributor !== DESKTOP_CONTRIBUTOR) return
    const notification = nativeById.get(action.id)
    if (notification === undefined) return
    notification.__emitClick?.()
    nativeById.delete(action.id)
    const id = sessionIdFromTag(notification.tag)
    if (id === undefined) return
    try {
      openSession(id)
    } catch (error) {
      console.warn('[dsh-notify-jump] sessions.open failed', error)
    }
    notification.close()
  })

  const Wrapped = function Notification(title: string, options?: NotificationOptions): Notification {
    if (desktop !== undefined) {
      const notification = nativeNotification(title, options, desktop)
      const tag = notification.tag
      nativeById.set(desktopId(tag), notification)
      return notification as unknown as Notification
    }
    const notification = new Native(title, options)
    notification.addEventListener('click', () => {
      window.focus()
      const id = sessionIdFromTag(notification.tag)
      if (id === undefined) return
      try {
        openSession(id)
      } catch (error) {
        console.warn('[dsh-notify-jump] sessions.open failed', error)
      }
      notification.close()
    })
    return notification
  } as unknown as typeof Notification

  Wrapped.prototype = Native.prototype
  try {
    Object.defineProperties(Wrapped, Object.getOwnPropertyDescriptors(Native))
  } catch {
    // Native Notification descriptors are not always copyable; forward the
    // statics dsh-notification reads at show time.
  }
  Object.defineProperty(Wrapped, 'permission', {
    configurable: true,
    enumerable: true,
    get: () => Native.permission,
  })
  Object.defineProperty(Wrapped, 'requestPermission', {
    configurable: true,
    enumerable: true,
    value: Native.requestPermission.bind(Native),
  })

  Object.defineProperty(window, 'Notification', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: Wrapped,
  })

  return () => {
    offAction?.()
    nativeById.clear()
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: Native,
    })
  }
}
