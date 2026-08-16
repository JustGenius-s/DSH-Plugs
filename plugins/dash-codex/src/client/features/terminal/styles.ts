// Styles for the dash-codex Terminal panel.
//
// The plugin injects one <style data-plugin-css> tag (idempotent, HMR-friendly
// under the same contract DSH's own client bundles use) that contains both the
// xterm.js base CSS and the Warp-like block layout CSS.

import { XTERM_CSS } from './xterm-css'

const BLOCK_CSS = `
.dsh-warp-terminal{height:100%;display:flex;flex-direction:column;overflow:hidden;padding:8px 12px 12px;box-sizing:border-box;color:var(--dsw-alias-label-primary,#e6e6e8);font-family:Inter,var(--dsw-font-family,sans-serif)}
.dsh-warp-terminal-scroll{position:relative;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}
.dsh-warp-terminal-doc{position:relative;width:100%}
/* The viewport is a sticky, viewport-height layer pinned to the visible top of
   the scroll area. The canvas and the per-block overlays live inside it in the
   same (viewport-relative) coordinate space, so they stay aligned while the
   underlying document scrolls beneath. */
.dsh-warp-terminal-viewport{position:sticky;top:0;width:100%;pointer-events:none;overflow:hidden}
.dsh-warp-overlay-layer{position:absolute;inset:0;pointer-events:none;will-change:transform}
.dsh-warp-canvas{display:block;width:100%;height:100%;cursor:text;user-select:none;-webkit-user-select:none;outline:none;pointer-events:auto}
.dsh-warp-block-overlay{position:absolute;left:0;right:0;pointer-events:none}
.dsh-warp-block-overlay.dsh-warp-block-failed{background:rgba(248,113,113,.05);box-shadow:inset 2px 0 0 #f87171}
.dsh-warp-block-chrome{position:relative;display:flex;align-items:flex-start;gap:8px;padding:14px 2px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));pointer-events:auto}
.dsh-warp-block-chrome .dsh-warp-terminal-prompt-line{flex:1;min-width:0}
.dsh-warp-terminal-banner{display:flex;align-items:center;gap:10px;min-height:30px;padding:6px 10px;margin:0 0 8px;border:1px solid rgba(248,113,113,.35);border-radius:8px;background:rgba(248,113,113,.08);font-size:12px;color:var(--dsw-alias-label-primary,#e6e6e8)}
.dsh-warp-terminal-error{color:#f87171;font-size:12px}
.dsh-warp-terminal-reconnect{flex:none;height:24px;padding:0 10px;border:none;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;color:#fff;background:var(--dsw-alias-button-info-fill,#4176e6)}
.dsh-warp-terminal-reconnect:hover{background:var(--dsw-alias-button-info-hover,#679efe)}

.dsh-warp-terminal-block-actions{flex:none;display:flex;gap:2px;align-items:center;opacity:0;transition:opacity .12s ease}
.dsh-warp-block-overlay:hover .dsh-warp-terminal-block-actions{opacity:1}
.dsh-warp-terminal-prompt-line{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:clip;min-width:0;opacity:.85;user-select:text}
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
.dsh-warp-terminal-block-editing{border-bottom:none;padding-top:2px;padding-bottom:14px}
.dsh-warp-terminal-chips{display:flex;flex-wrap:wrap;gap:6px;padding:2px 2px 6px}
.dsh-warp-terminal-chip{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:6px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.08);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary,#b0b0b5);white-space:nowrap}
.dsh-warp-terminal-command-textarea{display:block;width:100%;box-sizing:border-box;resize:none;border:none;background:transparent;color:var(--dsw-alias-label-primary,#e6e6e8);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.6;outline:none;padding:0 2px}
.dsh-warp-terminal-command-textarea:disabled{opacity:.6}
.dsh-warp-terminal-editor-wrap{position:relative}
.dsh-warp-terminal-completion-menu{position:absolute;z-index:20;left:0;top:100%;min-width:220px;max-width:min(440px,100%);max-height:192px;overflow:auto;padding:4px;border:1px solid rgba(255,255,255,.14);border-radius:6px;background:#202024;box-shadow:0 8px 24px rgba(0,0,0,.32)}
.dsh-warp-terminal-completion-option{display:flex;width:100%;align-items:center;justify-content:space-between;gap:16px;padding:5px 8px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-primary,#e6e6e8);font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-align:left;cursor:pointer}
.dsh-warp-terminal-completion-option:hover,.dsh-warp-terminal-completion-option.is-selected{background:rgba(65,118,230,.28)}
.dsh-warp-terminal-completion-kind{flex:none;color:var(--dsw-alias-label-tertiary,#8b8b90);font-size:10px}
`

/** Inject the plugin + xterm styles once per page load. */
export function ensureWarpTerminalStyles(): void {
  if (typeof document === 'undefined') return
  const tagId = '@just-genius/dash-codex/terminal/styles.css'
  if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = '@just-genius/dash-codex'
  tag.dataset.pluginCss = tagId
  tag.textContent = XTERM_CSS + '\n' + BLOCK_CSS
  document.head.appendChild(tag)
}
