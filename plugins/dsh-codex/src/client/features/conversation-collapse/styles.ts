const CSS = `
.dsh-codex-collapse{
  display:flex;
  align-items:center;
  gap:6px;
  margin:0;
  padding:0;
  border:none;
  background:transparent;
  color:var(--dsw-alias-label-tertiary);
  font:var(--dsw-font-s-14, 14px/24px inherit);
  cursor:pointer;
  user-select:none;
}
.dsh-codex-collapse:hover{
  color:var(--dsw-alias-label-secondary);
}
.dsh-codex-collapse:focus-visible{
  outline:2px solid var(--dsw-alias-state-business-primary);
  outline-offset:2px;
  border-radius:4px;
}
.dsh-codex-collapse-icon{
  position:relative;
  display:inline-flex;
  flex:none;
  width:14px;
  height:14px;
  color:inherit;
}
.dsh-codex-collapse-pickaxe,
.dsh-codex-collapse-chevron{
  position:absolute;
  inset:0;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  pointer-events:none;
}
.dsh-codex-collapse-pickaxe{
  opacity:1;
  transition:opacity .14s ease;
}
.dsh-codex-collapse-chevron{
  opacity:0;
  transition:transform .14s ease,opacity .14s ease;
  transform:rotate(0deg);
}
.dsh-codex-collapse[aria-expanded="false"] .dsh-codex-collapse-chevron{
  transform:rotate(-90deg);
}
.dsh-codex-collapse:is(:hover,:focus-visible) .dsh-codex-collapse-pickaxe{
  opacity:0;
}
.dsh-codex-collapse:is(:hover,:focus-visible) .dsh-codex-collapse-chevron{
  opacity:1;
}
.dsh-codex-collapse-label{
  font-variant-numeric:tabular-nums;
}
[data-dsh-codex-collapsed="true"]{
  display:none !important;
}
@media (prefers-reduced-motion:reduce){
  .dsh-codex-collapse-pickaxe,
  .dsh-codex-collapse-chevron{transition:none}
}
`

export function ensureCollapseStyles(): void {
  if (typeof document === 'undefined') return
  const tagId = '@just-genius/dsh-codex/conversation-collapse/styles.css'
  const existing = document.querySelector(
    'style[data-plugin-css=' + JSON.stringify(tagId) + ']',
  )
  if (existing instanceof HTMLStyleElement) {
    existing.textContent = CSS
    return
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = '@just-genius/dsh-codex'
  tag.dataset.pluginCss = tagId
  tag.textContent = CSS
  document.head.appendChild(tag)
}
