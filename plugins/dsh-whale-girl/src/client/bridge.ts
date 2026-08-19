export interface DesktopOverlayMoveResult {
  x: number
  y: number
  hitEdge: boolean
}

export interface DshDesktopOverlays {
  open(spec: {
    contributor: string
    id: string
    url: string
    bounds: { width: number; height: number; x?: number; y?: number }
    chrome?: {
      transparent?: boolean
      frame?: boolean
      alwaysOnTop?: boolean
      skipTaskbar?: boolean
      resizable?: boolean
      hasShadow?: boolean
      ignoreMouseEvents?: 'none' | 'all' | 'forward'
    }
  }): Promise<{ contributor: string; id: string; bounds: { x: number; y: number; width: number; height: number } }>
  move(id: string, spec: { dx: number; dy: number } | { x: number; y: number }): Promise<DesktopOverlayMoveResult>
  setIgnoreMouseEvents(id: string, ignore: boolean, opts?: { forward?: boolean }): Promise<void>
  close(id: string): Promise<void>
  list(): Promise<Array<{ contributor: string; id: string }>>
  onClosed(listener: (event: { contributor: string; id: string }) => void): () => void
}

export interface DshDesktop {
  overlays?: DshDesktopOverlays
}

export function bridge(): DshDesktop | undefined {
  return (window as unknown as { dshDesktop?: DshDesktop }).dshDesktop
}
