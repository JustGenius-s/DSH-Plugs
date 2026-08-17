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
.dsh-git-graph-detail{flex:none;max-height:42%;overflow:auto;border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));padding:8px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:16px;white-space:pre-wrap;color:var(--dsw-alias-label-secondary,#b0b0b5)}
.dsh-git-graph-menu-anchor{position:fixed;width:0;height:0;overflow:hidden;pointer-events:none}
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
