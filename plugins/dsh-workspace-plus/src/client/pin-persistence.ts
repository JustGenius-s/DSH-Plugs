import { PINS_PATH } from '../shared.ts'
import { updatePin, type Pin, type PinAction, type PinSnapshot } from '../pin-state.ts'
import { getJson, postJson } from './http.ts'

interface PinTransport {
  load: () => Promise<PinSnapshot>
  change: (action: PinAction) => Promise<PinSnapshot>
}

interface PinPersistenceOptions {
  initial: readonly Pin[]
  apply: (pins: Pin[]) => void
  transport?: PinTransport
  onError?: (error: unknown) => void
  retryMs?: number
}

const transport: PinTransport = {
  load: () => getJson(PINS_PATH),
  change: (action) => postJson(PINS_PATH, action, { keepalive: true }),
}

/** Hydrate before saving; replay user actions over the restored disk state. */
export function createPinPersistence(options: PinPersistenceOptions) {
  const remote = options.transport ?? transport
  const initial = [...options.initial]
  const pending: Extract<PinAction, { action: 'set' }>[] = []
  let pins: Pin[] = []
  let loaded = false
  let disposed = false
  let flight: Promise<void> | undefined
  let retry: ReturnType<typeof setTimeout> | undefined

  function publish(): void {
    options.apply(pending.reduce((value, action) => updatePin(value, action.pin, action.pinned), pins))
  }

  async function run(): Promise<void> {
    if (!loaded) {
      let snapshot = await remote.load()
      if (disposed) return
      if (!snapshot.initialized && initial.length > 0) {
        snapshot = await remote.change({ action: 'import', pins: initial })
        if (disposed) return
      }
      pins = snapshot.pins
      loaded = true
      publish()
    }
    while (!disposed && pending.length > 0) {
      const action = pending[0]!
      const snapshot = await remote.change(action)
      if (disposed) return
      pending.shift()
      pins = snapshot.pins
      publish()
    }
  }

  function flush(): Promise<void> {
    if (disposed) return Promise.resolve()
    if (flight !== undefined) return flight
    clearTimeout(retry)
    retry = undefined
    flight = run().catch((error: unknown) => {
      if (!disposed) {
        retry = setTimeout(() => { void flush().catch(options.onError ?? console.warn) }, options.retryMs ?? 1000)
      }
      throw error
    }).finally(() => { flight = undefined })
    return flight
  }

  return {
    flush,
    set(pin: Pin, pinned: boolean): Promise<void> {
      if (disposed) return Promise.resolve()
      pending.push({ action: 'set', pin, pinned })
      return flush()
    },
    dispose(): void {
      disposed = true
      clearTimeout(retry)
    },
  }
}
