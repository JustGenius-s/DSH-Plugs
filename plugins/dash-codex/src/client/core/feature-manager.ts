export type Dispose = () => void

export interface CodexFeature {
  id: string
  activate(): Dispose
}

export interface CodexFeatureManager {
  activate(): void
  dispose(): void
}

/** Owns feature lifecycles without knowing feature implementation details. */
export function createCodexFeatureManager(features: readonly CodexFeature[]): CodexFeatureManager {
  let disposers: Dispose[] | undefined

  return {
    activate() {
      if (disposers !== undefined) return
      disposers = features.map(feature => feature.activate())
    },
    dispose() {
      const current = disposers
      disposers = undefined
      if (current === undefined) return
      for (const dispose of current.reverse()) dispose()
    },
  }
}
