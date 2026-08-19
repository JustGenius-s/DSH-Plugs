const CSS = `
.dsh-wg-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s}
.dsh-wg-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dsh-wg-card-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dsh-wg-header{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}
.dsh-wg-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsh-wg-headtext{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dsh-wg-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dsh-wg-description{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-wg-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}
.dsh-wg-chevron-open{transform:rotate(180deg)}
.dsh-wg-pending{flex:none;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.dsh-wg-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.dsh-wg-readonly{margin:12px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-wg-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}
.dsh-wg-field + .dsh-wg-field{border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-wg-field-head{display:flex;align-items:center;gap:8px}
.dsh-wg-label{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-wg-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-wg-switch{appearance:none;margin:0;flex:none;width:32px;height:18px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);position:relative;cursor:pointer;transition:background .16s,border-color .16s}
.dsh-wg-switch::after{content:'';position:absolute;top:1px;left:1px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary);transition:transform .16s,background .16s}
.dsh-wg-switch:checked{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dsh-wg-switch:checked::after{transform:translateX(14px);background:var(--dsw-alias-bg-layer-3,#fff)}
.dsh-wg-switch:hover:not(:disabled):not(:checked){border-color:var(--dsw-alias-label-dimmed)}
.dsh-wg-switch:disabled{opacity:.4;cursor:default}
.dsh-wg-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-wg-number{appearance:textfield;flex:none;width:72px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);padding:3px 8px;font:inherit;font-size:13px;line-height:1.5}
.dsh-wg-number:disabled{opacity:.4}
.dsh-wg-number:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-wg-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 0 4px;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-wg-failed{flex:1;min-width:0;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error)}
.dsh-wg-discard,.dsh-wg-save{appearance:none;border:1px solid transparent;border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer}
.dsh-wg-discard{border-color:var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary)}
.dsh-wg-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dsh-wg-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dsh-wg-discard:disabled,.dsh-wg-save:disabled{opacity:.4;cursor:default}
.dsh-wg-discard:focus-visible,.dsh-wg-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
`

export function ensureCardStyles(): void {
  if (typeof document === 'undefined') return
  const tagId = '@just-genius/dsh-whale-girl/card.css'
  if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = '@just-genius/dsh-whale-girl'
  tag.dataset.pluginCss = tagId
  tag.textContent = CSS
  document.head.appendChild(tag)
}
