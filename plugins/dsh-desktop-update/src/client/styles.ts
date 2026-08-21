// Card-specific styles only; the DSH-native chrome (card, fields, switch,
// footer buttons) lives in @just-genius/dsh-plugin-ui and self-injects with
// the components.

import { injectStyles } from '@just-genius/dsh-plugin-ui'

const CSS = `
.dsh-du-readonly{margin:12px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-du-versions{display:flex;align-items:center;gap:8px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dsh-du-versions > span{flex:1;min-width:0}
.dsh-du-update-row{display:flex;align-items:center;gap:8px;margin-top:8px}
.dsh-du-status{flex:1;min-width:0;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dsh-du-status-error{color:var(--dsw-alias-label-error)}
.dsh-du-failed{flex:1;min-width:0;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error)}
.dsh-du-channel-trigger{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.dsh-du-channel-trigger > span{flex:1;min-width:0}
.dsh-du-channel-trigger > svg{flex:none;color:var(--dsw-alias-label-caption);transition:transform 120ms ease}
.dsh-du-channel-trigger[data-menu-open='true'] > svg{transform:rotate(180deg)}
.dsh-du-channel-trigger:disabled{opacity:.4;cursor:default}
.dsh-du-channel-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-du-input{width:100%;max-width:260px;padding:6px 10px;font-size:13px;line-height:1.4;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
.dsh-du-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.dsh-du-input:disabled{opacity:.5;cursor:not-allowed}
`

/** Inject the stylesheet once; safe to call on every materialization. */
export function ensureCardStyles(): void {
  injectStyles('@just-genius/dsh-desktop-update', '@just-genius/dsh-desktop-update/card.css', CSS)
}
