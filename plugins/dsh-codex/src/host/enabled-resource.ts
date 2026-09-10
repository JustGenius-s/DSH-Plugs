export interface EnabledResourceGate {
  setEnabled(enabled: boolean): void
  dispose(): void
}

/** Own a Host resource whose registration follows one live boolean setting. */
export function createEnabledResourceGate(
  create: () => () => void,
): EnabledResourceGate {
  let enabled = false
  let disposed = false
  let disposeResource: (() => void) | undefined

  return {
    setEnabled(nextEnabled) {
      if (disposed || nextEnabled === enabled) return
      if (nextEnabled) {
        disposeResource = create()
        enabled = true
        return
      }
      enabled = false
      const dispose = disposeResource
      disposeResource = undefined
      dispose?.()
    },
    dispose() {
      if (disposed) return
      disposed = true
      enabled = false
      const dispose = disposeResource
      disposeResource = undefined
      dispose?.()
    },
  }
}
