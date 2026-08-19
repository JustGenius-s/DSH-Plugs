import { injectStyles } from '@just-genius/dsh-plugin-ui'

const FILES_CSS = `
.dsh-files{height:100%;display:flex;flex-direction:column;min-height:0;color:var(--dsw-alias-label-primary,#e6e6e8);font-family:Inter,var(--dsw-font-family,sans-serif)}
.dsh-files-status{padding:16px 12px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#b0b0b5)}
.dsh-files-status.is-error{color:#f87171}
.dsh-files-tree{flex:1;min-height:0;display:flex;flex-direction:column}
.dsh-files-search{flex:none;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08))}
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
.dsh-files-status-badge{flex:none;min-width:18px;height:18px;padding:0 5px;border-radius:4px;font-size:11px;line-height:18px;text-align:center;background:rgba(152,195,121,.18);color:#98c379}
.dsh-files-status-badge.is-added{background:rgba(152,195,121,.18);color:#98c379}
.dsh-files-status-badge.is-modified{background:rgba(229,192,123,.18);color:#e5c07b}
.dsh-files-status-badge.is-deleted{background:rgba(224,108,117,.18);color:#e06c75}
.dsh-files-status-badge.is-renamed,.dsh-files-status-badge.is-copied{background:rgba(97,175,239,.18);color:#61afef}
.dsh-files-status-badge.is-untracked{background:rgba(86,182,194,.18);color:#56b6c2}
.dsh-files-status-badge.is-conflicted{background:rgba(198,120,221,.18);color:#c678dd}
.dsh-files-tree-diff{flex:none;display:flex;align-items:center;justify-content:center;width:24px;height:24px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,#8b8b90);cursor:pointer;opacity:0}
.dsh-files-tree-row:hover .dsh-files-tree-diff{opacity:1}
.dsh-files-tree-diff:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-files-preview,.dsh-files-diff{flex:1;min-height:0;overflow:auto}
.dsh-files-image{flex:1;min-height:0;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:16px}
.dsh-files-image img{max-width:100%;height:auto;border-radius:6px;background:repeating-conic-gradient(rgba(128,128,128,.18) 0% 25%,transparent 0% 50%) 0 0/16px 16px}
.dsh-files-preview .dsh-files-status,.dsh-files-diff .dsh-files-status{padding:16px 12px}
.dsh-files-tree-dir{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8b8b90)}
.dsh-files-tree-note{padding:4px 12px;font-size:12px;line-height:18px}
.dsh-files-view{position:relative;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:21px}
.dsh-files-code{padding:0 0 8px}
.dsh-files-code-line{display:flex;min-height:21px;padding-right:8px;white-space:pre}
.dsh-files-code-line:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-files-code-ln{flex:none;padding:0 8px 0 12px;text-align:right;color:var(--dsw-alias-label-tertiary,#8b8b90);user-select:none}
.dsh-files-code-text{flex:1;min-width:0;color:var(--dsw-alias-label-primary,#e6e6e8)}
.dsh-files-diff-body{padding:0 0 8px}
.dsh-files-diff-row{display:flex;min-height:21px;padding-right:8px;white-space:pre}
.dsh-files-diff-ln{flex:none;padding:0 6px 0 8px;text-align:right;color:var(--dsw-alias-label-tertiary,#8b8b90);user-select:none}
.dsh-files-diff-sign{flex:none;width:14px;text-align:center;user-select:none}
.dsh-files-diff-text{flex:1;min-width:0}
.dsh-files-diff-row.is-hunk{color:var(--dsw-alias-label-tertiary,#8b8b90);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-files-diff-row.is-ctx{color:var(--dsw-alias-label-secondary,#b0b0b5)}
.dsh-files-diff-row.is-add{color:#98c379;background:rgba(152,195,121,.12)}
.dsh-files-diff-row.is-del{color:#e06c75;background:rgba(224,108,117,.12)}
.dsh-files-diff-row.is-note{color:var(--dsw-alias-label-tertiary,#8b8b90);font-style:italic}
.dsh-files-expand{display:block;width:100%;min-height:28px;padding:0 12px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#8b8b90);font:inherit;font-size:13px;line-height:18px;text-align:left;cursor:pointer}
.dsh-files-expand:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
`

export function ensureFilesStyles(): void {
  injectStyles('@just-genius/dsh-codex', '@just-genius/dsh-codex/files/styles.css', FILES_CSS)
}
