import { injectStyles } from '@just-genius/dsh-plugin-ui'

const CSS = `
.dsh-codex-sticky-pin{
  position:fixed;
  z-index:45;
  pointer-events:none;
  box-sizing:border-box;
  padding:8px 0 10px;
  background:var(--dsw-alias-bg-base);
}
.dsh-codex-sticky-bubble{
  pointer-events:auto;
  display:flex;
  flex-direction:column;
  align-items:stretch;
  gap:8px;
  box-sizing:border-box;
  width:100%;
  min-width:0;
  max-width:100%;
  margin:0;
  padding:10px 16px;
  border:none;
  border-radius:22px;
  background:var(--dsw-specific-bubble);
  color:var(--dsw-alias-label-primary);
  font-size:16px;
  line-height:24px;
  text-align:left;
  box-shadow:var(--dsw-shadow-lv2);
  cursor:pointer;
  overflow:hidden;
}
.dsh-codex-sticky-bubble[data-expanded="true"]{
  overflow:visible;
}
.dsh-codex-sticky-bubble:focus-visible{
  outline:2px solid var(--dsw-alias-state-business-primary);
  outline-offset:2px;
}
.dsh-codex-sticky-text{
  display:block;
  min-width:0;
  overflow:hidden;
}
.dsh-codex-sticky-bubble[data-expanded="false"] .dsh-codex-sticky-text{
  white-space:nowrap;
  text-overflow:ellipsis;
}
.dsh-codex-sticky-bubble[data-expanded="true"] .dsh-codex-sticky-text{
  white-space:pre-wrap;
  overflow-wrap:anywhere;
  max-height:min(40vh, 320px);
  overflow-y:auto;
}
.dsh-codex-sticky-thumbs{
  display:flex;
  flex-wrap:nowrap;
  align-items:center;
  gap:6px;
  min-width:0;
  overflow:hidden;
}
.dsh-codex-sticky-bubble[data-expanded="false"] .dsh-codex-sticky-thumbs[data-overflow]{
  -webkit-mask-image:linear-gradient(to right,#000 calc(100% - 18px),transparent);
  mask-image:linear-gradient(to right,#000 calc(100% - 18px),transparent);
}
.dsh-codex-sticky-bubble[data-expanded="true"] .dsh-codex-sticky-thumbs{
  flex-wrap:wrap;
  max-height:min(40vh, 240px);
  overflow:auto;
}
.dsh-codex-sticky-thumb-wrap{
  position:relative;
  display:block;
  flex:none;
  width:32px;
  height:32px;
  border-radius:8px;
  overflow:hidden;
  background:var(--dsw-alias-interactive-bg-hover);
}
.dsh-codex-sticky-thumbs .dsh-codex-sticky-thumb-wrap:only-child{
  width:auto;
  height:32px;
  max-width:min(160px, 40%);
  min-width:48px;
}
.dsh-codex-sticky-bubble[data-expanded="true"] .dsh-codex-sticky-thumb-wrap{
  width:64px;
  height:64px;
}
.dsh-codex-sticky-bubble[data-expanded="true"] .dsh-codex-sticky-thumbs .dsh-codex-sticky-thumb-wrap:only-child{
  width:auto;
  height:auto;
  max-width:min(280px, 100%);
  max-height:160px;
}
.dsh-codex-sticky-thumb{
  display:block;
  width:100%;
  height:100%;
  object-fit:cover;
  pointer-events:none;
}
.dsh-codex-sticky-thumbs .dsh-codex-sticky-thumb-wrap:only-child .dsh-codex-sticky-thumb{
  width:auto;
  height:100%;
  min-width:48px;
}
.dsh-codex-sticky-bubble[data-expanded="true"] .dsh-codex-sticky-thumbs .dsh-codex-sticky-thumb-wrap:only-child .dsh-codex-sticky-thumb{
  width:auto;
  height:auto;
  max-width:min(280px, 100%);
  max-height:160px;
}
.dsh-codex-sticky-thumb-zoom{
  position:absolute;
  inset:0;
  display:flex;
  align-items:center;
  justify-content:center;
  margin:0;
  padding:0;
  border:none;
  border-radius:inherit;
  background:transparent;
  color:#fff;
  cursor:zoom-in;
  opacity:0;
  transition:opacity .12s ease, background .12s ease;
}
.dsh-codex-sticky-thumb-wrap:hover .dsh-codex-sticky-thumb-zoom,
.dsh-codex-sticky-thumb-wrap:focus-within .dsh-codex-sticky-thumb-zoom{
  opacity:1;
  background:color-mix(in srgb, #000 42%, transparent);
}
.dsh-codex-sticky-thumb-zoom:focus-visible{
  opacity:1;
  background:color-mix(in srgb, #000 42%, transparent);
  outline:2px solid var(--dsw-alias-state-business-primary);
  outline-offset:-2px;
}
.dsh-codex-sticky-preview{
  position:fixed;
  inset:0;
  z-index:80;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:32px;
  background:color-mix(in srgb, #000 72%, transparent);
  cursor:zoom-out;
}
.dsh-codex-sticky-preview img{
  max-width:min(92vw, 1200px);
  max-height:88vh;
  object-fit:contain;
  border-radius:8px;
  box-shadow:var(--dsw-shadow-lv2);
  cursor:default;
}
.dsh-codex-sticky-preview-close{
  position:absolute;
  top:16px;
  right:16px;
  width:32px;
  height:32px;
  display:flex;
  align-items:center;
  justify-content:center;
  margin:0;
  padding:0;
  border:none;
  border-radius:999px;
  background:color-mix(in srgb, #000 45%, transparent);
  color:#fff;
  cursor:pointer;
}
.dsh-codex-sticky-preview-close:focus-visible{
  outline:2px solid var(--dsw-alias-state-business-primary);
  outline-offset:2px;
}
`

export function ensureStickyBubbleStyles(): void {
  injectStyles(
    '@just-genius/dsh-codex',
    '@just-genius/dsh-codex/sticky-user-bubble/styles.css',
    CSS,
  )
}
