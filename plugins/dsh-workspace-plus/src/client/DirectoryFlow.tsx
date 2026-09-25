/**
 * Directory-flow occupant: the multi-folder picker, as a renderless driver.
 *
 * DSH declares two directory-flow HOLES — `sidebar.workspaces.directoryFlow` and
 * `conversation.hero.workspace.directoryFlow` — as `single` slots, and it owns
 * both the trigger ("Add workspace…") and the ADOPTION: the occupant reports a
 * picked path, and the OWNER calls `createWorkspace({ path })` itself, then
 * targets a session at the resulting workspace.
 *
 * So the plugin OCCUPIES the hole rather than patching `pickDirectory`:
 *
 *   - Everything official is kept: the add affordance exists only while the hole
 *     is occupied, and the owner keeps the busy state, the retryable folder-error
 *     dialog, and "Choose again" (which reopens the hole).
 *   - What the plugin adds is the interaction between `open` and the picked path.
 *
 * This component is deliberately RENDERLESS, exactly like the official picker
 * backend it shadows: it drives the flow and reports the outcome, while the
 * dialog itself is mounted once in `shell.overlay` (`BindingDialog`). That split
 * is what lets ONE dialog serve both entry points:
 *
 *   - the hole (this file) for "Add workspace…", and
 *   - the project row menu's "Edit multi-folder…", which is not in any hole.
 *
 * Both go through the same single-request store in `flow.ts`, so only one dialog
 * can ever be pending — no double render, no second source of truth.
 *
 * The occupant is registered at a LOWER priority than the official picker
 * backends (which sit at the default 0), so the cell's lowest entry renders and
 * this one wins. Uninstalling the plugin drops the occupant and the official
 * picker is revealed again — nothing to undo.
 */

import { useEffect, useRef } from 'react'
import type { PropsRuntime } from '@just-genius/dsh-plugin-runtime/client'

import { DIRECTORY_FLOW_PRIORITY, DIRECTORY_FLOW_SLOTS } from './directory-flow-slots.ts'
import type { ConfirmDecision } from './flow.ts'
import { askCreateBinding } from './flow.ts'

export { DIRECTORY_FLOW_PRIORITY, DIRECTORY_FLOW_SLOTS }

export interface DirectoryFlowInjected {
  /**
   * Persist a confirmed multi-folder decision. Resolves once the binding and the
   * workspace title are durable, and rejects with a message to surface.
   */
  commit: (decision: ConfirmDecision & { kind: 'multi' }) => Promise<void>
}

export type DirectoryFlowProps = PropsRuntime<'sidebar.workspaces.directoryFlow'> & DirectoryFlowInjected

export function DirectoryFlow(props: DirectoryFlowProps) {
  const { open } = props

  /**
   * The owner's callbacks, read through a ref.
   *
   * A flow occurrence must survive the owner re-rendering: if this effect were
   * keyed on the callbacks, a changed identity mid-flow would tear the chain
   * down and the `started` guard would block re-arming it — the dialog would
   * settle while neither `onPicked` nor `onCancel` ever fired, leaving the
   * owner's flow open forever. Keying on `open` alone and reading the latest
   * callbacks is what keeps one occurrence one occurrence.
   */
  const latest = useRef(props)
  latest.current = props

  // One open→settle cycle: the guard keeps the owner's re-entrant renders from
  // asking for a second decision.
  const started = useRef(false)

  useEffect(() => {
    if (!open) {
      started.current = false
      return
    }
    if (started.current) return
    started.current = true
    let alive = true

    void askCreateBinding().then((decision) => {
      if (!alive) return
      if (decision.kind === 'current') {
        // Dismissed: the owner only needs to close the flow. No pick is reported,
        // so nothing is adopted and no error dialog opens.
        latest.current.onCancel()
        return
      }
      // Hand the primary folder back; the OWNER adopts it. Its failures surface
      // through the owner's own folder-error dialog, so nothing is reported here.
      latest.current.onPicked(decision.primaryPath)
      void latest.current.commit(decision).catch((error: unknown) => {
        // The workspace itself is created by the owner, so a binding failure must
        // be reported as exactly that and must not read as "not created".
        console.warn('[dsh-workspace-plus] multi-folder binding failed', error)
        if (!alive) return
        latest.current.onError(error instanceof Error ? error.message : String(error))
      })
    })

    return () => { alive = false }
  }, [open])

  // Renderless: the dialog lives in shell.overlay, driven by the same store.
  return null
}

