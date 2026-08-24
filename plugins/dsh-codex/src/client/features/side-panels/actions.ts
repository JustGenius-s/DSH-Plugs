import type { ReactNode } from 'react'

export type SidePanelActionVariant = 'launcher' | 'header'

/** Generic shell extension point; platform code never imports feature stores. */
export interface SidePanelActionsContribution {
  render(variant: SidePanelActionVariant): ReactNode
  dispose(): void
}
