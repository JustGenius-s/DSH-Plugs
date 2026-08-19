// Card-specific styles only; the DSH-native chrome (card, fields, switch,
// footer buttons) lives in @just-genius/dsh-plugin-ui and self-injects with
// the components.

import { injectStyles } from '@just-genius/dsh-plugin-ui'

const CSS = `
.dsh-du-readonly{margin:12px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-du-versions{display:flex;align-items:center;gap:8px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dsh-du-versions > span{flex:1;min-width:0}
.dsh-du-failed{flex:1;min-width:0;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error)}
`

/** Inject the stylesheet once; safe to call on every materialization. */
export function ensureCardStyles(): void {
  injectStyles('@just-genius/dsh-desktop-update', '@just-genius/dsh-desktop-update/card.css', CSS)
}
