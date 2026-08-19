// Card-specific styles only; the DSH-native chrome (card, fields, switch,
// number input, footer buttons) lives in @just-genius/dsh-plugin-ui and
// self-injects with the components.

import { injectStyles } from '@just-genius/dsh-plugin-ui'

const CSS = `
.dsh-wg-readonly{margin:12px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-wg-failed{flex:1;min-width:0;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error)}
`

export function ensureCardStyles(): void {
  injectStyles('@just-genius/dsh-whale-girl', '@just-genius/dsh-whale-girl/card.css', CSS)
}
