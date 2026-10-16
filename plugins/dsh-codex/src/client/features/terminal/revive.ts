// Headless revive for recorded still-running commands.
//
// The view-level replay only runs when its tab body mounts, and DockSurface
// mounts only the active body — so a command recorded on a background tab
// would not come back until the user clicked the tab. This reviver runs at
// feature activation instead: every recorded command gets its PTY respawned
// and replayed through a headless connection that then HOLDS the socket, so
// the host's detach grace timer cannot kill the session. When the tab's view
// finally mounts it awaits the claim and takes the session over — the host
// re-handshakes an attach for a known token, moving the live PTY to the new
// socket without killing it.

import { TerminalConnectionController } from './connection-controller'
import { pasteInputBytes } from './input-model'
import {
  forgetRunningCommand,
  isPageReload,
  listRunningCommands,
  type RunningCommandRecord,
  type RunningCommandStorage,
} from './running-command'

/** How long a headless revive may wait for ready+context before giving up. */
const REVIVE_CONNECT_TIMEOUT_MS = 20_000

export interface TerminalReviveHooks {
  /** The replayed command reached its block-end (it finished). */
  onFinished(): void
  /** The revived shell itself exited. */
  onExited(): void
}

export interface TerminalReviveSession {
  /** Resolves true once the command was submitted to the revived PTY. */
  readonly sent: Promise<boolean>
  dispose(): void
}

export type TerminalReviveSpawner = (
  terminalId: string,
  record: RunningCommandRecord,
  hooks: TerminalReviveHooks,
) => TerminalReviveSession

export interface TerminalReviveClaim {
  /**
   * Resolves true once the command was submitted to the revived PTY. False
   * means the headless revive failed and the view should replay the record
   * itself as a fallback.
   */
  readonly settled: Promise<boolean>
  /**
   * Hand the revived PTY to the mounting view: closes the headless socket so
   * the view's own attach becomes the session owner. Idempotent.
   */
  handoff(): void
}

export interface TerminalReviver {
  /** The claim for one official tab identity, if a headless revive owns it. */
  claimFor(terminalId: string): TerminalReviveClaim | undefined
  /** Stop every headless session and drop the owned records. */
  dispose(): void
}

function spawnReviveSession(
  terminalId: string,
  record: RunningCommandRecord,
  hooks: TerminalReviveHooks,
): TerminalReviveSession {
  let bracketedPaste = false
  const controller = new TerminalConnectionController({
    onMessage: message => {
      if (message.type === 'ready') {
        bracketedPaste = message.bracketedPaste
      } else if (message.type === 'block-end') {
        hooks.onFinished()
      } else if (message.type === 'exit') {
        hooks.onExited()
      }
    },
    onState: () => {},
    onMalformedMessage: () => {},
  })
  controller.connect({
    sessionId: terminalId,
    cwd: record.cwd === '' ? undefined : record.cwd,
    shell: record.shell,
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const sent = Promise.race([
    controller
      .waitUntilOperational()
      .then(() => {
        // Same single-buffer rule as the interactive editor: a multi-line
        // command is wrapped only when the line editor accepts mode ?2004.
        const wrap = record.command.includes('\n') && bracketedPaste
        return controller.send({
          type: 'input',
          data: pasteInputBytes(record.command, wrap) + '\n',
        })
      })
      .catch(() => false),
    new Promise<boolean>(resolve => {
      timer = setTimeout(() => resolve(false), REVIVE_CONNECT_TIMEOUT_MS)
    }),
  ]).then(ok => {
    if (timer !== undefined) clearTimeout(timer)
    return ok
  })
  return { sent, dispose: () => controller.dispose() }
}

export function createTerminalReviver(
  spawn: TerminalReviveSpawner = spawnReviveSession,
  storage?: RunningCommandStorage,
): TerminalReviver {
  interface Entry {
    claim: TerminalReviveClaim
    /** Idempotent session release shared by handoff, finish and teardown. */
    release(): void
  }
  const entries = new Map<string, Entry>()
  let disposed = false

  const cleanup = (terminalId: string): void => {
    const entry = entries.get(terminalId)
    if (entry === undefined) return
    entries.delete(terminalId)
    entry.release()
  }

  // A reload must not revive: the old PTYs are still alive under the host's
  // detach grace timer, so replaying would duplicate every command.
  if (!isPageReload()) {
    for (const [terminalId, record] of listRunningCommands(storage)) {
      const session = spawn(terminalId, record, {
        onFinished: () => {
          // The replayed command is done: nothing left to revive, and the
          // idle PTY may die with the detach grace timer.
          forgetRunningCommand(terminalId, storage)
          cleanup(terminalId)
        },
        onExited: () => {
          forgetRunningCommand(terminalId, storage)
          cleanup(terminalId)
        },
      })
      let released = false
      const entry: Entry = {
        release: () => {
          if (released) return
          released = true
          session.dispose()
        },
        claim: {
          settled: session.sent.then(sent => {
            if (!sent) {
              // The headless connect never became operational: drop it and
              // let the view (or the next launch) replay from the kept record.
              cleanup(terminalId)
            }
            return sent
          }),
          // Keep the entry after handoff: a later claimFor still reports the
          // successful revive, so a remounting view never replays a duplicate.
          handoff: () => entry.release(),
        },
      }
      entries.set(terminalId, entry)
    }
  }

  return {
    claimFor: terminalId => entries.get(terminalId)?.claim,
    dispose() {
      if (disposed) return
      disposed = true
      for (const [terminalId, entry] of [...entries]) {
        // Feature teardown stops terminals, so their revive records go too —
        // except during page unload, when forget is a no-op and the record
        // survives for the next launch.
        forgetRunningCommand(terminalId, storage)
        entry.release()
      }
      entries.clear()
    },
  }
}
