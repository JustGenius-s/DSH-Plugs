// Styles for the dsh-codex side-panels feature.
//
// The shell injects one <style data-plugin-css> tag (idempotent). The layout
// squeeze is a single CSS variable consumed by #root; the sidebar itself is a
// fixed right column portalled from the shell.overlay layer.
//
// Surfaces, inks, borders and motion ride the same `--dsw-*` design tokens as
// DSH's own right-hand panel, so the panel tracks the active theme with no
// hardcoded colors. The model is ui-conversation's DetailsPanel — the native
// right-docked column with a header + close button — NOT the left sidebar:
// the details column fills `--dsw-alias-bg-base` and only the left nav column
// carries the `--dsw-specific-sidebar-fill` tint. Header padding (14/12/12),
// the 28px round close button and its hover fill come from that same sheet.
// The resize hit strip matches AppFrame's sidebar handle: an 8px, pill-less
// col-resize strip centered on the panel's left border.

const CSS = `
:root{--dsh-side-panels-width:0px}
#root{margin-right:var(--dsh-side-panels-width);transition:margin-right var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
body[data-dsh-side-panels-dragging] #root{transition:none}

/* Width (not display:none) is the collapse, matching AppFrame's
   grid-template-columns track: same slow duration and --ds-ease-in-out
   curve. The column stays mounted at width 0 so the squeeze and the
   panel slide as one piece. Overflow stays visible here so the 8px
   resize strip can hang 4px past the left border; the inner clip
   wrapper is what hides content as the track shrinks. */
.dsh-side-panels{position:fixed;top:0;right:0;bottom:0;z-index:40;display:flex;flex-direction:column;min-width:0;background:var(--dsw-alias-bg-base);border-left:1px solid var(--dsw-alias-border-l2);pointer-events:auto;font-family:var(--dsw-font-family);color:var(--dsw-alias-label-primary);transition:width var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-left-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-side-panels[data-collapsed]{border-left-color:transparent;pointer-events:none}
.dsh-side-panels-inner{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;height:100%;overflow:hidden}
.dsh-side-panels-resize{position:absolute;left:-4px;top:0;bottom:0;width:8px;cursor:col-resize;z-index:2;touch-action:none}
body[data-dsh-side-panels-dragging]{cursor:col-resize;user-select:none}
body[data-dsh-side-panels-dragging] .dsh-side-panels{transition:none}
/* Header height matches the CONVERSATION header (76px), not DetailsPanel (55px).
   Both are defensible in isolation, but this panel sits directly beside the
   conversation column, and their hairlines are one continuous horizontal line
   across the window — 55 vs 76 made that line visibly step down at the panel
   edge. DetailsPanel gets away with 55 because it is the third column, past
   the details divider, where no shared line is implied.
   Arithmetic: 14 (pad-top, DetailsPanel's own) + 28 (tallest child: the icon
   button) + 5 (pad-bottom) + 1 (hairline) = 74, with the 40px going ABOVE the
   row: DSH's tab labels sit low in their header, right above the active bar
   (its .tab uses padding-bottom:11 with the bar at bottom:1), not centred in
   the full height. Distributing the slack upwards reproduces that — the label
   lands ~10px above the bar instead of 36px away from it. The conversation header's own
   stack computes to 76, but its bottom hairline is drawn by an ::after pinned at
   bottom:1px rather than by the border itself, so the visible line sits above the
   box — 74 is the measured match, arrived at by eye against the running app. Content still starts at
   14px, so the tab labels stay on the conversation title's centre line; the
   extra room all goes below, which is what moves the hairline into place.
   Tabs are stretched, not centered: their active bar has to reach the bottom. */
.dsh-side-panels-header{display:flex;align-items:stretch;gap:8px;padding:40px 12px 5px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;box-sizing:border-box;-webkit-app-region:drag}
/* Desktop (Electron, titleBarStyle 'hiddenInset') turns the window's top strip
   into the drag region: DSH-Desktop injects -webkit-app-region:drag onto the
   sidebar logo row, the conversation <header>, and a 40px centerCol::before
   band. This panel is position:fixed over the window's top-right corner, so
   without claiming drag itself it would punch a dead hole in that strip — the
   window would stop dragging wherever the panel covers. Claiming it here keeps
   the whole top edge draggable; every interactive child opts back out below.
   Harmless in a plain browser, where the property is simply ignored.
   Note the injected rules key off the <header> ELEMENT, which the native right
   panel deliberately avoids (DetailsPanel is a div) — so this file, not the
   Desktop sheet, is the right place for a plugin-owned panel to declare it. */
.dsh-side-panels-header button,
.dsh-side-panels-header a,
.dsh-side-panels-header [role='button'],
.dsh-side-panels-header [role='tab'],
.dsh-side-panels-header [role='menuitem'],
.dsh-side-panels-header input,
.dsh-side-panels-header select{-webkit-app-region:no-drag}
/* Tab strip: one tab per open INSTANCE. Each tab is a row (icon + label +
   close), so the 2px active bar rides the wrapper while the label button and
   the close button stay separately clickable. */
/* No overflow scrolling here. The active bar is drawn by .dsh-side-panels-tab
   :after positioned in the header's bottom padding (bottom:-30px), which counts
   as overflow — with overflow-x:auto that painted an 8px scrollbar thumb in the
   strip (ui-theme/scrollbar.css styles every scroll container globally), showing
   up as a stray vertical bar between the last tab and the + button. A tab strip
   should not scroll anyway: tabs are few and each label already ellipsises, so
   visible overflow is the correct behaviour and also lets the bar paint. */
.dsh-side-panels-tabs{display:flex;align-items:stretch;gap:16px;flex:1;min-width:0;min-height:0}
/* Tab fills the header's content box and puts its active bar on the bottom
   edge. The old padding-bottom + negative margin-bottom trick came from
   ConversationRoot, where tabs own a row of their own; here they share a row
   with 28px controls, so the negative margin sank the tab out of alignment
   with them. Stretching instead keeps label and controls on one centre line. */
.dsh-side-panels-tab{flex:0 1 auto;min-width:0;position:relative;display:flex;align-items:center;gap:2px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.dsh-side-panels-tab:after{content:"";position:absolute;right:0;bottom:-4px;left:0;height:2px;border-radius:2px;background:transparent}
.dsh-side-panels-tab:hover{color:var(--dsw-alias-label-primary)}
.dsh-side-panels-tab-active{color:var(--dsw-alias-state-business-primary)}
.dsh-side-panels-tab-active:after{background:var(--dsw-alias-state-business-primary)}
.dsh-side-panels-tab-button{display:flex;min-width:0;align-items:center;gap:6px;border:none;background:transparent;padding:0;font-family:inherit;font-size:13px;line-height:16px;font-weight:500;color:inherit;cursor:pointer;white-space:nowrap}
/* Long labels ellipsise in place — the strip no longer scrolls, so the button
   must be allowed to shrink and the label to clip. */
.dsh-side-panels-tab-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-side-panels-tab-icon{display:inline-flex;flex:none;width:14px;height:14px;align-items:center;justify-content:center}
.dsh-side-panels-tab-icon>svg{width:14px;height:14px}
/* Bare glyph, not a button plate: no hover fill and no round background —
   hovering only brightens the ink. Sized to the 14px glyph it holds. */
.dsh-side-panels-tab-close{display:grid;place-items:center;flex:none;width:14px;height:14px;padding:0;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;opacity:0}
.dsh-side-panels-tab:hover .dsh-side-panels-tab-close{opacity:1}
.dsh-side-panels-tab-close:hover{color:var(--dsw-alias-label-primary)}

/* Header icon buttons (new-instance, close sidebar): the 28px round control
   from ui-conversation's DetailsPanel .close. */
.dsh-side-panels-icon-button{display:grid;flex:none;place-items:center;width:28px;height:28px;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-side-panels-icon-button:hover{background:var(--dsw-alias-interactive-bg-hover)}

/* New-instance menu: the DSH menu dropdown surface (Menu.module.css). */
.dsh-side-panels-add{position:relative;flex:none;display:flex}
.dsh-side-panels-add-menu{position:absolute;top:calc(100% + 4px);right:0;z-index:42;box-sizing:border-box;display:flex;flex-direction:column;min-width:164px;max-width:280px;padding:4px;border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3)}
.dsh-side-panels-add-item{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:4px 8px;border:none;border-radius:10px;background:transparent;cursor:pointer;font-family:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);text-align:left}
.dsh-side-panels-add-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-side-panels-add-icon{display:inline-flex;flex:none;width:16px;height:16px;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary)}
.dsh-side-panels-add-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-side-panels-body{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column}
/* Inactive panes stay mounted (state/PTY survive) but take no layout: [hidden]
   alone loses to the flex display below, so it is restated after it. */
.dsh-side-panels-pane{flex:1;min-height:0;display:flex;flex-direction:column}
.dsh-side-panels-pane>*{flex:1;min-height:0}
.dsh-side-panels-pane[hidden]{display:none}
/* Collapsed launcher: a titleless floating card in the top-right corner, one
   row per registered panel. A panel that already has open instances grows a
   chevron; the nested list is existing tabs, not a second copy of the catalog.
   Surface is the SIDEBAR fill, not the menu fill: this card stands in for the
   panel column itself while it is collapsed, so it belongs to the sidebar
   family rather than the transient-overlay family. It also keeps the card in
   the same tonal register as the rest of the chrome — sidebar-fill is one step
   off the base (dark 900 = rgb(27,27,28) over base 950 = rgb(21,21,23), i.e.
   correctly lighter as it rises), whereas the menu fill (layer-3 = rgb(53,54,56))
   is tuned for a short-lived dropdown and reads as a grey slab when parked
   persistently over the conversation.
   Geometry follows the menu dropdown (Menu.module.css) for the inverted
   hairline, r12 and shadow-lv3, but the two paddings are deliberately OFF that
   sheet: the card insets 12px (menu uses 4) and rows inset 4px vertical /
   8px horizontal (menu cells use 8/10). Rows keep min-h 40 and the 14/22 primary ink, so the row box is
   unchanged — the 4px only pulls its hover fill in tighter. */
/* Under the panel (z 40) so closing the column reveals the card the
   way AppFrame's collapsed rail is the same track, just narrower. */
.dsh-side-panels-launcher{position:fixed;top:68px;right:28px;z-index:39;box-sizing:border-box;display:flex;flex-direction:column;gap:0;width:220px;padding:12px;border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;background:var(--dsw-specific-sidebar-fill);box-shadow:var(--dsw-shadow-lv3);font-family:var(--dsw-font-family);pointer-events:auto;-webkit-app-region:no-drag}
.dsh-side-panels-launcher[data-hidden]{pointer-events:none}
.dsh-side-panels-launcher-group{display:flex;flex-direction:column;min-width:0}
/* One catalog row: label + optional chevron share a single flex line.
   Hover fill lives on the row so the chevron is not a second plate.
   appearance:none kills the UA button chrome if a class ever misses. */
.dsh-side-panels-launcher-row{display:flex;flex-direction:row;flex-wrap:nowrap;align-items:center;min-width:0;min-height:40px;padding:4px 8px;border-radius:10px}
.dsh-side-panels-launcher-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-side-panels-launcher-item{-webkit-app-region:no-drag;display:flex;align-items:center;gap:8px;flex:1 1 0;min-width:0;padding:0;border:none;border-radius:0;background:transparent;appearance:none;-webkit-appearance:none;cursor:pointer;font-family:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);text-align:left}
.dsh-side-panels-launcher-icon{display:inline-flex;flex:none;width:16px;height:16px;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary)}
.dsh-side-panels-launcher-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-side-panels-launcher-expand{-webkit-app-region:no-drag;display:inline-flex;flex:none;align-items:center;justify-content:center;width:16px;height:16px;margin-left:4px;padding:0;border:none;border-radius:0;background:transparent;appearance:none;-webkit-appearance:none;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-side-panels-launcher-expand:hover{background:transparent;color:var(--dsw-alias-label-primary)}
/* Native dropdown chevron: one glyph, 0.12s rotate, not an icon swap. */
.dsh-side-panels-launcher-expand svg{transition:transform .12s}
.dsh-side-panels-launcher-expand[aria-expanded=true] svg{transform:rotate(90deg)}
/* Accordion body uses the same track interpolation as AppFrame columns
   (0fr ↔ 1fr, slow + --ds-ease-in-out) so the nested tabs do not pop. */
.dsh-side-panels-launcher-tabs{display:grid;grid-template-rows:0fr;transition:grid-template-rows var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-side-panels-launcher-tabs[data-expanded]{grid-template-rows:1fr}
.dsh-side-panels-launcher-tabs-inner{display:flex;flex-direction:column;min-height:0;overflow:hidden;padding:0 0 4px 24px}
.dsh-side-panels-launcher-tab{-webkit-app-region:no-drag;display:flex;align-items:center;width:100%;min-height:32px;padding:2px 8px;border:none;border-radius:8px;background:transparent;cursor:pointer;font-family:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-side-panels-launcher-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}

@media (prefers-reduced-motion: reduce) {
  #root{transition:none}
  .dsh-side-panels{transition:none}
  .dsh-side-panels-launcher-expand svg{transition:none}
  .dsh-side-panels-launcher-tabs{transition:none}
}
`

/** Inject or refresh the shell stylesheet. Replacing textContent keeps HMR
 *  from leaving a stale tag that still matches the idempotent selector. */
export function ensureSidePanelStyles(): void {
  if (typeof document === 'undefined') return
  const tagId = 'dsh-codex/side-panels.css'
  const existing = document.querySelector(
    'style[data-plugin-css=' + JSON.stringify(tagId) + ']',
  )
  if (existing instanceof HTMLStyleElement) {
    existing.textContent = CSS
    return
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-codex'
  tag.dataset.pluginCss = tagId
  tag.textContent = CSS
  document.head.appendChild(tag)
}
