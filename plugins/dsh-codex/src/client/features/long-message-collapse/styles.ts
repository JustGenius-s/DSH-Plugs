import { injectStyles } from '@just-genius/dsh-plugin-ui'
import { LONG_MESSAGE_COLLAPSE_MAX_PX } from './model'

const CSS = `
.dsh-codex-long-msg-body{
  position:relative;
}
[data-dsh-codex-long-msg="collapsed"] .dsh-codex-long-msg-body{
  max-height:${LONG_MESSAGE_COLLAPSE_MAX_PX}px;
  overflow:hidden;
  -webkit-mask-image:linear-gradient(to bottom,#000 0,#000 calc(100% - 56px),transparent 100%);
  mask-image:linear-gradient(to bottom,#000 0,#000 calc(100% - 56px),transparent 100%);
}
.dsh-codex-long-msg-chrome{
  display:flex;
  align-items:center;
  gap:2px;
  margin:4px 0 0;
  padding:0;
}
[data-dsh-codex-long-msg="collapsed"] .dsh-codex-long-msg-chrome{
  margin-top:2px;
}
.dsh-codex-long-msg-more{
  display:inline-flex;
  align-items:center;
  gap:2px;
  margin:0;
  padding:0;
  border:none;
  background:transparent;
  color:var(--dsw-alias-label-secondary);
  font:inherit;
  font-size:13px;
  line-height:20px;
  cursor:pointer;
  user-select:none;
}
.dsh-codex-long-msg-more:hover{
  color:var(--dsw-alias-label-primary);
}
.dsh-codex-long-msg-more:focus-visible{
  outline:2px solid var(--dsw-alias-state-business-primary);
  outline-offset:2px;
  border-radius:4px;
}
.dsh-codex-long-msg-chevron{
  display:inline-flex;
  width:14px;
  height:14px;
  flex:none;
}
[data-dsh-codex-long-msg="expanded"] .dsh-codex-long-msg-chevron{
  transform:rotate(180deg);
}
@media (prefers-reduced-motion:reduce){
  [data-dsh-codex-long-msg="expanded"] .dsh-codex-long-msg-chevron{transform:none}
}
`

export function ensureLongMessageCollapseStyles(): void {
  injectStyles(
    '@just-genius/dsh-codex',
    '@just-genius/dsh-codex/long-message-collapse/styles.css',
    CSS,
  )
}
