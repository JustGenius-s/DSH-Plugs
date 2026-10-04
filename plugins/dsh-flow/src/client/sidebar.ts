import type { ComponentType, ReactNode } from 'react'
import type { ClientContext, SidebarRightTabDefinition } from '@just-genius/dsh-plugin-runtime/client'

export const FLOW_TAB_ID = '@just-genius/dsh-flow'
export const FLOW_TAB_KIND = 'dsh-flow'

/** Structural adapter for the newer Sidebar slots, absent from the pinned SlotMap. */
interface SidebarSlots {
  inject(name: string, register: () => () => void): () => void
  register(options: { name: string; key: string }, component: (props: { sessionId: string }) => ReactNode): () => void
}

export function registerFlowTab(
  ctx: ClientContext,
  body: (props: { sessionId: string }) => ReactNode,
  title: () => ReactNode,
  icon: ComponentType,
): () => void {
  const definition: SidebarRightTabDefinition = {
    id: FLOW_TAB_ID,
    kind: FLOW_TAB_KIND,
    priority: 'extension',
    title: () => 'Flow',
    guide: [{ id: 'new', order: 50, title: () => 'Flow', icon }],
  }
  const slots = ctx.slots as unknown as SidebarSlots
  const disposeDefinition = ctx.sidebarRightTabs.register(definition)
  const disposeBody = slots.inject('sidebar.right.pane.tab', () => slots.register({
    name: 'sidebar.right.pane.tab', key: FLOW_TAB_ID,
  }, body))
  const disposeTitle = slots.inject('sidebar.right.pane.tab.title', () => slots.register({
    name: 'sidebar.right.pane.tab.title', key: FLOW_TAB_ID,
  }, title))
  return () => {
    disposeTitle()
    disposeBody()
    disposeDefinition()
  }
}
