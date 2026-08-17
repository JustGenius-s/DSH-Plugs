/**
 * The side-panels contract: slot owner props plus the ambient declarations
 * consumers compile against.
 *
 * The feature declares the `side.panel` list slot (declaration = exclusive
 * render authority) and publishes the imperative `ctx.sidePanels` face.
 * Other plugins contribute panels by registering into `side.panel`; the
 * shell renders the tab strip and the active panel.
 */

export interface SidePanelOwnerProps {
  /** Current session id (panels are re-keyed off this on session switch). */
  sessionId: string
  /** The session's working directory, when known. */
  cwd?: string
  /**
   * Which instance of this panel is being rendered (`<panelId>#<n>`).
   *
   * A panel that declared `multi` can be mounted several times at once, so any
   * per-instance resource — a PTY, a socket, a scroll position — MUST be keyed
   * off this rather than off `sessionId` alone, or the instances will share it.
   * Single-instance panels can ignore it.
   */
  instanceKey?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * The imperative side-panels face: open/close/activate, plus `describe`
     * for a panel to report its own presentation facts (launcher glyph). The
     * outward face only; the store stays inside this feature.
     */
    sidePanels: import('./service').SidePanelsService
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One sidebar panel. List slot: each entry is one tab on the side panel
     * strip, ordered by `order`; the shell renders the active entry's
     * component through `renderSlot('side.panel', owner, { only: activeId })`.
     */
    'side.panel': {
      kind: 'list'
      scope: 'root'
      owner: SidePanelOwnerProps
    }
  }
}
