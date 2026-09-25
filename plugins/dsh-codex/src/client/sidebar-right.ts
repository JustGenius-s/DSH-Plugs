import { createElement, Fragment, type ComponentType, type ReactNode } from 'react'
import type { IconProps } from '@just-genius/dsh-plugin-ui'
import type {
  ClientContext,
  SessionId,
  SessionListState,
  SidebarRightTabDefinition,
  SnapshotSelectorHook,
  UseSidebarRightTabInfo,
} from '@just-genius/dsh-plugin-runtime/client'

export const SIDEBAR_TAB_SLOT = 'sidebar.right.pane.tab'
export const SIDEBAR_TAB_TITLE_SLOT = 'sidebar.right.pane.tab.title'

/** Standard props DSH supplies to an official right-Sidebar tab registration. */
export interface SidebarTabProps {
  sessionId: SessionId
  useSessions: SnapshotSelectorHook<SessionListState>
  useTabInfo: UseSidebarRightTabInfo
  t: (key: string) => string
}

type SidebarTabComponent = (props: SidebarTabProps) => ReactNode

/** Match the official title contract: a 16px glyph followed by the tab label. */
export function sidebarTabTitle(
  Icon: ComponentType<IconProps>,
  label: ReactNode,
): ReactNode {
  return createElement(Fragment, null, createElement(Icon, { size: 16 }), label)
}

/**
 * The repo still compiles against the shared pre-0.1.5 SlotMap. Keep the one
 * dynamic seam here until that shared dependency baseline moves forward;
 * feature code stays fully typed against the 0.1.5 Sidebar contract.
 */
interface DynamicSlots {
  inject(name: string, register: () => () => void): () => void
  register(
    options: { name: string; key: string; locale?: string },
    component: SidebarTabComponent,
  ): () => void
}

export interface SidebarTabRegistrationOptions {
  locale?: string
  title?: SidebarTabComponent
}

/** One open tab's metadata as the official cross-session inventory reports it. */
export interface SidebarRightOpenTab {
  sessionId: string
  tabId: string
  kind: string
}

/**
 * Controller internals behind the typed SidebarRightService face: the shipped
 * 0.1.5 controller also carries the cross-session tab inventory and a
 * session-addressed close, which the typed face has not caught up with. Same
 * dynamic-seam rule as DynamicSlots above.
 */
interface SidebarRightInternals {
  openTabs: {
    getSnapshot(): readonly SidebarRightOpenTab[]
    subscribe(listener: () => void): () => void
  }
  closeIn(sessionId: string, tabId: string): void
}

/**
 * Close every open tab of a kind, now and whenever one appears.
 *
 * The close runs the tab kind's registered close handler, so the owning
 * plugin's resources (a built-in terminal's PTY) are released rather than
 * orphaned. Tabs of sessions whose store is not adopted yet cannot be closed
 * from here; the inventory re-reports them when the session mounts, and the
 * subscription sweeps them then.
 */
export function closeSidebarTabsByKind(ctx: ClientContext, kind: string): () => void {
  const internals = ctx.sidebarRight as unknown as SidebarRightInternals
  const sweep = (): void => {
    for (const tab of internals.openTabs.getSnapshot()) {
      if (tab.kind !== kind) continue
      try {
        internals.closeIn(tab.sessionId, tab.tabId)
      } catch (error) {
        console.error(`dsh-codex: failed to close a ${JSON.stringify(kind)} tab`, error)
      }
    }
  }
  sweep()
  return internals.openTabs.subscribe(sweep)
}

/** Register a tab type and its keyed body/title seats as one lifecycle. */
export function registerSidebarTab(
  ctx: ClientContext,
  definition: SidebarRightTabDefinition,
  body: SidebarTabComponent,
  options: SidebarTabRegistrationOptions = {},
): () => void {
  const slots = ctx.slots as unknown as DynamicSlots
  const disposeDefinition = ctx.sidebarRightTabs.register(definition)
  const disposeBody = slots.inject(SIDEBAR_TAB_SLOT, () => slots.register({
    name: SIDEBAR_TAB_SLOT,
    key: definition.id,
    locale: options.locale,
  }, body))
  const disposeTitle = options.title === undefined
    ? undefined
    : slots.inject(SIDEBAR_TAB_TITLE_SLOT, () => slots.register({
        name: SIDEBAR_TAB_TITLE_SLOT,
        key: definition.id,
        locale: options.locale,
      }, options.title as SidebarTabComponent))

  return () => {
    disposeTitle?.()
    disposeBody()
    disposeDefinition()
  }
}
