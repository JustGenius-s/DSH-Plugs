// Styles for the dsh-codex Terminal panel.
//
// The plugin injects one <style data-plugin-css> tag (idempotent, HMR-friendly
// under the same contract DSH's own client bundles use) that contains both the
// xterm.js base CSS and the Warp-like block layout CSS.

import { injectStyles } from '@just-genius/dsh-plugin-ui'
import { XTERM_CSS } from './xterm-css'

const BLOCK_CSS = `
.dsh-warp-terminal{height:100%;display:flex;flex-direction:column;overflow:hidden;padding:8px 12px 12px;box-sizing:border-box;color:var(--dsw-alias-label-primary,#e6e6e8);font-family:Inter,var(--dsw-font-family,sans-serif)}
.dsh-warp-terminal-scroll{position:relative;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;outline:none}
.dsh-warp-terminal-doc{position:relative;width:100%}
/* The viewport is a sticky, viewport-height layer pinned to the visible top of
   the scroll area. The canvas and the per-block overlays live inside it in the
   same (viewport-relative) coordinate space, so they stay aligned while the
   underlying document scrolls beneath. */
.dsh-warp-terminal-viewport{position:sticky;top:0;width:100%;pointer-events:none;overflow:hidden}
.dsh-warp-overlay-layer{position:absolute;inset:0;pointer-events:none;will-change:transform}
.dsh-warp-canvas{display:block;width:100%;height:100%;cursor:text;user-select:none;-webkit-user-select:none;outline:none;pointer-events:auto}
.dsh-warp-block-overlay{position:absolute;left:0;right:0;pointer-events:none}
.dsh-warp-block-overlay.dsh-warp-block-failed{background:rgba(248,113,113,.05)}
.dsh-warp-block-chrome{position:relative;display:flex;align-items:flex-start;gap:8px;padding:14px 2px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));pointer-events:auto}
.dsh-warp-block-chrome .dsh-warp-terminal-prompt-line{flex:1;min-width:0}
.dsh-warp-terminal-banner{display:flex;align-items:center;gap:10px;min-height:30px;padding:6px 10px;margin:0 0 8px;border:1px solid rgba(248,113,113,.35);border-radius:8px;background:rgba(248,113,113,.08);font-size:13px;color:var(--dsw-alias-label-primary,#e6e6e8)}
.dsh-warp-terminal-banner.is-reconnecting{border-color:rgba(229,192,123,.35);background:rgba(229,192,123,.08)}
.dsh-warp-terminal-error{color:#f87171;font-size:13px}
.dsh-warp-terminal-reconnecting{color:#e5c07b;font-size:13px}
.dsh-warp-terminal-reconnect{flex:none;height:24px;padding:0 10px;border:none;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;color:#fff;background:var(--dsw-alias-button-info-fill,#4176e6)}
.dsh-warp-terminal-reconnect:hover{background:var(--dsw-alias-button-info-hover,#679efe)}

.dsh-warp-terminal-block-actions{flex:none;display:flex;gap:2px;align-items:center;opacity:0;transition:opacity .12s ease}
.dsh-warp-block-overlay:hover .dsh-warp-terminal-block-actions{opacity:1}
.dsh-warp-terminal-prompt-line{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:clip;min-width:0;opacity:.85;user-select:text}
.dsh-warp-seg-version{color:#98c379}
.dsh-warp-seg-cwd{color:#61afef}
.dsh-warp-seg-branch{color:#c678dd}
.dsh-warp-seg-files{color:#e5c07b}
.dsh-warp-seg-adds{color:#98c379}
.dsh-warp-seg-dels{color:#e06c75}
.dsh-warp-seg-duration{color:var(--dsw-alias-label-tertiary,#8b8b90)}
.dsh-warp-terminal-iconbtn{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:6px;font-size:13px;line-height:1;cursor:pointer;color:var(--dsw-alias-label-secondary,#b0b0b5);background:transparent}
.dsh-warp-terminal-iconbtn:hover{background:rgba(255,255,255,.08);color:var(--dsw-alias-label-primary,#e6e6e8)}
.dsh-warp-terminal-iconbtn-kill{color:#f87171}
.dsh-warp-terminal-iconbtn-kill:hover{background:rgba(248,113,113,.15);color:#fca5a5}
/* The editor is the LAST block of the document (Warp-style): absolutely
   positioned at the doc's content end (inline top = totalRows * cellHeight),
   it sits right under the most recent output and rides the scroll with it,
   so a fresh terminal shows it near the top and a long transcript pushes it
   to the bottom edge. Absolute (not flow) because the sticky canvas viewport
   ahead of it consumes a viewport-height flow box; the doc's explicit height
   is extended by the editor's measured height to keep it reachable. No border — the block chrome above already separates runs. */
.dsh-warp-terminal-block-editing{position:absolute;left:0;right:0;z-index:4;border-bottom:none;padding-top:2px;padding-bottom:14px}
.dsh-warp-terminal-chips{display:flex;flex-wrap:wrap;gap:6px;padding:2px 2px 6px}
.dsh-warp-terminal-chip{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:6px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.08);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-secondary,#b0b0b5);white-space:nowrap}
.dsh-warp-terminal-command-textarea{position:relative;z-index:1;display:block;width:100%;box-sizing:border-box;resize:none;border:none;background:transparent;color:var(--dsw-alias-label-primary,#e6e6e8);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.6;outline:none;padding:0 2px;white-space:pre-wrap;overflow:hidden}
.dsh-warp-terminal-command-textarea:disabled{opacity:.6}
.dsh-warp-terminal-editor-wrap{position:relative;z-index:30}
.dsh-warp-terminal-ghost{position:absolute;inset:0;z-index:0;padding:0 2px;overflow:hidden;pointer-events:none;white-space:pre-wrap;word-wrap:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.6;color:transparent}
.dsh-warp-terminal-ghost-hint{color:var(--dsw-alias-label-tertiary,#8b8b90)}
.dsh-warp-terminal-ghost-accept{margin-left:8px;color:var(--dsw-alias-label-tertiary,#8b8b90);font-family:Inter,var(--dsw-font-family,sans-serif);font-size:11px}
/* The completion menu opens downward while the editor sits high in the
   viewport, and flips upward (-up) once the editor nears the bottom edge —
   the view computes the flip from the editor's on-screen position. */
.dsh-warp-terminal-completion-menu{position:absolute;z-index:40;left:0;top:100%;min-width:220px;max-width:min(440px,100%);max-height:192px;overflow:auto;padding:4px;border:1px solid rgba(255,255,255,.14);border-radius:6px;background:#202024;box-shadow:0 8px 24px rgba(0,0,0,.32)}
.dsh-warp-terminal-completion-menu-up{top:auto;bottom:100%}
.dsh-warp-terminal-completion-option{display:flex;width:100%;align-items:center;justify-content:space-between;gap:12px;padding:5px 8px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-primary,#e6e6e8);font:13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-align:left;cursor:pointer}
.dsh-warp-terminal-completion-option:hover,.dsh-warp-terminal-completion-option.is-selected{background:rgba(65,118,230,.28)}
.dsh-warp-terminal-completion-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-warp-terminal-completion-meta{flex:none;display:flex;align-items:center;gap:8px;min-width:0}
.dsh-warp-terminal-completion-desc{max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary,#8b8b90);font-size:11px}
.dsh-warp-terminal-completion-kind{flex:none;color:var(--dsw-alias-label-tertiary,#8b8b90);font-size:11px}
`

/** Inject the plugin + xterm styles once per page load. */
export function ensureWarpTerminalStyles(): void {
  injectStyles(
    '@just-genius/dsh-codex',
    '@just-genius/dsh-codex/terminal/styles.css',
    XTERM_CSS + '\n' + BLOCK_CSS,
  )
}
