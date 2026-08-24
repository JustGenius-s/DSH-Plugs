export type Dispose = () => void

export interface CodexFeature {
  id: string
  /** Capabilities that must already be active before this feature starts. */
  requires?: readonly string[]
  /** Capabilities published for downstream features. The feature id is implicit. */
  provides?: readonly string[]
  activate(): Dispose
}

export interface CodexFeatureManager {
  activate(): void
  dispose(): void
}

/** Owns feature lifecycles without knowing feature implementation details. */
export function createCodexFeatureManager(features: readonly CodexFeature[]): CodexFeatureManager {
  let disposers: Dispose[] | undefined
  const ordered = orderFeatures(features)

  return {
    activate() {
      if (disposers !== undefined) return
      disposers = ordered.map(feature => feature.activate())
    },
    dispose() {
      const current = disposers
      disposers = undefined
      if (current === undefined) return
      for (const dispose of current.reverse()) dispose()
    },
  }
}

function orderFeatures(features: readonly CodexFeature[]): CodexFeature[] {
  const pending = [...features]
  const ordered: CodexFeature[] = []
  const available = new Set<string>()
  while (pending.length > 0) {
    const index = pending.findIndex(feature =>
      (feature.requires ?? []).every(capability => available.has(capability)),
    )
    if (index === -1) {
      const missing = pending.map(feature =>
        `${feature.id} -> ${(feature.requires ?? []).filter(item => !available.has(item)).join(', ')}`,
      )
      throw new Error(`Unresolved Codex feature dependencies: ${missing.join('; ')}`)
    }
    const [feature] = pending.splice(index, 1)
    if (feature === undefined || available.has(feature.id)) {
      throw new Error(`Duplicate Codex feature id: ${feature?.id ?? 'unknown'}`)
    }
    ordered.push(feature)
    available.add(feature.id)
    for (const capability of feature.provides ?? []) {
      if (available.has(capability)) throw new Error(`Duplicate Codex capability: ${capability}`)
      available.add(capability)
    }
  }
  return ordered
}
