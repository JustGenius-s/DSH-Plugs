const GRAPH_CSS = `
.dsh-git-graph{height:100%;display:flex;flex-direction:column;min-height:0;color:var(--dsw-alias-label-primary,#e6e6e8);font-family:Inter,var(--dsw-font-family,sans-serif)}
.dsh-git-graph-filter{flex:none;display:flex;align-items:center;justify-content:flex-start;min-height:28px;padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08))}
.dsh-git-graph-filter-wrap{display:inline-flex;width:fit-content;max-width:min(220px,100%)}
.dsh-git-graph-filter-trigger{width:auto;max-width:100%;justify-content:flex-start;gap:6px}
.dsh-git-graph-filter-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:16px}
.dsh-git-graph-filter-pop{position:fixed;z-index:80;box-sizing:border-box;display:flex;flex-direction:column;min-width:220px;max-height:min(420px,70vh);padding:4px;border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3)}
.dsh-git-graph-filter-search{flex:none;padding:4px 4px 6px}
.dsh-git-graph-filter-query{display:flex;width:100%;box-sizing:border-box}
.dsh-git-graph-filter-query input{width:100%;min-width:0;height:28px;font-size:12px}
.dsh-git-graph-filter-list{flex:1;min-height:0;overflow:auto}
.dsh-git-graph-filter-group{padding:8px 8px 2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dsh-git-graph-filter-item{display:flex;align-items:center;gap:8px;width:100%;min-height:28px;padding:4px 8px;border:none;border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px;text-align:left;cursor:pointer}
.dsh-git-graph-filter-item:hover,.dsh-git-graph-filter-item.is-selected{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-git-graph-filter-item-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-git-graph-filter-check{flex:none;width:16px;height:16px;color:var(--dsw-alias-state-business-primary)}
.dsh-git-graph-filter-empty{padding:10px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-git-graph-body{flex:1;min-height:0;overflow:auto;position:relative}
.dsh-git-graph-status{padding:16px 12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#b0b0b5)}
.dsh-git-graph-status.is-error{color:#f87171}
.dsh-git-graph-list{position:relative;min-height:100%}
.dsh-git-graph-svg-clip{position:absolute;top:0;left:0;overflow:hidden;pointer-events:none}
.dsh-git-graph-svg{display:block;overflow:hidden}
.dsh-git-graph-row{display:grid;grid-template-columns:var(--dsh-git-graph-gutter,72px) minmax(0,1fr) 48px 52px 72px;height:32px;width:100%;border:0;padding:0;background:transparent;color:inherit;text-align:left;cursor:pointer}
.dsh-git-graph-row:hover,.dsh-git-graph-row.is-selected{background:rgba(255,255,255,.05)}
.dsh-git-graph-gutter{position:relative;overflow:hidden}
.dsh-git-graph-meta{min-width:0;display:flex;align-items:center;gap:6px;padding:0 6px 0 4px}
.dsh-git-graph-subject{min-width:0;flex:1;font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-git-graph-row.is-workdir .dsh-git-graph-subject{font-style:italic;color:var(--dsw-alias-label-secondary,#b0b0b5)}
.dsh-git-graph-badges{flex:none;display:flex;gap:4px;max-width:46%;overflow:hidden}
.dsh-git-graph-badge{flex:none;height:16px;padding:0 5px;border-radius:4px;font-size:10px;line-height:16px;white-space:nowrap;background:rgba(97,175,239,.18);color:#61afef}
.dsh-git-graph-badge.is-head{background:rgba(152,195,121,.2);color:#98c379}
.dsh-git-graph-badge.is-tag{background:rgba(229,192,123,.2);color:#e5c07b}
.dsh-git-graph-badge.is-remote{background:rgba(198,120,221,.18);color:#c678dd}
.dsh-git-graph-sha,.dsh-git-graph-date,.dsh-git-graph-author{min-width:0;align-self:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8b8b90)}
.dsh-git-graph-sha{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.dsh-git-graph-date{font-variant-numeric:tabular-nums}
.dsh-git-graph-author{padding-right:8px;color:var(--dsw-alias-label-secondary,#b0b0b5)}
.dsh-git-graph-detail{flex:none;max-height:42%;overflow:auto;border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));padding:6px 8px;color:var(--dsw-alias-label-secondary,#b0b0b5)}
.dsh-git-graph-detail-title{flex:none;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 2px 6px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-primary,#e6e6e8)}
.dsh-git-graph-detail-status{padding:6px 2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8b8b90)}
.dsh-git-graph-detail-status.is-error{color:#f87171}
.dsh-git-graph-detail-list{display:flex;flex-direction:column;gap:1px}
.dsh-git-graph-detail-group + .dsh-git-graph-detail-group{margin-top:6px}
.dsh-git-graph-detail-section{display:flex;align-items:center;gap:6px;padding:2px 4px 4px;font-size:11px;line-height:16px;font-weight:600;color:var(--dsw-alias-label-secondary,#b0b0b5)}
.dsh-git-graph-detail-section-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-git-graph-detail-section-count{flex:none;min-width:16px;padding:0 5px;border-radius:8px;text-align:center;font-size:10px;line-height:14px;background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-tertiary,#8b8b90)}
.dsh-git-graph-detail-action{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:5px;color:var(--dsw-alias-label-secondary,#b0b0b5);cursor:pointer;visibility:hidden}
.dsh-git-graph-detail-row:hover .dsh-git-graph-detail-action{visibility:visible}
.dsh-git-graph-detail-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary,#e6e6e8)}
.dsh-git-graph-detail-section-action{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#b0b0b5);cursor:pointer;visibility:hidden}
.dsh-git-graph-detail-section:hover .dsh-git-graph-detail-section-action{visibility:visible}
.dsh-git-graph-detail-section-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary,#e6e6e8)}
.dsh-git-graph-detail-row{display:flex;align-items:center;gap:6px;width:100%;min-height:26px;padding:0 4px;border:none;border-radius:6px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dsh-git-graph-detail-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-git-graph-detail-status{flex:none;min-width:18px;height:18px;padding:0 4px;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;line-height:18px;text-align:center;background:rgba(152,195,121,.18);color:#98c379}
.dsh-git-graph-detail-status.is-added{background:rgba(152,195,121,.18);color:#98c379}
.dsh-git-graph-detail-status.is-modified{background:rgba(229,192,123,.18);color:#e5c07b}
.dsh-git-graph-detail-status.is-deleted{background:rgba(224,108,117,.18);color:#e06c75}
.dsh-git-graph-detail-status.is-renamed,.dsh-git-graph-detail-status.is-copied{background:rgba(97,175,239,.18);color:#61afef}
.dsh-git-graph-detail-status.is-untracked{background:rgba(86,182,194,.18);color:#56b6c2}
.dsh-git-graph-detail-status.is-conflicted{background:rgba(198,120,221,.18);color:#c678dd}
.dsh-git-graph-detail-icon{flex:none;width:16px;height:16px;display:flex;align-items:center;justify-content:center}
.dsh-git-graph-detail-icon svg{width:16px;height:16px;display:block}
.dsh-git-graph-detail-name{flex:1;min-width:0;display:flex;align-items:baseline;gap:6px;overflow:hidden;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,#e6e6e8)}
.dsh-git-graph-detail-dir{flex:none;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b8b90)}
.dsh-git-graph-detail-count{flex:none;display:flex;gap:6px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:18px}
.dsh-git-graph-detail-count .is-add{color:#98c379}
.dsh-git-graph-detail-count .is-del{color:#e06c75}
.dsh-git-graph-menu-anchor{position:fixed;width:0;height:0;overflow:hidden;pointer-events:none}
.dsh-git-changes{height:100%;display:flex;flex-direction:column;min-height:0;color:var(--dsw-alias-label-primary,#e6e6e8);font-family:Inter,var(--dsw-font-family,sans-serif)}
.dsh-git-changes-header{flex:none;display:flex;flex-direction:column;gap:6px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08))}
.dsh-git-changes-message{box-sizing:border-box;width:100%;min-height:28px;max-height:108px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));border-radius:8px;background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,#e6e6e8);font:inherit;font-size:12px;line-height:18px;resize:none;outline:none;overflow-y:auto}
.dsh-git-changes-message:focus{border-color:var(--dsw-alias-brand-primary,#4f7cff)}
.dsh-git-changes-message::placeholder{color:var(--dsw-alias-label-dimmed,#8b8b90)}
.dsh-git-changes-toolbar{display:flex;align-items:center;gap:6px}
.dsh-git-changes-spacer{flex:1}
.dsh-git-changes-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#b0b0b5);cursor:pointer}
.dsh-git-changes-icon:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary,#e6e6e8)}
.dsh-git-changes-icon.is-active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-business-primary,#4f7cff)}
.dsh-git-changes-icon:disabled{opacity:.5;cursor:default}
@keyframes dsh-git-changes-spin{to{transform:rotate(360deg)}}
.dsh-git-changes-icon.is-generating svg{animation:dsh-git-changes-spin 1s linear infinite}
.dsh-git-graph-detail-caret{flex:none;display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;color:var(--dsw-alias-label-tertiary,#8b8b90)}
.dsh-git-graph-detail-row.is-dir .dsh-git-graph-detail-name{font-size:12px;line-height:16px;color:var(--dsw-alias-label-primary,#e6e6e8)}
.dsh-git-changes-commit{flex:none;display:inline-flex;align-items:stretch;height:22px;border-radius:6px;background:var(--dsw-alias-state-business-primary,#4f7cff);color:var(--dsw-alias-label-on-primary,#fff)}
.dsh-git-changes-commit-main{display:inline-flex;align-items:center;padding:0 10px;border:none;border-radius:6px 0 0 6px;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:16px;cursor:pointer}
.dsh-git-changes-commit-more{display:inline-flex;align-items:center;justify-content:center;width:20px;border:none;border-left:1px solid rgba(255,255,255,.25);border-radius:0 6px 6px 0;background:transparent;color:inherit;cursor:pointer}
.dsh-git-changes-commit-main:hover,.dsh-git-changes-commit-more:hover{background:rgba(255,255,255,.14)}
.dsh-git-changes-commit-main:disabled,.dsh-git-changes-commit-more:disabled{opacity:.5;cursor:default}
.dsh-git-changes .dsh-git-graph-detail{flex:1;max-height:none;border-top:none;min-height:0}
`

export function ensureGitGraphStyles(): void {
  if (typeof document === 'undefined') return
  const tagId = '@just-genius/dsh-codex/git-graph/styles.css'
  const existing = document.querySelector(
    'style[data-plugin-css=' + JSON.stringify(tagId) + ']',
  )
  if (existing instanceof HTMLStyleElement) {
    existing.textContent = GRAPH_CSS
    return
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = '@just-genius/dsh-codex'
  tag.dataset.pluginCss = tagId
  tag.textContent = GRAPH_CSS
  document.head.appendChild(tag)
}
