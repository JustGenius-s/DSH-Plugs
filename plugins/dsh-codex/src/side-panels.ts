/** Public, type-only capability seam for plugins contributing side panels. */
import type {} from './client/features/side-panels/contract'

export type { SidePanelOwnerProps } from './client/features/side-panels/contract'
export type {
  PanelNavState,
  SidePanelDescriptor,
  SidePanelInstance,
  SidePanelsService,
  SidePanelsSnapshot,
} from './client/features/side-panels/service'
