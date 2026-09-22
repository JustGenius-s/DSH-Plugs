import { getResult, postJson, postResult } from '@just-genius/dsh-plugin-runtime/client'
import { missingPackages, validateBrowser, validateComputer } from '../catalog.ts'
import {
  APPLY_PATH,
  INSTALL_PATH,
  OPEN_PRIVACY_PATH,
  RESTART_DRIVER_PATH,
  STATUS_PATH,
  type ApplyResult,
  type DesiredState,
  type InstallResult,
  type StatusPayload,
} from '../shared.ts'
import { partsEqual, type CardKind } from '../view-state.ts'

export interface ComputerToolsSnapshot {
  status: StatusPayload | null
  draft: DesiredState | null
  load: 'loading' | 'ready' | 'error'
  error: string | null
  busy: boolean
  /** Card currently installing its packages, for the row's own busy state. */
  installing: CardKind | null
  /** Card whose packages were just installed successfully. */
  justInstalled: CardKind | null
  /** A driver restart is in flight (permissions are about to be re-read). */
  restartingDriver: boolean
}

const empty: ComputerToolsSnapshot = {
  status: null,
  draft: null,
  load: 'loading',
  error: null,
  busy: false,
  installing: null,
  justInstalled: null,
  restartingDriver: false,
}

export class ComputerToolsController {
  private snapshot: ComputerToolsSnapshot = empty
  private readonly listeners = new Set<() => void>()
  private disposed = false

  getSnapshot = (): ComputerToolsSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async reload(): Promise<void> {
    this.publish({ load: 'loading', error: null })
    try {
      const status = await getResult<StatusPayload>(STATUS_PATH)
      this.publish({ status, draft: structuredClone(status.current), load: 'ready' })
    } catch (error) {
      this.publish({ load: 'error', error: messageOf(error) })
    }
  }

  /** Refresh status without discarding unsaved edits (used after install). */
  async refresh(): Promise<void> {
    try {
      const status = await getResult<StatusPayload>(STATUS_PATH)
      this.publish({ status, load: 'ready' })
    } catch (error) {
      this.publish({ error: messageOf(error) })
    }
  }

  setDraft(kind: CardKind, mutator: (draft: DesiredState) => void): void {
    const current = this.snapshot.draft
    if (current === null) return
    const next = structuredClone(current)
    mutator(next)
    this.publish({ draft: next, error: null, justInstalled: null })
  }

  discardCard(kind: CardKind): void {
    const { status, draft } = this.snapshot
    if (status === null || draft === null) return
    this.publish({
      draft: { ...draft, [kind]: structuredClone(status.current[kind]) },
      error: null,
      justInstalled: null,
    })
  }

  cardDirty(kind: CardKind): boolean {
    const { status, draft } = this.snapshot
    if (status === null || draft === null) return false
    return !partsEqual(draft[kind], status.current[kind])
  }

  cardValidationError(kind: CardKind): string | null {
    const draft = this.snapshot.draft
    if (draft === null) return null
    return kind === 'browser' ? validateBrowser(draft.browser) : validateComputer(draft.computer)
  }

  cardMissing(kind: CardKind): string[] {
    const { status, draft } = this.snapshot
    if (status === null || draft === null) return []
    const deps = Object.fromEntries(status.installedPackages.map((name) => [name, 'installed']))
    return missingPackages(narrowToCard(draft, kind), deps)
  }

  /**
   * Save one card. The other card is submitted as its last-saved state, so
   * unsaved edits on the other card are neither written nor lost.
   */
  async saveCard(kind: CardKind, takeover = false): Promise<ApplyResult> {
    const { status, draft } = this.snapshot
    if (status === null || draft === null) throw new Error('not loaded')
    const desired: DesiredState = {
      browser: kind === 'browser' ? draft.browser : status.current.browser,
      computer: kind === 'computer' ? draft.computer : status.current.computer,
    }
    this.publish({ busy: true, error: null })
    try {
      const result = await postJson<ApplyResult>(APPLY_PATH, {
        desired,
        expectedModifiedAt: status.modifiedAt,
        takeover,
      })
      if (result.ok && result.status) {
        const currentDraft = this.snapshot.draft
        const saved = result.status.current
        this.publish({
          status: result.status,
          justInstalled: null,
          draft: currentDraft === null
            ? structuredClone(saved)
            : {
              browser: kind === 'browser' ? structuredClone(saved.browser) : currentDraft.browser,
              computer: kind === 'computer' ? structuredClone(saved.computer) : currentDraft.computer,
            },
        })
      } else if (!result.ok && result.code !== 'takeover-required') {
        this.publish({ error: result.message ?? result.code })
      }
      return result
    } catch (error) {
      this.publish({ error: messageOf(error) })
      throw error
    } finally {
      this.publish({ busy: false })
    }
  }

  /**
   * Install the packages one card needs, then refresh status so the card can
   * be saved. The other card's unsaved draft is left untouched; this card keeps
   * its draft too, since installing is not saving.
   */
  async installCard(kind: CardKind): Promise<InstallResult> {
    const { draft } = this.snapshot
    this.publish({ installing: kind, error: null })
    try {
      const result = await postResult<InstallResult>(INSTALL_PATH, {
        card: kind,
        desired: draft ?? undefined,
      })
      if (!result.ok) {
        this.publish({ error: result.message ?? 'install failed' })
        return result
      }
      await this.refresh()
      // Only celebrate a run that actually added something.
      if (result.added.length > 0) this.publish({ justInstalled: kind })
      return result
    } catch (error) {
      this.publish({ error: messageOf(error) })
      return { ok: false, installed: [], added: [], message: messageOf(error) }
    } finally {
      this.publish({ installing: null })
    }
  }

  async openPrivacy(pane: 'accessibility' | 'screen'): Promise<void> {
    await postResult<{ opened: boolean; url: string }>(OPEN_PRIVACY_PATH, { pane })
  }

  /**
   * Restart the Cua Driver daemon. This is the remedy for the case where the
   * user granted permissions after the daemon started: TCC does not reach back
   * into a running process, so the old daemon keeps reporting the old answer.
   */
  async restartDriver(): Promise<ApplyResult> {
    this.publish({ restartingDriver: true, error: null })
    try {
      const result = await postJson<ApplyResult>(RESTART_DRIVER_PATH, {})
      if (result.ok && result.status) {
        this.publish({ status: result.status, load: 'ready' })
      } else if (!result.ok) {
        this.publish({ error: result.message ?? result.code ?? 'restart failed' })
      }
      return result
    } catch (error) {
      this.publish({ error: messageOf(error) })
      return { ok: false, code: 'io', message: messageOf(error) }
    } finally {
      this.publish({ restartingDriver: false })
    }
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  private publish(patch: Partial<ComputerToolsSnapshot>): void {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of [...this.listeners]) listener()
  }
}

function narrowToCard(draft: DesiredState, kind: CardKind): DesiredState {
  return kind === 'browser'
    ? { browser: draft.browser, computer: { enabled: false } }
    : { browser: { enabled: false }, computer: draft.computer }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function structuredClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
