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
  close(id: string): Promise<void>
  onClosed(listener: (event: { contributor: string; id: string }) => void): () => void
}

export interface DshDesktop {
  overlays?: DshDesktopOverlays
}

export function desktop(): DshDesktop | undefined {
  return (window as unknown as { dshDesktop?: DshDesktop }).dshDesktop
}
