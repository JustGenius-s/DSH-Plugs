import { injectStyles } from '@just-genius/dsh-plugin-ui'

const CSS = `
.dsh-codex-collapse{
  display:flex;
  align-items:center;
  width:100%;
  margin:0;
  padding:2px 0;
  border:none;
  border-bottom:1px solid var(--dsw-alias-border-l2);
  background:transparent;
  color:var(--dsw-alias-label-secondary);
  font-size:14px;
  line-height:24px;
  cursor:pointer;
  user-select:none;
}
.dsh-codex-collapse:focus-visible{
  outline:2px solid var(--dsw-alias-state-business-primary);
  outline-offset:2px;
}
.dsh-codex-collapse-leading{
  position:relative;
  display:inline-flex;
  flex:none;
  width:16px;
  height:16px;
  margin-right:6px;
  align-items:center;
  justify-content:center;
  color:var(--dsw-alias-label-tertiary);
}
.dsh-codex-collapse-idle{
  display:inline-flex;
  opacity:1;
  transition:opacity .1s ease;
}
.dsh-codex-collapse-chevron{
  position:absolute;
  top:0;
  right:0;
  bottom:0;
  left:0;
  margin:auto;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  opacity:0;
  transition:opacity .1s ease;
}
.dsh-codex-collapse.is-open .dsh-codex-collapse-chevron{
  opacity:1;
}
.dsh-codex-collapse.is-open .dsh-codex-collapse-idle{
  opacity:0;
}
.dsh-codex-collapse:hover .dsh-codex-collapse-idle{
  opacity:0;
}
.dsh-codex-collapse:hover .dsh-codex-collapse-chevron{
  opacity:1;
}
.dsh-codex-collapse-label{
  flex:none;
  font-variant-numeric:tabular-nums;
  color:inherit;
}
[data-dsh-codex-collapsed="true"]{
  display:none !important;
}
@media (prefers-reduced-motion:reduce){
  .dsh-codex-collapse-idle,
  .dsh-codex-collapse-chevron{transition:none}
}
`

export function ensureCollapseStyles(): void {
  injectStyles('@just-genius/dsh-codex', '@just-genius/dsh-codex/conversation-collapse/styles.css', CSS)
}
