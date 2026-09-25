/**
 * Client side of the plugin's pin store, plus the one-time session-pin
 * migration.
 *
 * WORKSPACE pins live here: they go to `pins.json` on the Host and are read back
 * once per load. SESSION pins do not — those are DSH's own
 * (`UiWorkspace.pinSession`), so this module only MIGRATES the ids an earlier
 * plugin version left on disk into the official registry, then asks the Host to
 * drop the legacy rows. A failed migration keeps them on disk and retries on
 * the next load, so a pin is never lost to a transient failure.
 */

import { PINS_PATH } from '../shared.ts'
import { updateWorkspacePins, type PinAction, type PinSnapshot } from '../pin-state.ts'
import { getJson, postJson } from './http.ts'

interface PinTransport {
  load: () => Promise<PinSnapshot>
  change: (action: PinAction) => Promise<PinSnapshot>
}

interface PinPersistenceOptions {
  initial: readonly string[]
  apply: (workspacePins: string[]) => void
  /** Migrate one legacy session pin into the official registry. */
  adoptSessionPin?: (sessionId: string) => Promise<void>
  transport?: PinTransport
  onError?: (error: unknown) => void
  retryMs?: number
}

const transport: PinTransport = {
  load: () => getJson(PINS_PATH),
  change: (action) => postJson(PINS_PATH, action, { keepalive: true }),
}

export function createPinPersistence(options: PinPersistenceOptions) {
  const remote = options.transport ?? transport
  const initial = [...options.initial]
  const pending: Extract<PinAction, { action: 'set' }>[] = []
  let workspacePins: string[] = []
  let loaded = false
  let disposed = false
  let flight: Promise<void> | undefined
  let retry: ReturnType<typeof setTimeout> | undefined

  function publish(): void {
    options.apply(pending.reduce(
      (value, action) => updateWorkspacePins(value, action.workspaceId, action.pinned),
      workspacePins,
    ))
  }

  /**
   * Move every legacy session pin into DSH, then clear the legacy rows.
   *
   * Order matters: the Host rows are removed only after each `pinSession`
   * resolves, so an interrupted migration stays retryable instead of dropping
   * pins the official registry never received.
   */
  async function migrateSessionPins(snapshot: PinSnapshot): Promise<void> {
    const adopt = options.adoptSessionPin
    if (snapshot.legacySessionPins.length === 0 || adopt === undefined) return
    for (const sessionId of snapshot.legacySessionPins) {
      await adopt(sessionId)
      if (disposed) return
    }
    await remote.change({ action: 'clearLegacySessions' })
  }

  async function run(): Promise<void> {
    if (!loaded) {
      let snapshot = await remote.load()
      if (disposed) return
      if (!snapshot.initialized && initial.length > 0) {
        snapshot = await remote.change({ action: 'import', workspacePins: initial })
        if (disposed) return
      }
      workspacePins = snapshot.workspacePins
      loaded = true
      publish()
      await migrateSessionPins(snapshot)
      if (disposed) return
    }
    while (!disposed && pending.length > 0) {
      const action = pending[0]!
      const snapshot = await remote.change(action)
      if (disposed) return
      pending.shift()
      workspacePins = snapshot.workspacePins
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
    set(workspaceId: string, pinned: boolean): Promise<void> {
      if (disposed) return Promise.resolve()
      pending.push({ action: 'set', workspaceId, pinned })
      return flush()
    },
    dispose(): void {
      disposed = true
      clearTimeout(retry)
    },
  }
}
