import { injectStyles } from '@just-genius/dsh-plugin-ui'

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
  transition:opacity .14s ease,transform .14s ease;
}
.dsh-codex-collapse-pickaxe{opacity:1}
.dsh-codex-collapse-chevron{
  opacity:0;
  transform:rotate(-90deg);
}
.dsh-codex-collapse[aria-expanded="true"] .dsh-codex-collapse-pickaxe{opacity:0}
.dsh-codex-collapse[aria-expanded="true"] .dsh-codex-collapse-chevron{
  opacity:1;
  transform:rotate(0deg);
}
.dsh-codex-collapse[aria-expanded="false"]:is(:hover,:focus-visible) .dsh-codex-collapse-pickaxe{
  opacity:0;
}
.dsh-codex-collapse[aria-expanded="false"]:is(:hover,:focus-visible) .dsh-codex-collapse-chevron{
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
  injectStyles('@just-genius/dsh-codex', '@just-genius/dsh-codex/conversation-collapse/styles.css', CSS)
}
