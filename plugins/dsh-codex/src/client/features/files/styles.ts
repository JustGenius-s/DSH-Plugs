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
.dsh-files-tree-chevron{flex:none;width:14px;height:14px;color:var(--dsw-alias-label-tertiary,#8b8b90)}
.dsh-files-file-glyph,.dsh-files-folder-glyph{flex:none;width:16px;height:16px;display:flex;align-items:center;justify-content:center}
.dsh-files-file-glyph svg,.dsh-files-folder-glyph svg{width:16px;height:16px;display:block}
.dsh-files-tree-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
/* Preview/diff hosts fill the panel; the inner .dsh-files-view owns both
   vertical (virtualized) and horizontal scrolling so sticky gutters keep
   working against the same scrollport. */
.dsh-files-preview,.dsh-files-diff{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column}
.dsh-files-image{flex:1;min-height:0;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:16px}
.dsh-files-image img{max-width:100%;height:auto;border-radius:6px;background:repeating-conic-gradient(rgba(128,128,128,.18) 0% 25%,transparent 0% 50%) 0 0/16px 16px}
.dsh-files-preview .dsh-files-status,.dsh-files-diff .dsh-files-status{padding:16px 12px}
.dsh-files-tree-dir{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8b8b90)}
.dsh-files-tree-note{padding:4px 12px;font-size:12px;line-height:18px}
/* The view is the scrollport. Its content wrapper is height-sized to the full
   virtual list; width:max-content on the painted window keeps sticky gutters
   pinned across horizontal scroll the same way the pre-virtual layout did. */
.dsh-files-view{flex:1;min-height:0;overflow:auto;position:relative;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:21px}
.dsh-files-code,.dsh-files-diff-body{position:relative;width:max-content;min-width:100%;padding:0 0 8px;box-sizing:content-box}
.dsh-files-virt-window{position:absolute;left:0;width:max-content;min-width:100%}
.dsh-files-expand-slot{position:absolute;left:0;right:0;width:100%}
.dsh-files-code-line{display:flex;min-height:21px;padding-right:8px;white-space:pre}
.dsh-files-code-line:hover{background:var(--dsw-alias-interactive-bg-hover)}
/* The gutter is sticky and opaque: code scrolls horizontally UNDER it. The
   background must be solid — the panel sits on --dsw-specific-sidebar-fill, and the
   translucent hover tint is composited over it with a gradient layer so the
   gutter never shows the text sliding beneath. */
.dsh-files-code-ln{position:sticky;left:0;z-index:1;flex:none;padding:0 8px 0 12px;text-align:right;color:var(--dsw-alias-label-tertiary,#8b8b90);user-select:none;background:var(--dsw-specific-sidebar-fill)}
.dsh-files-code-line:hover .dsh-files-code-ln{background:linear-gradient(var(--dsw-alias-interactive-bg-hover),var(--dsw-alias-interactive-bg-hover)),var(--dsw-specific-sidebar-fill)}
.dsh-files-code-text{flex:1;min-width:0;color:var(--dsw-alias-label-primary,#e6e6e8)}
.dsh-files-diff-row{display:flex;min-height:21px;padding-right:8px;white-space:pre}
/* Same sticky trick for the diff gutter (old ln + new ln + sign ride one
   pinned wrapper); tinted rows composite their tint over the panel base so
   the gutter matches the row while staying opaque. */
.dsh-files-diff-gutter{position:sticky;left:0;z-index:1;flex:none;display:flex;background:var(--dsw-specific-sidebar-fill)}
.dsh-files-diff-row.is-hunk .dsh-files-diff-gutter{background:linear-gradient(var(--dsw-alias-interactive-bg-hover),var(--dsw-alias-interactive-bg-hover)),var(--dsw-specific-sidebar-fill)}
.dsh-files-diff-row.is-add .dsh-files-diff-gutter{background:linear-gradient(rgba(31,122,55,.12),rgba(31,122,55,.12)),var(--dsw-specific-sidebar-fill)}
.dsh-files-diff-row.is-del .dsh-files-diff-gutter{background:linear-gradient(rgba(248,81,73,.12),rgba(248,81,73,.12)),var(--dsw-specific-sidebar-fill)}
.dsh-files-diff-ln{flex:none;padding:0 6px 0 8px;text-align:right;color:var(--dsw-alias-label-tertiary,#8b8b90);user-select:none}
.dsh-files-diff-sign{flex:none;width:14px;text-align:center;user-select:none}
.dsh-files-diff-text{flex:1;min-width:0}
.dsh-files-diff-row.is-hunk{color:var(--dsw-alias-label-tertiary,#8b8b90);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-files-diff-row.is-ctx{color:var(--dsw-alias-label-secondary,#b0b0b5)}
.dsh-files-diff-row.is-add{color:#116329;background:rgba(31,122,55,.12)}
.dsh-files-diff-row.is-del{color:#a40e26;background:rgba(248,81,73,.12)}
.dsh-files-diff-row.is-note{color:var(--dsw-alias-label-tertiary,#8b8b90);font-style:italic}
.dsh-files-expand{display:block;width:100%;min-height:28px;padding:0 12px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#8b8b90);font:inherit;font-size:13px;line-height:18px;text-align:left;cursor:pointer}
.dsh-files-expand:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}

/* Shiki dual-theme flip: highlighted tokens carry the light literal color
   inline plus a --shiki-dark custom property (see highlight.ts); under the
   app's dark marker the dark value wins. !important beats the inline style.
   Covers both the file preview and the diff view. */
body[data-ds-dark-theme] .dsh-files-code-text span,body[data-ds-dark-theme] .dsh-files-diff-text span{color:var(--shiki-dark)!important}

/* Dark restatement of the status/diff palette (One Dark values). */
body[data-ds-dark-theme] .dsh-files-status.is-error{color:#f87171}
body[data-ds-dark-theme] .dsh-files-status-badge{background:rgba(152,195,121,.18);color:#98c379}
body[data-ds-dark-theme] .dsh-files-status-badge.is-added{background:rgba(152,195,121,.18);color:#98c379}
body[data-ds-dark-theme] .dsh-files-status-badge.is-modified{background:rgba(229,192,123,.18);color:#e5c07b}
body[data-ds-dark-theme] .dsh-files-status-badge.is-deleted{background:rgba(224,108,117,.18);color:#e06c75}
body[data-ds-dark-theme] .dsh-files-status-badge.is-renamed,body[data-ds-dark-theme] .dsh-files-status-badge.is-copied{background:rgba(97,175,239,.18);color:#61afef}
body[data-ds-dark-theme] .dsh-files-status-badge.is-untracked{background:rgba(86,182,194,.18);color:#56b6c2}
body[data-ds-dark-theme] .dsh-files-status-badge.is-conflicted{background:rgba(198,120,221,.18);color:#c678dd}
body[data-ds-dark-theme] .dsh-files-diff-row.is-add{color:#98c379;background:rgba(152,195,121,.12)}
body[data-ds-dark-theme] .dsh-files-diff-row.is-del{color:#e06c75;background:rgba(224,108,117,.12)}
body[data-ds-dark-theme] .dsh-files-diff-row.is-add .dsh-files-diff-gutter{background:linear-gradient(rgba(152,195,121,.12),rgba(152,195,121,.12)),var(--dsw-specific-sidebar-fill)}
body[data-ds-dark-theme] .dsh-files-diff-row.is-del .dsh-files-diff-gutter{background:linear-gradient(rgba(224,108,117,.12),rgba(224,108,117,.12)),var(--dsw-specific-sidebar-fill)}

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
