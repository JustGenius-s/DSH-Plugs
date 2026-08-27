import { injectStyles } from '@just-genius/dsh-plugin-ui'

const FILES_CSS = `
.dsh-files{height:100%;display:flex;flex-direction:column;min-height:0;color:var(--dsw-alias-label-primary,#e6e6e8);font-family:Inter,var(--dsw-font-family,sans-serif)}
.dsh-files-status{padding:16px 12px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#b0b0b5)}
.dsh-files-status.is-error{color:#cf222e}
.dsh-files-tree{flex:1;min-height:0;display:flex;flex-direction:column}
.dsh-files-search{flex:none;padding:6px 8px}
.dsh-files-search-input{display:flex;width:100%;box-sizing:border-box}
.dsh-files-search-input input{width:100%;min-width:0;height:30px;font-size:13px}
.dsh-files-tree-list{flex:1;min-height:0;overflow:auto;padding:4px 0}
.dsh-files-tree-row{display:flex;align-items:center;gap:2px;padding-right:4px}
.dsh-files-tree-row-main{flex:1;min-width:0;display:flex;align-items:center;gap:4px;min-height:30px;padding:0 6px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:20px;text-align:left;cursor:pointer}
.dsh-files-tree-row-main:hover{background:var(--dsw-alias-interactive-bg-hover)}
/* Gitignored rows: lightly dimmed (secondary label), not VS Code's hard
   #8C8C8C grey which reads too dead next to our primary ink. */
.dsh-files-tree-row.is-ignored .dsh-files-tree-name,
.dsh-files-tree-row.is-ignored .dsh-files-tree-chevron,
.dsh-files-tree-row.is-ignored .dsh-files-tree-dir{color:var(--dsw-alias-label-tertiary,#8b8b90)}
.dsh-files-tree-row.is-ignored .dsh-files-file-glyph,
.dsh-files-tree-row.is-ignored .dsh-files-folder-glyph{opacity:.78}
.dsh-files-tree-chevron{flex:none;width:14px;height:14px;color:var(--dsw-alias-label-tertiary,#8b8b90)}
.dsh-files-file-glyph,.dsh-files-folder-glyph{flex:none;width:16px;height:16px;display:flex;align-items:center;justify-content:center}
.dsh-files-file-glyph svg,.dsh-files-folder-glyph svg{width:16px;height:16px;display:block}
.dsh-files-tree-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-files-menu-anchor{position:fixed;width:0;height:0;pointer-events:none}
/* Status badges and diff tints default to the LIGHT palette (GitHub-light
   flavored); the data-ds-dark-theme block at the end restates them in the
   original One Dark values. */
.dsh-files-status-badge{flex:none;min-width:18px;height:18px;padding:0 5px;border-radius:4px;font-size:11px;line-height:18px;text-align:center;background:rgba(31,122,55,.14);color:#116329}
.dsh-files-status-badge.is-added{background:rgba(31,122,55,.14);color:#116329}
.dsh-files-status-badge.is-modified{background:rgba(154,103,0,.14);color:#9a6700}
.dsh-files-status-badge.is-deleted{background:rgba(248,81,73,.14);color:#cf222e}
.dsh-files-status-badge.is-renamed,.dsh-files-status-badge.is-copied{background:rgba(9,105,218,.14);color:#0550ae}
.dsh-files-status-badge.is-untracked{background:rgba(31,122,55,.14);color:#116329}
.dsh-files-status-badge.is-conflicted{background:rgba(130,80,223,.14);color:#8250df}
/* Preview/diff hosts fill the panel; code wraps to the pane width like Codex
   Desktop, so the inner view only scrolls vertically. */
.dsh-files-preview,.dsh-files-diff{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column}
.dsh-files-code-shell{flex:1;min-height:0;display:flex;flex-direction:column;outline:none}
/* VS Code–style find widget above the code scrollport. */
.dsh-files-find{flex:none;display:flex;align-items:center;gap:4px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l,rgba(128,128,128,.16));background:var(--dsw-specific-sidebar-fill)}
.dsh-files-find-input{flex:1;min-width:0;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.2));border-radius:6px;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:28px;outline:none}
.dsh-files-find-input:focus{border-color:var(--dsw-alias-state-business-primary,#4176e6)}
.dsh-files-find-input.is-invalid{border-color:#cf222e}
.dsh-files-find-input::-webkit-search-cancel-button{display:none}
.dsh-files-find-toggles{flex:none;display:inline-flex;align-items:center;gap:1px;padding:1px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1))}
.dsh-files-find-toggle{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:24px;padding:0 5px;border:none;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary,#b0b0b5);font:inherit;font-size:11px;font-weight:600;line-height:1;letter-spacing:.02em;cursor:pointer}
.dsh-files-find-toggle:hover{color:var(--dsw-alias-label-primary)}
.dsh-files-find-toggle.is-active{background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-state-business-primary,#4176e6);box-shadow:0 0 0 1px rgba(65,118,230,.35)}
/* Whole-word: |ab| — VS Code word-boundary bars, not bare "ab" (reads as case). */
.dsh-files-find-whole{display:inline-flex;align-items:center;gap:2px;font:inherit;font-size:inherit;font-weight:inherit;line-height:1;letter-spacing:inherit}
.dsh-files-find-whole-bar{display:inline-block;width:1.5px;height:11px;border-radius:1px;background:currentColor;opacity:.85}
.dsh-files-find-count{flex:none;min-width:4.5em;padding:0 4px;font-size:12px;line-height:18px;text-align:center;color:var(--dsw-alias-label-tertiary,#8b8b90);white-space:nowrap}
.dsh-files-find-count.is-invalid{color:#cf222e}
.dsh-files-find-btn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#b0b0b5);cursor:pointer}
.dsh-files-find-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-files-find-btn:disabled{opacity:.4;cursor:default}
.dsh-files-code-text .dsh-files-find-hit{background:rgba(234,179,8,.38);border-radius:2px}
.dsh-files-code-text .dsh-files-find-active{background:rgba(249,115,22,.55);border-radius:2px}
.dsh-files-code-line.is-find-active-line{background:rgba(249,115,22,.08)}
body[data-ds-dark-theme] .dsh-files-find-input{background:rgba(255,255,255,.06)}
body[data-ds-dark-theme] .dsh-files-find-input.is-invalid{border-color:#f87171}
body[data-ds-dark-theme] .dsh-files-find-toggle.is-active{background:rgba(255,255,255,.1);color:#79a8ff;box-shadow:0 0 0 1px rgba(121,168,255,.4)}
body[data-ds-dark-theme] .dsh-files-find-count.is-invalid{color:#f87171}
body[data-ds-dark-theme] .dsh-files-code-text .dsh-files-find-hit{background:rgba(234,179,8,.28)}
body[data-ds-dark-theme] .dsh-files-code-text .dsh-files-find-active{background:rgba(249,115,22,.45)}
body[data-ds-dark-theme] .dsh-files-code-line.is-find-active-line{background:rgba(249,115,22,.12)}
.dsh-files-image{flex:1;min-height:0;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:16px}
.dsh-files-image img{max-width:100%;height:auto;border-radius:6px;background:repeating-conic-gradient(rgba(128,128,128,.18) 0% 25%,transparent 0% 50%) 0 0/16px 16px}
.dsh-files-preview .dsh-files-status,.dsh-files-diff .dsh-files-status{padding:16px 12px}
.dsh-files-tree-dir{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8b8b90)}
.dsh-files-tree-note{padding:4px 12px;font-size:12px;line-height:18px}
/* Wrapped rows stay in normal flow because their height depends on pane width. */
.dsh-files-view{flex:1;min-height:0;min-width:0;overflow-y:auto;overflow-x:hidden;position:relative;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:21px}
.dsh-files-code,.dsh-files-diff-body{position:relative;width:100%;min-width:0;padding:0 0 8px;box-sizing:border-box}
.dsh-files-expand-slot{width:100%;padding:8px;box-sizing:border-box}
.dsh-files-code-entry,.dsh-files-diff-entry{width:100%;min-width:0}
.dsh-files-code-line{display:flex;align-items:flex-start;width:100%;min-width:0;min-height:21px;padding-right:8px;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
.dsh-files-code-line:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-files-code-line.is-comment-selected{background:rgba(49,105,218,.10)}
/* The line number stays aligned with the first visual row after wrapping. */
.dsh-files-code-ln{flex:none;position:relative;padding:0 8px 0 12px;text-align:right;color:var(--dsw-alias-label-tertiary,#8b8b90);user-select:none;background:var(--dsw-specific-sidebar-fill)}
.dsh-files-code-line:hover .dsh-files-code-ln{background:linear-gradient(var(--dsw-alias-interactive-bg-hover),var(--dsw-alias-interactive-bg-hover)),var(--dsw-specific-sidebar-fill)}
.dsh-files-code-line.is-comment-selected .dsh-files-code-ln{background:linear-gradient(rgba(49,105,218,.10),rgba(49,105,218,.10)),var(--dsw-specific-sidebar-fill)}
.dsh-files-code-text{flex:1;min-width:0;color:var(--dsw-alias-label-primary,#e6e6e8)}
.dsh-files-diff-row{display:flex;align-items:flex-start;width:100%;min-width:0;min-height:21px;padding-right:8px;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
/* Codex/Pierre gutter utility: the square comment button is mounted inside
   the line-number cell and overlays its number instead of taking a column. */
.dsh-files-comment-add{appearance:none;position:absolute;z-index:4;top:0;right:8px;display:flex;align-items:center;justify-content:center;width:21px;height:21px;padding:0;border:none;border-radius:4px;background:#111;color:#fff;cursor:pointer;opacity:0}
.dsh-files-code-line:hover .dsh-files-comment-add,.dsh-files-diff-row:hover .dsh-files-comment-add,.dsh-files-comment-add:focus-visible{opacity:1}
.dsh-files-comment-add:hover{background:#2a2a2a}
.dsh-files-comment-add:focus-visible{outline:2px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#2563eb) 45%,transparent);outline-offset:1px}
/* One active-side line number with the change indicator at its left edge. */
.dsh-files-diff-gutter{flex:none;display:flex;background:var(--dsw-specific-sidebar-fill)}
.dsh-files-diff-row.is-add .dsh-files-diff-gutter{background:linear-gradient(rgba(0,162,64,.10),rgba(0,162,64,.10)),var(--dsw-specific-sidebar-fill)}
.dsh-files-diff-row.is-del .dsh-files-diff-gutter{background:linear-gradient(rgba(224,46,42,.10),rgba(224,46,42,.10)),var(--dsw-specific-sidebar-fill)}
.dsh-files-diff-ln{flex:none;position:relative;padding:0 8px 0 12px;text-align:right;color:var(--dsw-alias-label-tertiary,#8b8b90);user-select:none}
.dsh-files-diff-mark{flex:none;align-self:stretch;width:4px;min-height:21px;background:transparent}
.dsh-files-diff-row.is-add .dsh-files-diff-mark{background:#00a240}
.dsh-files-diff-row.is-del .dsh-files-diff-mark{background-color:transparent;background-image:linear-gradient(0deg,rgba(224,46,42,.10) 50%,#e02e2a 50%);background-repeat:repeat;background-position:0 0;background-size:2px 2px;background-size:calc(1lh / round(1lh / 2px)) calc(1lh / round(1lh / 2px))}
.dsh-files-diff-text{flex:1;min-width:0;padding-left:7px;color:var(--dsw-alias-label-primary,#e6e6e8)}
/* Codex/Pierre line-info separator: raw @@ metadata is replaced by the
   actual count of unchanged lines omitted between the rendered hunks. */
.dsh-files-diff-row.is-hunk{display:flex;align-items:stretch;width:auto;min-height:24px;height:24px;margin:8px;padding:0;border:none;border-radius:6px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-interactive-bg-hover));overflow:hidden}
.dsh-files-diff-row.is-hunk .dsh-files-diff-gutter{display:none}
.dsh-files-diff-row.is-hunk .dsh-files-diff-text{display:flex;align-self:stretch;align-items:center;min-width:0;height:24px;padding:0 1ch;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary,#8b8b90);font-family:var(--dsw-font-family,Inter,sans-serif);font-size:12px;line-height:18px}
.dsh-files-diff-row.is-ctx{color:var(--dsw-alias-label-primary,#e6e6e8)}
.dsh-files-diff-row.is-add{background:rgba(0,162,64,.10)}
.dsh-files-diff-row.is-del{background:rgba(224,46,42,.10)}
.dsh-files-diff-row.is-comment-selected{box-shadow:inset 0 0 0 999px rgba(49,105,218,.10)}
.dsh-files-diff-row.is-note{color:var(--dsw-alias-label-tertiary,#8b8b90);font-style:italic}
/* Codex/Pierre unified hunk separator: a dedicated 32px expand control and a
   separate rounded information strip, split by the diff surface behind it. */
.dsh-files-expand{display:flex;align-items:stretch;width:100%;min-width:0;min-height:24px;padding:0;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#8b8b90);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer}
.dsh-files-expand-control{display:flex;flex:none;align-items:center;justify-content:center;width:32px;border-radius:6px 0 0 6px;border-right:2px solid var(--dsw-specific-sidebar-fill);background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-tertiary,#8b8b90)}
.dsh-files-expand-label{display:flex;flex:1;min-width:0;align-items:center;padding:0 1ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:0 6px 6px 0;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-tertiary,#8b8b90)}
.dsh-files-expand:hover .dsh-files-expand-control,.dsh-files-expand:hover .dsh-files-expand-label{color:var(--dsw-alias-label-primary)}
.dsh-files-expand:hover .dsh-files-expand-label{text-decoration:underline}
.dsh-files-expand:focus-visible{outline:2px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#2563eb) 45%,transparent);outline-offset:2px;border-radius:6px}

/* Shiki dual-theme flip: highlighted tokens carry the light literal color
   inline plus a --shiki-dark custom property (see highlight.ts); under the
   app's dark marker the dark value wins. !important beats the inline style.
   Covers both the file preview and the diff view. */
/* Only flip spans that carry an inline style (Shiki tokens). Find-overlay
   pieces without token styles must inherit the line color. */
body[data-ds-dark-theme] .dsh-files-code-text span[style],body[data-ds-dark-theme] .dsh-files-diff-text span[style]{color:var(--shiki-dark)!important}

/* Dark restatement of status badges plus Codex diff semantic colors. */
body[data-ds-dark-theme] .dsh-files-status.is-error{color:#f87171}
body[data-ds-dark-theme] .dsh-files-status-badge{background:rgba(152,195,121,.18);color:#98c379}
body[data-ds-dark-theme] .dsh-files-status-badge.is-added{background:rgba(152,195,121,.18);color:#98c379}
body[data-ds-dark-theme] .dsh-files-status-badge.is-modified{background:rgba(229,192,123,.18);color:#e5c07b}
body[data-ds-dark-theme] .dsh-files-status-badge.is-deleted{background:rgba(224,108,117,.18);color:#e06c75}
body[data-ds-dark-theme] .dsh-files-status-badge.is-renamed,body[data-ds-dark-theme] .dsh-files-status-badge.is-copied{background:rgba(97,175,239,.18);color:#61afef}
body[data-ds-dark-theme] .dsh-files-status-badge.is-untracked{background:rgba(86,182,194,.18);color:#56b6c2}
body[data-ds-dark-theme] .dsh-files-status-badge.is-conflicted{background:rgba(198,120,221,.18);color:#c678dd}
body[data-ds-dark-theme] .dsh-files-diff-row.is-add{background:rgba(0,162,64,.14)}
body[data-ds-dark-theme] .dsh-files-diff-row.is-del{background:rgba(224,46,42,.14)}
body[data-ds-dark-theme] .dsh-files-diff-row.is-add .dsh-files-diff-gutter{background:linear-gradient(rgba(0,162,64,.14),rgba(0,162,64,.14)),var(--dsw-specific-sidebar-fill)}
body[data-ds-dark-theme] .dsh-files-diff-row.is-del .dsh-files-diff-gutter{background:linear-gradient(rgba(224,46,42,.14),rgba(224,46,42,.14)),var(--dsw-specific-sidebar-fill)}
body[data-ds-dark-theme] .dsh-files-diff-row.is-del .dsh-files-diff-mark{background-image:linear-gradient(0deg,rgba(224,46,42,.14) 50%,#e02e2a 50%)}
body[data-ds-dark-theme] .dsh-files-code-line.is-comment-selected{background:rgba(73,126,255,.14)}
body[data-ds-dark-theme] .dsh-files-comment-add{background:#f5f5f5;color:#111}
body[data-ds-dark-theme] .dsh-files-comment-add:hover{background:#dedede}

/* Inline review annotations reuse the DSH conversation composer's surface:
   input-major fill, dark-mode hairline, r22 geometry, and lv2 float shadow.
   Like the composer, the editable text area is transparent and borderless. */
.dsh-files-comment-annotation{width:100%;max-width:768px;min-width:0;padding:8px 8px 8px 12px;box-sizing:border-box;font-family:var(--dsw-font-family,Inter,sans-serif);white-space:normal}
.dsh-files-comment-surface{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2-darkmode-thin,var(--dsw-alias-border-l2,rgba(128,128,128,.12)));border-radius:22px;background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1,#fff));box-shadow:var(--dsw-shadow-lv2,0 6px 20px rgba(0,0,0,.10));overflow:hidden}
.dsh-files-comment-header{display:flex;align-items:center;gap:8px;min-width:0;padding:0 2px 2px}
.dsh-files-comment-author{font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dsh-files-comment-location{min-width:0;margin-left:auto;padding:1px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1));font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#777)}
.dsh-files-comment-input{display:block;width:100%;min-height:64px;max-height:140px;resize:none;box-sizing:border-box;padding:2px;border:none;border-radius:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;outline:none;overflow-y:auto}
.dsh-files-comment-input::placeholder{color:var(--dsw-alias-label-dimmed,var(--dsw-alias-label-tertiary,#8b8b90))}
.dsh-files-comment-error{padding:0 2px;font-size:12px;line-height:16px;color:var(--dsw-alias-state-error-primary,#cf222e)}
.dsh-files-comment-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-top:4px}
/* Submitted comments pinned under their line: compact read-only surface. */
.dsh-files-comment-annotation-pinned .dsh-files-comment-surface{box-shadow:none;border-radius:12px}
.dsh-files-comment-annotation-pinned .dsh-files-comment-header{padding-bottom:4px}
.dsh-files-comment-body{padding:0 2px;font-size:14px;line-height:22px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}

/* Review comments travel through the input machine as a visible @file:line
   reference (same shape as an @file mention). The summary pill sits in the
   composer's own attachment rail below, so no chip hiding is needed. */
.dsh-files-review-dock-anchor{display:none!important}
.dsh-files-review-composer-host{min-width:0;padding:4px 12px 0;font-family:var(--dsw-font-family,Inter,sans-serif)}
.dsh-files-review-rail{display:flex;flex-wrap:wrap;align-items:flex-start;gap:10px;width:100%;min-width:0}
/* One summary pill per comment attachment. Geometry matches the composer
   image-attachment chip (hairline --dsw-alias-border-l2-darkmode-thin, hover
   fill) rather than the borderless DSH Pill atom. Hover opens a content card
   ABOVE the pill; DSH Tooltip is string-only and HoverCard only opens right,
   so the card copies HoverCard tokens (244px, #2C2C2E, 12px radius, lv3). */
.dsh-files-review-hover-anchor{display:inline-flex;min-width:0;flex:none;position:relative}
.dsh-files-review-summary{box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 6px 0 8px;border:1px solid var(--dsw-alias-border-l2-darkmode-thin,rgba(128,128,128,.18));border-radius:13px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.10));color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:nowrap;flex:none}
.dsh-files-review-summary-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;height:16px;color:var(--dsw-alias-label-secondary)}
.dsh-files-review-summary-icon svg{width:16px;height:16px;display:block}
.dsh-files-review-summary-label{flex:none;white-space:nowrap}
.dsh-files-review-summary-remove{display:grid;place-items:center;flex:none;width:20px;height:20px;margin:0;padding:0;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary,#8b8b90);cursor:pointer}
.dsh-files-review-summary-remove:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-files-review-summary-remove:focus-visible{outline:2px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#2563eb) 40%,transparent);outline-offset:0}
.dsh-files-review-popover-card{--dsw-hovercard-bg:#2C2C2E;position:fixed;z-index:1100;box-sizing:border-box;width:244px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:hidden auto;padding:12px 16px;border-radius:12px;background:var(--dsw-hovercard-bg);box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,.28));color:#fff;font-family:var(--dsw-font-family,Inter,sans-serif)}
.dsh-files-review-popover{display:flex;flex-direction:column;gap:12px;min-width:0}
.dsh-files-review-preview{display:flex;flex-direction:column;gap:8px;min-width:0;padding:0}
.dsh-files-review-preview+.dsh-files-review-preview{padding-top:12px;border-top:1px solid rgba(255,255,255,.1)}
.dsh-files-review-preview-header{display:flex;align-items:center;gap:6px;min-width:0}
.dsh-files-review-preview-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:12px;line-height:18px;color:#fff}
.dsh-files-review-preview-loc{flex:none;font-size:12px;line-height:18px;color:rgba(255,255,255,.55);white-space:nowrap}
.dsh-files-review-body{margin:0;font-size:14px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere;color:#fff}

/* Sent comments sit above the untouched DSH user renderer. The rail mirrors
   the native userStack width/alignment, while the bubble below remains owned
   by ui-conversation (images, timestamp and actions included). */
.dsh-files-review-message{display:flex;flex-direction:column;align-items:stretch;gap:6px;min-width:0}
.dsh-files-review-message-rail{display:flex;flex-wrap:wrap;justify-content:flex-end;align-self:flex-end;gap:10px;min-width:0;width:min(525px,82%)}

/* Markdown file: a two-way toggle between the rendered preview and the raw
   source, above the pane. The toggle is a compact segmented control. */
.dsh-files-md{flex:1;min-height:0;min-width:0;display:flex;flex-direction:column}
.dsh-files-md-bar{flex:none;display:flex;align-items:center;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l,rgba(128,128,128,.16))}
.dsh-files-md-toggle{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1))}
.dsh-files-md-toggle button{display:inline-flex;align-items:center;height:24px;padding:0 10px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#b0b0b5);font:inherit;font-size:12px;line-height:24px;cursor:pointer}
.dsh-files-md-toggle button:hover{color:var(--dsw-alias-label-primary,#e6e6e8)}
.dsh-files-md-toggle button.is-active{background:var(--dsw-alias-bg-overlay,#ffffff);color:var(--dsw-alias-label-primary,#e6e6e8);box-shadow:0 1px 2px rgba(0,0,0,.08)}

/* Rendered markdown pane — aligned to DSH's markdown stylesheet
   (._markdown_1r4m5_5 for prose, .ydkMvW_code for code blocks and
   ._tableScroll_1r4m5_174 for tables), so sizes, the DeepSeek link blue and
   the code/table shapes match the conversation. */
.dsh-files-md-body{flex:1;min-height:0;overflow:auto;padding:12px 20px 24px;min-width:0;overflow-wrap:anywhere;font-family:var(--dsw-font-family,Inter,sans-serif);font-size:16px;line-height:28px;color:var(--dsw-alias-label-primary,#e6e6e8)}
.dsh-files-md-body>*:first-child,.dsh-files-md-body p:first-child{margin-top:0}
.dsh-files-md-body>*:last-child,.dsh-files-md-body p:last-child{margin-bottom:0}
.dsh-files-md-body strong{font-weight:600}
.dsh-files-md-body h1,.dsh-files-md-body h2,.dsh-files-md-body h3,.dsh-files-md-body h4,.dsh-files-md-body h5,.dsh-files-md-body h6{font-family:var(--dsw-font-family,Inter,sans-serif);color:var(--dsw-alias-label-primary,#e6e6e8)}
.dsh-files-md-body h1{font-size:24px;line-height:34px;font-weight:700;margin:32px 0 16px}
.dsh-files-md-body h2{font-size:22px;line-height:32px;font-weight:700;margin:32px 0 16px}
.dsh-files-md-body h3{font-size:20px;line-height:30px;font-weight:700;margin:32px 0 16px}
.dsh-files-md-body h4{font-size:16px;line-height:28px;font-weight:600;margin:16px 0}
.dsh-files-md-body h5,.dsh-files-md-body h6{font-size:16px;line-height:28px;font-weight:600;margin:16px 0}
.dsh-files-md-body p{margin:16px 0}
.dsh-files-md-body a{color:var(--dsw-alias-state-business-primary,#4176e6);text-decoration:none;border-left:3px solid rgb(255 255 255 / 0);border-right:3px solid rgb(255 255 255 / 0);border-top:2px solid rgb(255 255 255 / 0);border-bottom:2px solid rgb(255 255 255 / 0);margin-left:-3px;margin-right:-3px}
.dsh-files-md-body a:hover,.dsh-files-md-body a:focus{outline:none;text-decoration:underline var(--dsw-alias-state-business-primary,#4176e6)}
.dsh-files-md-body a:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary,#4176e6)}
.dsh-files-md-body :where(ul,ol){margin:16px 0;padding-left:18px}
.dsh-files-md-body li:not(:first-child){margin-top:6px}
.dsh-files-md-body li>:where(ul,ol){margin-top:4px}
.dsh-files-md-body li::marker{line-height:28px;color:var(--dsw-alias-label-secondary,#b0b0b5)}
.dsh-files-md-body hr{display:block;border:none;height:1px;margin:32px 0;background:var(--dsw-alias-border-l2,rgba(128,128,128,.1))}
.dsh-files-md-body blockquote{border-left:2px solid var(--dsw-alias-label-caption,#8b8b90);margin:16px 0 0;padding-left:14px}
.dsh-files-md-body img,.dsh-files-md-body video{max-width:100%;height:auto;border-radius:3px}

/* Inline code — DSH pill: markdown-inline-code background, monospace .875em. */
.dsh-files-md-body :not(pre)>code{display:inline-flex;align-items:center;box-sizing:border-box;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:.875em!important;background-color:var(--dsw-alias-markdown-inline-code,rgba(128,128,128,.1));border-radius:6px;padding:0 5px}
.dsh-files-md-body :where(h1,h2,h3,h4,h5,h6) code{font:inherit;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace)}

/* Task-list checkboxes (GFM): disabled inputs rendered from [ ]/[x].
   GitHub-style task items drop their bullet and let the checkbox take its
   place (no "·" left behind), so only the checkbox row keeps the marker
   suppressed. Slightly enlarged and nudged so it sits on the prose baseline
   instead of floating above it; the default checkbox otherwise looks tiny
   next to 16px text. */
.dsh-files-md-body li.task-list-item{list-style:none}
.dsh-files-md-body li input[type="checkbox"]{width:14px;height:14px;margin:0 6px 0 1px;vertical-align:-2px;accent-color:var(--dsw-alias-state-business-primary,#4176e6);cursor:default}

/* Tables — DSH horizontal-rule style: header bottom rule + row rules, packed
   cells, wide tables scroll horizontally inside the pane. */
.dsh-files-md-body table{border-collapse:collapse;width:max-content;max-width:max-content}
.dsh-files-md-body th{text-align:start;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.16));border-top:none;font-family:var(--dsw-font-family,Inter,sans-serif);font-size:15px;line-height:25px;font-weight:500;max-width:min(30vw,320px);min-width:100px}
.dsh-files-md-body td{padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.1));font-family:var(--dsw-font-family,Inter,sans-serif);font-size:15px;line-height:25px;font-weight:400;max-width:min(30vw,320px);min-width:100px}
.dsh-files-md-body th:first-child,.dsh-files-md-body td:first-child{padding-left:0}
.dsh-files-md-body td:last-child{padding-right:0}
.dsh-files-md-body table code{font-size:13px}

/* Code blocks — DSH .ydkMvW_code: markdown-code-block background, 12px radius,
   16px padding, app code font, 13px/22px, pre-wrap, no border. The Shiki inline
   background is overridden so every block takes the app token; the dark block
   re-declares the token (with a dark fallback) and flips the token colors. */
.dsh-files-md-body pre{margin:16px 0;padding:16px;border-radius:12px;background-color:var(--dsw-alias-markdown-code-block,#f9fafb);color:var(--dsw-alias-label-primary,#e6e6e8);font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:13px;line-height:22px;white-space:pre-wrap;word-break:break-word;overflow:auto}
.dsh-files-md-body pre code{background:none;padding:0}
.dsh-files-md-body pre.shiki{background-color:var(--dsw-alias-markdown-code-block,#f9fafb)!important}
body[data-ds-dark-theme] .dsh-files-md-body pre{background-color:var(--dsw-alias-markdown-code-block,#1a1d24)!important}
body[data-ds-dark-theme] .dsh-files-md-body pre.shiki{background-color:var(--dsw-alias-markdown-code-block,#1a1d24)!important;color:var(--shiki-dark)!important}
body[data-ds-dark-theme] .dsh-files-md pre.shiki span{color:var(--shiki-dark)!important}
`

export function ensureFilesStyles(): void {
  injectStyles('@just-genius/dsh-codex', '@just-genius/dsh-codex/files/styles.css', FILES_CSS)
}
